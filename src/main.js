'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, Tray, nativeImage,
        nativeTheme, systemPreferences, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { BackgroundWatcher } = require('./background');

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
const PAD = 10;     // transparent margin inside the window around the card (room for its shadow)
const THEMES = {
  auto: 'Auto (match background)',
  dark: 'Dark',
  light: 'Light',
  neutral: 'Neutral glass',
};
const CORNERS = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

let win = null;
let tray = null;
let outerH = H; // full window height; grows with the to-do list
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
    y: corner.startsWith('top') ? wa.y + MARGIN : wa.y + wa.height - outerH - MARGIN,
  };
}
function defaultPosition() {
  return cornerPosition('top-right');
}
function startPosition() {
  if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
    const cx = settings.x + W / 2, cy = settings.y + outerH / 2;
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
    updateNativeGlass();
    followSystemIfNeeded();
    sendAppearance();
    if (failedShortcuts.length) {
      send('notice', `Shortcut taken: ${failedShortcuts.join(', ')}`);
    }
    runArgs(process.argv);
  });

  // Something else grabbed the top spot: take it back.
  win.on('blur', pinOnTop);
  win.on('moved', () => {
    if (slideTimer) return; // slideTo saves the final spot itself
    const { x, y } = outerPosition();
    settings.x = x; settings.y = y;
    saveSettings();
    if (watcher) watcher.poke(); // new spot, new background
  });
  win.on('closed', () => { win = null; });

  // Fullscreen apps and some window managers can drop the flag; reassert it.
  setInterval(pinOnTop, 3000);
  // Auto / Neutral appearance: keep an eye on what's around the overlay.
  watcher = new BackgroundWatcher({
    getBounds: () => (win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null),
    isWanted: () => adaptive() && !screenLocked && captureAllowed(),
    onReading: onBackgroundReading,
    onUnavailable: reason => {
      debug(`screen capture ${reason}; following system setting`);
      captureWorks = false;
      // Declined the Wayland "Share screen" dialog: stop asking at every
      // launch until Auto / Neutral is picked from the menu again.
      if (reason === 'declined' && isWayland) { settings.askedScreenAccess = false; saveSettings(); }
      followSystemIfNeeded();
      syncNativeAppearance();
    },
  });
  watcher.start();
}

// ---------- appearance (auto / dark / light / neutral) ----------
// Auto and Neutral pick dark or light from what's around the overlay, and
// favour dark: light only when the surroundings are (nearly) all white, and it
// takes a bit less white to stay light, so it doesn't flicker at the edge.
// A switch is announced first (a small progress ring in the overlay) and only
// happens if the readings hold for CONFIRM_MS; the overlay then fades across.
const CONFIRM_MS = 1500;
const LIGHT_ON = 0.85;  // share of near-white pixels needed to turn light
const LIGHT_OFF = 0.6;  // …and to stay light

let detected = 'dark';
let detectedOnce = false;
let pending = null;       // { to, timer } while the progress ring runs
let captureWorks = true;  // false once the watcher gives up
let screenLocked = false;
let watcher = null;
let nativeGlass = false;  // OS blur behind the window (Neutral on macOS / Windows 11)

// Set TF5_DEBUG=1 to log appearance decisions to the terminal.
const debug = (...a) => { if (process.env.TF5_DEBUG) console.log('[appearance]', ...a); };

const adaptive = () => settings.theme === 'auto' || settings.theme === 'neutral';

function currentTheme() {
  return adaptive() ? detected : settings.theme;
}

function sendAppearance() {
  send('appearance', {
    theme: currentTheme(),                                   // 'dark' | 'light'
    style: settings.theme === 'neutral' ? 'neutral' : 'tinted',
    nativeGlass,
    platform: process.platform,
  });
}

// Can we look at the screen around the overlay?
const isWayland = isLinux && !!process.env.WAYLAND_DISPLAY;

function captureAllowed() {
  // Ask for screen access only after the user has picked Auto or Neutral from
  // the menu, never on a fresh install:
  // - macOS: Screen Recording permission (asked once by the system).
  // - Wayland (e.g. Ubuntu): the "Share screen" dialog, once per app launch.
  if (isMac && systemPreferences.getMediaAccessStatus('screen') !== 'granted' && !settings.askedScreenAccess) {
    return false;
  }
  if (isWayland && !settings.askedScreenAccess) return false;
  return captureWorks;
}

function cancelPending(reason = 'cancelled') {
  if (!pending) return;
  debug('pending', reason);
  clearTimeout(pending.timer);
  pending = null;
  send('theme-pending', null);
}

function applyDetected(theme) {
  cancelPending('done');
  detectedOnce = true;
  if (theme === detected) return;
  debug('switch ->', theme);
  detected = theme;
  syncNativeAppearance();
  sendAppearance();
}

function proposeTheme(next) {
  if (!detectedOnce) return applyDetected(next); // first reading: no countdown
  if (next === detected) return cancelPending(); // changed back: cancel
  if (pending && pending.to === next) return;    // already counting down
  cancelPending();
  debug('pending ->', next);
  pending = { to: next, timer: setTimeout(() => applyDetected(next), CONFIRM_MS) };
  send('theme-pending', { to: next, ms: CONFIRM_MS });
}

function onBackgroundReading(white) {
  if (!adaptive()) return;
  debug('reading white=' + white.toFixed(2));
  proposeTheme(white >= (detected === 'light' ? LIGHT_OFF : LIGHT_ON) ? 'light' : 'dark');
}

// Without screen access, Auto / Neutral follow the system light/dark setting.
function followSystemIfNeeded() {
  if (!adaptive() || captureAllowed()) return;
  if (nativeTheme.themeSource !== 'system') return; // we're overriding it ourselves
  applyDetected(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
}

// ----- Neutral: real OS blur where available -----
function nativeGlassSupported() {
  if (isMac) return true;
  if (isWin) return Number(os.release().split('.')[2]) >= 22621; // Windows 11 22H2+
  return false; // Linux: no API for blurring what's behind a window
}

// The OS material fills the whole window, so while it's on the window shrinks
// to the card (no transparent margin). Positions are always saved for the
// full-size window so switching modes keeps the card where it is.
const inset = () => (nativeGlass ? PAD : 0);
function outerPosition() {
  const b = win.getBounds();
  return { x: b.x - inset(), y: b.y - inset() };
}
function placeAt(x, y) {
  const i = inset();
  win.setBounds({ x: x + i, y: y + i, width: W - 2 * i, height: outerH - 2 * i });
}

// The page reports the card's height (it changes as the to-do list opens,
// closes and gains items). Grow or shrink away from the nearest screen edge
// so the overlay stays anchored where you put it.
function resizeToContent(cardHeight) {
  if (!win || win.isDestroyed() || !Number.isFinite(cardHeight)) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const want = Math.min(Math.ceil(cardHeight) + 2 * PAD, wa.height);
  if (want === outerH) return;
  const { x, y } = outerPosition();
  const anchorBottom = y + outerH / 2 > wa.y + wa.height / 2;
  let ny = anchorBottom ? y + outerH - want : y;
  ny = Math.max(wa.y, Math.min(ny, wa.y + wa.height - want));
  outerH = want;
  placeAt(x, ny);
  settings.x = x; settings.y = ny;
  saveSettings();
}

function updateNativeGlass() {
  if (!win || win.isDestroyed()) return;
  const want = settings.theme === 'neutral' && nativeGlassSupported();
  if (want === nativeGlass) return;
  const pos = outerPosition();
  try {
    if (isMac) win.setVibrancy(want ? 'under-window' : null);
    if (isWin) win.setBackgroundMaterial(want ? 'acrylic' : 'none');
    nativeGlass = want;
  } catch {
    nativeGlass = false;
  }
  placeAt(pos.x, pos.y);
  syncNativeAppearance();
}

// The OS blur is tinted light or dark by the app's appearance; match it to the
// detected background. Without screen access leave it to the system.
function syncNativeAppearance() {
  const source = nativeGlass && captureAllowed() ? detected : 'system';
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
}

function setTheme(theme) {
  settings.theme = theme;
  if (adaptive() && (isMac || isWayland)) settings.askedScreenAccess = true;
  saveSettings();
  captureWorks = true;
  cancelPending();
  if (!adaptive() && watcher) watcher.release(); // Dark / Light: stop capturing entirely
  updateNativeGlass();
  followSystemIfNeeded();
  syncNativeAppearance();
  sendAppearance();
  if (watcher) watcher.reset();
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
  const { x: sx, y: sy } = outerPosition();
  const start = Date.now();
  const duration = 420;
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(slideTimer); slideTimer = null; return; }
    const t = Math.min(1, (Date.now() - start) / duration);
    const e = 1 - Math.pow(1 - t, 3); // ease-out
    // setBounds (not setPosition) so the size can't drift on scaled displays.
    placeAt(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
    if (t === 1) {
      clearInterval(slideTimer);
      slideTimer = null;
      settings.x = tx; settings.y = ty;
      saveSettings();
      if (watcher) watcher.poke(); // new spot, new background
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
ipcMain.on('content-height', (_e, h) => resizeToContent(Number(h)));

// Typing in the to-do list needs keyboard focus, which the overlay normally
// never takes on Windows (so clicks don't pull focus from your work).
ipcMain.handle('want-focus', (_e, on) => {
  if (!win || win.isDestroyed()) return false;
  if (on) {
    if (isWin) win.setFocusable(true);
    win.focus();
  } else if (isWin) {
    win.blur();
    win.setFocusable(false);
  }
  return true;
});

// ---------- to-do list storage ----------
const todosFile = () => path.join(app.getPath('userData'), 'todos.json');
ipcMain.handle('todos-load', () => {
  try { return JSON.parse(fs.readFileSync(todosFile(), 'utf8')); } catch { return null; }
});
ipcMain.on('todos-save', (_e, data) => {
  if (!data || !Array.isArray(data.items)) return;
  const items = data.items
    .filter(i => i && typeof i.id === 'string')
    .map(i => ({ id: i.id.slice(0, 40), text: String(i.text || '').slice(0, 500), done: !!i.done }))
    .slice(0, 500);
  try {
    fs.mkdirSync(path.dirname(todosFile()), { recursive: true });
    fs.writeFileSync(todosFile(), JSON.stringify({ items, showDone: !!data.showDone }));
  } catch {}
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
    nativeTheme.on('updated', followSystemIfNeeded);
    // Don't watch the screen while it's locked or asleep.
    powerMonitor.on('lock-screen', () => { screenLocked = true; });
    powerMonitor.on('unlock-screen', () => { screenLocked = false; });
    powerMonitor.on('suspend', () => { screenLocked = true; });
    powerMonitor.on('resume', () => { screenLocked = false; });
    registerShortcuts();
    createTray();
    // Linux compositors sometimes paint a transparent window black if it's
    // created immediately at startup; a short delay avoids that.
    setTimeout(createWindow, isLinux ? 300 : 0);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
