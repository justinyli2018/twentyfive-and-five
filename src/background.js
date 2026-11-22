'use strict';
// Watches the screen around the overlay, for the Auto and Neutral appearances.
//
// Fast path: a hidden page keeps a tiny, low-frame-rate screen stream open and
// hands back just the strip of pixels around the overlay (~3% of one CPU core
// at 4 samples a second in testing).
// Fallback: a one-off screenshot once a second (about twice the CPU per sample).
//
// Wayland (e.g. Ubuntu's GNOME): screen access goes through the system's
// "Share screen" dialog, which asks again for every new capture session. So
// there we open one stream per app run and keep it (paused when not needed)
// instead of restarting it, and never fall back to screenshots.
//
// Pixels are only counted in memory; nothing is saved or sent anywhere.
const { BrowserWindow, desktopCapturer, ipcMain, screen, powerMonitor } = require('electron');
const path = require('node:path');

const STREAM_WIDTH = 240;  // capture width; brightness doesn't need more
const STREAM_FPS = 5;
const BAND = 56;           // screen pixels around the overlay to look at
const WHITE_MIN = 212;     // every channel at least this bright…
const WHITE_SPREAD = 36;   // …and nearly grey (bright yellow etc. don't count)

const INTERVAL = { stream: 250, streamBattery: 500, poll: 1000, idle: 1000 };

const clamp01 = v => Math.min(1, Math.max(0, v));

// The strip around the overlay, as fractions (0–1) of the display.
// Only the usable screen area counts: the menu bar / GNOME top bar, docks and
// taskbars aren't "the background", and a dark top bar right above the
// overlay would otherwise stop it from ever turning light.
function regions(bounds, display) {
  const d = display.bounds, wa = display.workArea || d;
  const fx = v => clamp01((v - d.x) / d.width);
  const fy = v => clamp01((v - d.y) / d.height);
  const cx = v => Math.min(wa.x + wa.width, Math.max(wa.x, v));
  const cy = v => Math.min(wa.y + wa.height, Math.max(wa.y, v));
  return {
    outer: { l: fx(cx(bounds.x - BAND)), r: fx(cx(bounds.x + bounds.width + BAND)),
             t: fy(cy(bounds.y - BAND)), b: fy(cy(bounds.y + bounds.height + BAND)) },
    inner: { l: fx(bounds.x), r: fx(bounds.x + bounds.width),
             t: fy(bounds.y), b: fy(bounds.y + bounds.height) },
  };
}

// Fraction of white/near-white pixels in a cropped image of the outer region,
// skipping the overlay itself. Works for RGBA and BGRA alike.
function whiteFraction(data, width, height, { outer, inner }) {
  const ow = outer.r - outer.l || 1, oh = outer.b - outer.t || 1;
  // Skip the overlay plus one pixel around it (edge pixels blend with it).
  const il = Math.floor(((inner.l - outer.l) / ow) * width) - 1;
  const ir = Math.ceil(((inner.r - outer.l) / ow) * width) + 1;
  const it = Math.floor(((inner.t - outer.t) / oh) * height) - 1;
  const ib = Math.ceil(((inner.b - outer.t) / oh) * height) + 1;
  let total = 0, white = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= il && x < ir && y >= it && y < ib) continue;
      const i = (y * width + x) * 4;
      const a = data[i], b = data[i + 1], c = data[i + 2];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      total++;
      if (lo >= WHITE_MIN && hi - lo <= WHITE_SPREAD) white++;
    }
  }
  if (process.env.TF5_DEBUG && total) {
    let sum = [0, 0, 0], n = 0;
    for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++; }
    console.log(`[appearance] region ${width}x${height} avg colour ${sum.map(v => Math.round(v / n)).join(',')}`);
  }
  return total ? white / total : null;
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), ms); }),
  ]);
}

const WAYLAND = process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY;

async function screenSource(display, thumbnailSize) {
  // On Wayland this shows the "Share screen" dialog, so give the user time.
  const sources = await withTimeout(
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize }), WAYLAND ? 180000 : 4000, 'screen list');
  const src = sources.find(s => s.display_id === String(display.id)) ||
              (sources.length === 1 ? sources[0] : null);
  if (!src) throw new Error('screen not found or sharing declined');
  return src;
}

class BackgroundWatcher {
  /**
   * @param {object} o
   * @param {() => object|null} o.getBounds  overlay window bounds, or null if hidden
   * @param {() => boolean} o.isWanted       should we be watching right now?
   * @param {(white: number) => void} o.onReading
   * @param {(reason: string) => void} o.onUnavailable  capture doesn't work / was declined
   */
  constructor(o) {
    Object.assign(this, o);
    this.mode = 'stream'; // 'stream' | 'poll' | 'off'
    this.failures = 0;
    this.sampler = null;
    this.streamDisplay = null;
    this.calls = new Map();
    this.nextId = 1;
    this.timer = null;
    this.paused = false;
    ipcMain.on('sampler-reply', (e, msg) => {
      if (!this.sampler || e.sender !== this.sampler.webContents) return;
      const call = this.calls.get(msg.id);
      if (!call) return;
      this.calls.delete(msg.id);
      msg.ok ? call.resolve(msg.result) : call.reject(new Error(msg.error || 'sampler error'));
    });
  }

  start() { this.schedule(0); }

  // Try capture again from scratch (e.g. after the user re-picks Auto).
  reset() {
    this.mode = 'stream';
    this.failures = 0;
    this.schedule(0);
  }

  // Check again soon (e.g. the overlay just moved).
  poke() { this.schedule(0); }

  // Fully release screen capture (e.g. the user picked Dark or Light).
  release() { this.stopStream(); }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  async tick() {
    if (this.busy) return this.schedule(50);
    const bounds = this.getBounds();
    if (this.mode === 'off' || !bounds || !this.isWanted()) {
      // Release the capture while it isn't needed. On Wayland just pause it,
      // because starting again would show the "Share screen" dialog again.
      if (WAYLAND && this.mode !== 'off') this.pauseStream();
      else this.stopStream();
      return this.schedule(INTERVAL.idle);
    }
    this.busy = true;
    try {
      const display = screen.getDisplayMatching(bounds);
      const white = this.mode === 'stream'
        ? await this.sampleStream(bounds, display)
        : await this.samplePoll(bounds, display);
      this.failures = 0;
      if (white != null) this.onReading(white);
    } catch (e) {
      this.failures++;
      if (process.env.TF5_DEBUG) console.log('[appearance] sample failed in', this.mode, 'mode:', e && e.message);
      if (WAYLAND) {
        // Declined, or sharing was stopped from the system menu. Don't ask
        // again on our own; picking Auto / Neutral again restarts it.
        this.stopStream();
        this.mode = 'off';
        this.onUnavailable('declined');
      } else if (this.mode === 'stream' && this.failures >= 2) {
        this.stopStream();
        this.mode = 'poll';
        this.failures = 0;
      } else if (this.mode === 'poll' && this.failures >= 3) {
        this.mode = 'off';
        this.onUnavailable('failed');
      } else if (this.mode === 'stream') {
        this.stopStream(); // restart the stream on the next tick
      }
    } finally {
      this.busy = false;
    }
    const onBattery = (() => { try { return powerMonitor.isOnBatteryPower(); } catch { return false; } })();
    this.schedule(this.mode === 'poll' ? INTERVAL.poll : onBattery ? INTERVAL.streamBattery : INTERVAL.stream);
  }

  // ---- fast path: stream ----
  async sampleStream(bounds, display) {
    await this.ensureStream(display);
    if (this.paused) { await this.call('resume', {}, 3000); this.paused = false; }
    const r = regions(bounds, display);
    const img = await this.call('grab', { crop: r.outer }, 3000);
    return whiteFraction(img.data, img.width, img.height, r);
  }

  async ensureStream(display) {
    if (this.sampler && this.streamDisplay != null && (WAYLAND || this.streamDisplay === display.id)) return;
    this.stopStream();
    this.sampler = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'sampler-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const sampler = this.sampler;
    sampler.on('closed', () => { if (this.sampler === sampler) { this.sampler = null; this.streamDisplay = null; } });
    await sampler.loadFile(path.join(__dirname, 'sampler.html'));
    const src = await screenSource(display, { width: 0, height: 0 }); // ids only, no screenshots
    const height = Math.max(1, Math.round(STREAM_WIDTH * display.bounds.height / display.bounds.width));
    await this.call('start', { id: src.id, width: STREAM_WIDTH, height, fps: STREAM_FPS }, 5000);
    this.streamDisplay = display.id;
  }

  pauseStream() {
    if (!this.sampler || this.paused || this.streamDisplay == null) return;
    this.paused = true;
    this.call('pause', {}, 3000).catch(() => {});
  }

  stopStream() {
    this.paused = false;
    for (const c of this.calls.values()) c.reject(new Error('stopped'));
    this.calls.clear();
    if (this.sampler && !this.sampler.isDestroyed()) this.sampler.destroy();
    this.sampler = null;
    this.streamDisplay = null;
  }

  call(type, payload, timeout) {
    if (!this.sampler || this.sampler.isDestroyed()) return Promise.reject(new Error('no sampler'));
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => this.calls.set(id, { resolve, reject }));
    this.sampler.webContents.send('sampler-request', { id, type, payload });
    return withTimeout(p, timeout, `sampler ${type}`).finally(() => this.calls.delete(id));
  }

  // ---- fallback: one-off screenshot ----
  async samplePoll(bounds, display) {
    const d = display.bounds;
    const w = 480, h = Math.max(1, Math.round(480 * d.height / d.width));
    const src = await screenSource(display, { width: w, height: h });
    if (src.thumbnail.isEmpty()) throw new Error('empty screenshot');
    const { width: tw, height: th } = src.thumbnail.getSize();
    const r = regions(bounds, display);
    const rect = {
      x: Math.floor(r.outer.l * tw), y: Math.floor(r.outer.t * th),
      width: Math.max(1, Math.ceil(r.outer.r * tw) - Math.floor(r.outer.l * tw)),
      height: Math.max(1, Math.ceil(r.outer.b * th) - Math.floor(r.outer.t * th)),
    };
    const crop = src.thumbnail.crop(rect);
    const { width, height } = crop.getSize();
    return whiteFraction(crop.toBitmap(), width, height, r);
  }
}

module.exports = { BackgroundWatcher, whiteFraction, regions };
