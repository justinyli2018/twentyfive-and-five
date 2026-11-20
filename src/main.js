'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Linux: Wayland doesn't let apps keep themselves on top, so run through
// X11/XWayland, where always-on-top works. Transparent visuals are needed
// for the see-through window.
if (isLinux) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
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
const GLASS = ['clear', 'frosted', 'solid'];

let win = null;
let tray = null;
let settings = { glass: 'frosted' };
let state = { running: false, mode: 'focus', time: '25:00' };
let failedShortcuts = [];

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
  if (!GLASS.includes(settings.glass)) settings.glass = 'frosted';
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch {}
}

function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - W - 24, y: wa.y + 24 };
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
    if (failedShortcuts.length) {
      send('notice', `Shortcut taken: ${failedShortcuts.join(', ')}`);
    }
    runArgs(process.argv);
  });

  // Something else grabbed the top spot: take it back.
  win.on('blur', pinOnTop);
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    settings.x = x; settings.y = y;
    saveSettings();
  });
  win.on('closed', () => { win = null; });

  // Fullscreen apps and some window managers can drop the flag; reassert it.
  setInterval(pinOnTop, 3000);
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
  for (const a of argv || []) if (CLI[a]) command(CLI[a]);
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
      label: 'Glass',
      submenu: GLASS.map(g => ({
        label: g[0].toUpperCase() + g.slice(1),
        type: 'radio',
        checked: settings.glass === g,
        click: () => { settings.glass = g; saveSettings(); send('glass', g); refreshTray(); },
      })),
    },
    {
      label: 'Move to corner',
      click: () => {
        if (!win) return;
        const p = defaultPosition();
        win.setPosition(p.x, p.y);
      },
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
ipcMain.handle('info', () => ({ platform: process.platform, shortcuts: SHORTCUTS }));

// ---------- app lifecycle ----------
const gotLock = app.requestSingleInstanceLock({ argv: process.argv });

if (!gotLock) {
  // Already running: the first instance receives our args and acts on them.
  app.quit();
} else {
  app.on('second-instance', (_e, argv, _cwd, extra) => runArgs((extra && extra.argv) || argv));

  app.whenReady().then(() => {
    if (isMac && app.dock) app.dock.hide(); // overlay-only app, no Dock icon
    loadSettings();
    registerShortcuts();
    createTray();
    // Linux compositors sometimes paint a transparent window black if it's
    // created immediately at startup; a short delay avoids that.
    setTimeout(createWindow, isLinux ? 300 : 0);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
