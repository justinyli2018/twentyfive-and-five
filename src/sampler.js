'use strict';
(() => {
  let stream = null;
  let capture = null;
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    capture = null;
  }

  async function start({ id, width, height, fps }) {
    stop();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: id,
          maxWidth: width,
          maxHeight: height,
          maxFrameRate: fps,
        },
      },
    });
    capture = new ImageCapture(stream.getVideoTracks()[0]);
  }

  // Returns only the cropped region (a few KB), not the whole frame.
  async function grab({ crop }) {
    if (!capture) throw new Error('not started');
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') throw new Error('capture ended');
    const frame = await capture.grabFrame();
    try {
      const x = Math.floor(crop.l * frame.width);
      const y = Math.floor(crop.t * frame.height);
      const w = Math.max(1, Math.ceil(crop.r * frame.width) - x);
      const h = Math.max(1, Math.ceil(crop.b * frame.height) - y);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(frame, x, y, w, h, 0, 0, w, h);
      return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
    } finally {
      frame.close();
    }
  }

  // Pause / resume without ending the capture session (Wayland would ask again).
  const setEnabled = on => { if (stream) stream.getVideoTracks().forEach(t => { t.enabled = on; }); };

  const handlers = {
    start,
    grab,
    stop: async () => stop(),
    pause: async () => setEnabled(false),
    resume: async () => setEnabled(true),
  };

  window.sampler.onRequest(async ({ id, type, payload }) => {
    try {
      const result = await handlers[type](payload);
      window.sampler.reply({ id, ok: true, result });
    } catch (e) {
      window.sampler.reply({ id, ok: false, error: String((e && e.message) || e) });
    }
  });
})();
