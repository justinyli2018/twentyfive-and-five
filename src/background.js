'use strict';
// Looks at the screen around the overlay to decide whether it sits on a
// white background. Used by the "Auto" appearance setting.
const { desktopCapturer, screen } = require('electron');

const BAND = 32;    // screen pixels around the overlay to look at
const SCALE = 0.25; // capture at quarter resolution; plenty for brightness
const WHITE_MIN = 212;   // every channel at least this bright…
const WHITE_SPREAD = 36; // …and nearly grey (so bright yellow etc. don't count)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('screen capture timed out')), ms)),
  ]);
}

// Returns the fraction (0–1) of pixels in a band around `bounds` that are
// white or near-white, or null if there's nothing to measure.
// The overlay itself is skipped, so it never measures its own glass.
async function measureWhiteAround(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const db = display.bounds;
  const sources = await withTimeout(desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(db.width * SCALE)),
      height: Math.max(1, Math.round(db.height * SCALE)),
    },
  }), 4000);

  const src = sources.find(s => s.display_id === String(display.id)) ||
              (sources.length === 1 ? sources[0] : null);
  if (!src || src.thumbnail.isEmpty()) throw new Error('no screen image');

  const { width: tw, height: th } = src.thumbnail.getSize();
  const px = src.thumbnail.toBitmap(); // 4 bytes per pixel (channel order varies by OS; we treat them alike)
  const sx = tw / db.width, sy = th / db.height;
  const x0 = bounds.x - db.x, y0 = bounds.y - db.y;

  const outer = {
    l: clamp(Math.floor((x0 - BAND) * sx), 0, tw),
    r: clamp(Math.ceil((x0 + bounds.width + BAND) * sx), 0, tw),
    t: clamp(Math.floor((y0 - BAND) * sy), 0, th),
    b: clamp(Math.ceil((y0 + bounds.height + BAND) * sy), 0, th),
  };
  const inner = {
    l: Math.floor(x0 * sx), r: Math.ceil((x0 + bounds.width) * sx),
    t: Math.floor(y0 * sy), b: Math.ceil((y0 + bounds.height) * sy),
  };

  let total = 0, white = 0;
  for (let y = outer.t; y < outer.b; y++) {
    for (let x = outer.l; x < outer.r; x++) {
      if (x >= inner.l && x < inner.r && y >= inner.t && y < inner.b) continue;
      const i = (y * tw + x) * 4;
      const a = px[i], b = px[i + 1], c = px[i + 2];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      total++;
      if (lo >= WHITE_MIN && hi - lo <= WHITE_SPREAD) white++;
    }
  }
  return total ? white / total : null;
}

module.exports = { measureWhiteAround };
