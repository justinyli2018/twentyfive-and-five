'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, Tray, nativeImage,
        nativeTheme, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { measureWhiteAround } = require('./background');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Linux: Wayland doesn't let apps keep themselves on top, so run through
// X11/XWayland, where always-on-top works. Transparent visuals are needed
// for the see-through window.
// The display backend is picked before this file runs, so on a Wayland
// session started without --ozone-platform=x11 (e.g. from the app menu),
// restart once with it.
const X11_FLAG = '--ozone-platform=x11';
const relaunchForX11 = isLinux && !!process.env.WAYLAND_DISPLAY && !!process.env.DISPLAY &&
  !process.argv.includes(X11_FLAG);
if (relaunchForX11) {
  app.relaunch({
    // An AppImage unmounts when this process exits, so restart the AppImage
    // file itself rather than the binary inside it.
    ...(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : {}),
    args: [...process.argv.slice(1), X11_FLAG],
  });
  app.exit(0);
}
if (isLinux) {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
// Keep settings in the same folder whether run from source or installed
// (the installed app's display name would otherwise pick a new folder).
app.setPath('userData', path.join(app.getPath('appData'), 'twentyfive-and-five'));
// Let the chime play even when a global shortcut (not a click) started the timer.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Global shortcuts: they work while you're in any other app.
const SHORTCUTS = {
  toggle: 'CommandOrControl+Alt+P',     // start / pause / resume
  skip: 'CommandOrControl+Alt+N',       // next session
  reset: 'CommandOrControl+Alt+R',      // back to 25:00
  visibility: 'CommandOrControl+Alt+O', // show / hide the overlay
};

// Command-line controls, e.g. `npm run toggle`, for binding to OS shortcuts.
const CLI = {
  '--toggle': 'toggle',
  '--skip': 'skip',
  '--reset': 'reset',
  '--show-hide': 'visibility',
  '--quit': 'quit',
};

const W = 260;
const H = 176;
const MARGIN = 14; // gap between the window and the screen edge
const THEMES = {
  auto: 'Auto (match background)',
  dark: 'Dark',
  light: 'Light',
};
const CORNERS = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

let win = null;
let tray = null;
let settings = {
  glass: 45,      // glass opacity, 0 (clear) to 100 (solid)
  theme: 'auto',  // 'auto' | 'dark' | 'light'
};
let state = { running: false, mode: 'focus', time: '25:00' };
let failedShortcuts = [];

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
  const old = { clear: 10, frosted: 45, solid: 90 }; // earlier preset names
  if (settings.glass in old) settings.glass = old[settings.glass];
  settings.glass = Number.isFinite(settings.glass) ? Math.min(100, Math.max(0, settings.glass)) : 45;
  if (!(settings.theme in THEMES)) settings.theme = 'auto';
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch {}
}

function cornerPosition(corner, display = screen.getPrimaryDisplay()) {
  const wa = display.workArea;
  return {
    x: corner.endsWith('left') ? wa.x + MARGIN : wa.x + wa.width - W - MARGIN,
    y: corner.startsWith('top') ? wa.y + MARGIN : wa.y + wa.height - H - MARGIN,
  };
}
function defaultPosition() {
  return cornerPosition('top-right');
}
function startPosition() {
  if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
    const cx = settings.x + W / 2, cy = settings.y + H / 2;
    const onScreen = screen.getAllDisplays().some(({ workArea: b }) =>
      cx >= b.x && cy >= b.y && cx < b.x + b.width && cy < b.y + b.height);
    if (onScreen) return { x: settings.x, y: settings.y };
  }
  return defaultPosition();
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: W,
    height: H,
    ...startPosition(),
    title: '25 & 5',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    // Windows: clicking the overlay never takes keyboard focus from your app.
    focusable: !isWin,
    // macOS: a non-activating floating panel that also sits over fullscreen apps.
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  if (!isWin) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    reveal();
  });

  win.webContents.on('did-finish-load', () => {
    send('glass', settings.glass);
    sendTheme();
    updateAutoTheme(true);
    if (failedShortcuts.length) {
      send('notice', `Shortcut taken: ${failedShortcuts.join(', ')}`);
    }
    runArgs(process.argv);
  });

  // Something else grabbed the top spot: take it back.
  win.on('blur', pinOnTop);
  win.on('moved', () => {
    if (slideTimer) return; // slideTo saves the final spot itself
    const [x, y] = win.getPosition();
    settings.x = x; settings.y = y;
    saveSettings();
    updateAutoTheme();
  });
  win.on('closed', () => { win = null; });

  // Fullscreen apps and some window managers can drop the flag; reassert it.
  setInterval(pinOnTop, 3000);
  // Auto appearance: re-check what's behind the overlay.
  setInterval(() => updateAutoTheme(), 2000);
}

// ---------- appearance (dark / light / auto) ----------
// Auto favours dark: it only turns light when the screen right around the
// overlay is (nearly) all white, and needs a bit less white to stay light,
// so it doesn't flicker at the boundary.
let autoTheme = 'dark';
let pendingTheme = null;
let measuring = false;
let captureFailures = 0;

function currentTheme() {
  return settings.theme === 'auto' ? autoTheme : settings.theme;
}
function sendTheme() {
  send('theme', currentTheme());
}

// Can we look at the screen behind the overlay?
function captureAllowed() {
  // Wayland doesn't let apps see other windows (it would ask permission every time).
  if (isLinux && process.env.WAYLAND_DISPLAY) return false;
  // macOS needs Screen Recording permission. Ask only after the user picks Auto
  // from the menu, never on first launch.
  if (isMac && systemPreferences.getMediaAccessStatus('screen') !== 'granted' && !settings.askedScreenAccess) {
    return false;
  }
  return captureFailures < 3; // give up after repeated failures
}

async function updateAutoTheme(immediate = false) {
  if (settings.theme !== 'auto' || measuring || !win || win.isDestroyed() || !win.isVisible()) return;

  let next;
  if (captureAllowed()) {
    measuring = true;
    try {
      const white = await measureWhiteAround(win.getBounds());
      captureFailures = 0;
      if (white == null) return;
      next = white >= (autoTheme === 'light' ? 0.6 : 0.85) ? 'light' : 'dark';
    } catch {
      captureFailures++;
      if (captureAllowed()) return; // try again next round
    } finally {
      measuring = false;
    }
  }
  // No screen access: follow the system's light/dark setting instead.
  if (!next) next = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';

  if (next === autoTheme) { pendingTheme = null; return; }
  // Require two readings in a row before switching (ignores brief flashes).
  if (!immediate && pendingTheme !== next) { pendingTheme = next; return; }
  pendingTheme = null;
  autoTheme = next;
  sendTheme();
}

function setTheme(theme) {
  settings.theme = theme;
  if (theme === 'auto' && isMac) settings.askedScreenAccess = true;
  captureFailures = 0;
  saveSettings();
  sendTheme();
  updateAutoTheme(true);
  refreshTray();
}

function pinOnTop() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isWin) win.moveTop();
}

// Show the overlay. Windows/macOS: without taking focus from your app.
// GNOME flags windows that appear unfocused as "demanding attention" (and
// shows a "… is ready" notification), so on Linux take focus once on appear.
function reveal() {
  if (!win) return;
  if (isLinux) win.show();
  else win.showInactive();
  pinOnTop();
}

// Glide the window to a corner of the screen it's currently on.
let slideTimer = null;
function slideToCorner(corner) {
  if (!win) return;
  const display = screen.getDisplayMatching(win.getBounds());
  const { x: tx, y: ty } = cornerPosition(corner, display);
  const [sx, sy] = win.getPosition();
  const start = Date.now();
  const duration = 420;
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(slideTimer); slideTimer = null; return; }
    const t = Math.min(1, (Date.now() - start) / duration);
    const e = 1 - Math.pow(1 - t, 3); // ease-out
    // setBounds (not setPosition) so the size can't drift on scaled displays.
    win.setBounds({ x: Math.round(sx + (tx - sx) * e), y: Math.round(sy + (ty - sy) * e), width: W, height: H });
    if (t === 1) {
      clearInterval(slideTimer);
      slideTimer = null;
      settings.x = tx; settings.y = ty;
      saveSettings();
      updateAutoTheme(true); // new spot, new background
    }
  }, 1000 / 60);
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function toggleVisibility() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else reveal();
  refreshTray();
}

function command(cmd) {
  if (cmd === 'quit') return app.quit();
  if (cmd === 'visibility') return toggleVisibility();
  if (win && !win.isVisible()) reveal();
  send('command', cmd);
}

function runArgs(argv) {
  for (const a of argv || []) {
    if (CLI[a]) command(CLI[a]);
    const m = /^--corner=(.+)$/.exec(a); // e.g. --corner=bottom-left
    if (m && CORNERS[m[1]]) slideToCorner(m[1]);
    const t = /^--theme=(.+)$/.exec(a); // e.g. --theme=light
    if (t && THEMES[t[1]]) setTheme(t[1]);
  }
}

// ---------- shortcuts ----------
function registerShortcuts() {
  failedShortcuts = [];
  for (const [cmd, accel] of Object.entries(SHORTCUTS)) {
    let ok = false;
    try { ok = globalShortcut.register(accel, () => command(cmd)); } catch {}
    if (!ok) failedShortcuts.push(accel.replace('CommandOrControl', isMac ? 'Cmd' : 'Ctrl'));
  }
}

// ---------- tray / menu ----------
function trayImage() {
  // A small coral dot, drawn in code so no image file is needed.
  const s = 32, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const a = Math.max(0, Math.min(1, 13 - Math.hypot(x - 15.5, y - 15.5)));
      const i = (y * s + x) * 4;
      buf[i] = Math.round(0x59 * a);     // B (premultiplied)
      buf[i + 1] = Math.round(0x7a * a); // G
      buf[i + 2] = Math.round(0xff * a); // R
      buf[i + 3] = Math.round(0xff * a); // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s, scaleFactor: 2 });
}

function buildMenu() {
  const shortcut = cmd => ({ accelerator: SHORTCUTS[cmd], registerAccelerator: false });
  const label = state.mode === 'focus' ? 'Focus' : 'Break';
  return Menu.buildFromTemplate([
    { label: `${label}${state.running ? '' : ' (paused)'}`, enabled: false },
    { type: 'separator' },
    { label: state.running ? 'Pause' : 'Start', ...shortcut('toggle'), click: () => command('toggle') },
    { label: 'Skip to next', ...shortcut('skip'), click: () => command('skip') },
    { label: 'Reset', ...shortcut('reset'), click: () => command('reset') },
    { label: win && win.isVisible() ? 'Hide overlay' : 'Show overlay', ...shortcut('visibility'), click: toggleVisibility },
    { type: 'separator' },
    {
      label: 'Appearance',
      submenu: Object.entries(THEMES).map(([theme, label]) => ({
        label,
        type: 'radio',
        checked: settings.theme === theme,
        click: () => setTheme(theme),
      })),
    },
    {
      label: 'Glass opacity…',
      click: () => { if (win && !win.isVisible()) reveal(); send('glass-panel'); },
    },
    {
      label: 'Move to',
      submenu: Object.entries(CORNERS).map(([corner, label]) => ({
        label,
        click: () => slideToCorner(corner),
      })),
    },
    { type: 'separator' },
    { label: 'Quit 25 & 5', click: () => app.quit() },
  ]);
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip('25 & 5');
    tray.on('click', toggleVisibility);
    refreshTray();
  } catch { tray = null; }
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildMenu());
}

// ---------- IPC ----------
ipcMain.on('state', (_e, s) => {
  const changed = s.running !== state.running || s.mode !== state.mode;
  state = s;
  if (tray) {
    if (isMac) tray.setTitle(s.time); // show the countdown in the macOS menu bar
    tray.setToolTip(`25 & 5 · ${s.time}`);
    if (changed) refreshTray();
  }
});
ipcMain.on('menu', () => {
  if (win) buildMenu().popup({ window: win });
});
ipcMain.on('set-glass', (_e, value) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  settings.glass = Math.min(100, Math.max(0, Math.round(v)));
  saveSettings();
});
ipcMain.handle('info', () => ({ platform: process.platform, shortcuts: SHORTCUTS }));

// ---------- app lifecycle ----------
// (Skip the lock while relaunching, so the restarted copy can take it.)
const gotLock = !relaunchForX11 && app.requestSingleInstanceLock({ argv: process.argv });

if (!gotLock) {
  // Already running: the first instance receives our args and acts on them.
  if (!relaunchForX11) app.quit();
} else {
  app.on('second-instance', (_e, argv, _cwd, extra) => runArgs((extra && extra.argv) || argv));

  app.whenReady().then(() => {
    if (isMac && app.dock) app.dock.hide(); // overlay-only app, no Dock icon
    loadSettings();
    nativeTheme.on('updated', () => updateAutoTheme(true));
    registerShortcuts();
    createTray();
    // Linux compositors sometimes paint a transparent window black if it's
    // created immediately at startup; a short delay avoids that.
    setTimeout(createWindow, isLinux ? 300 : 0);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
