'use strict';
(() => {
  const DUR = { focus: 25 * 60 * 1000, break: 5 * 60 * 1000 };
  const LABEL = { focus: 'Focus', break: 'Break' };
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';

  const $ = id => document.getElementById(id);
  const card = $('card'), modeEl = $('mode'), timeEl = $('time'), progress = $('progress'),
        toggleBtn = $('toggleBtn'), skipBtn = $('skipBtn'), resetBtn = $('resetBtn'), menuBtn = $('menuBtn'),
        glassPanel = $('glassPanel'), glassSlider = $('glassSlider'), glassValue = $('glassValue'),
        glassDone = $('glassDone');

  let mode = 'focus', running = false, remaining = DUR.focus, endAt = 0;
  let notice = '', noticeUntil = 0;

  // ---- timer (timestamp based, so it never drifts) ----
  function toggle() {
    if (running) {
      remaining = Math.max(0, endAt - Date.now());
      running = false;
    } else {
      endAt = Date.now() + remaining;
      running = true;
    }
    tick(running);
    render();
  }

  function switchMode(overshoot = 0) {
    mode = mode === 'focus' ? 'break' : 'focus';
    remaining = DUR[mode] - overshoot;
    if (running) endAt = Date.now() + remaining;
    chime(mode);
    card.classList.remove('switched');
    void card.offsetWidth; // restart the animation
    card.classList.add('switched');
    render();
  }

  function skip() { switchMode(); }
  function reset() { running = false; mode = 'focus'; remaining = DUR.focus; render(); }

  function update() {
    if (running) {
      remaining = endAt - Date.now();
      if (remaining <= 0) return switchMode(Math.min(-remaining, DUR.break - 1000));
    }
    render();
  }

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  let lastReport = '', lastIcon = '';
  function render() {
    const t = fmt(remaining);
    timeEl.textContent = t;

    if (notice && Date.now() < noticeUntil) modeEl.textContent = notice;
    else modeEl.textContent = !running && remaining === DUR[mode] ? `${LABEL[mode]} · ready` : LABEL[mode];

    progress.style.width = (100 * (1 - remaining / DUR[mode])).toFixed(2) + '%';
    card.dataset.mode = mode;
    card.classList.toggle('paused', !running);

    const icon = running ? 'pause' : 'play';
    if (icon !== lastIcon) { toggleBtn.innerHTML = running ? ICON_PAUSE : ICON_PLAY; lastIcon = icon; }

    document.title = `${t} · ${LABEL[mode]}`;
    const report = `${t}|${mode}|${running}`;
    if (report !== lastReport) {
      lastReport = report;
      window.overlay?.reportState({ time: t, mode, running });
    }
  }

  // ---- chime ----
  let ctx = null;
  try { ctx = new AudioContext(); } catch {}
  function chime(next) {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = next === 'break' ? [880, 660] : [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + i * 0.22;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 1);
    });
  }

  // Short tactile tick for start/pause: brighter when starting, lower when pausing.
  function tick(starting) {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(starting ? 1500 : 950, t0);
    o.frequency.exponentialRampToValueAtTime(starting ? 750 : 420, t0 + 0.05);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.09);
  }

  // ---- glass opacity ----
  const root = document.documentElement;
  function applyGlass(v) {
    v = Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
    const alpha = 0.03 + (v / 100) * 0.87;               // 0% = almost clear, 100% = nearly solid
    root.style.setProperty('--tint-a', alpha.toFixed(3)); // colour comes from the theme
    root.style.setProperty('--glow', `${Math.round(24 + v * 0.26)}%`);
    glassSlider.value = v;
    glassSlider.style.setProperty('--fill', `${v}%`);
    glassValue.textContent = `${v}%`;
  }
  function openGlassPanel() {
    glassPanel.hidden = false;
    card.classList.add('editing');
  }
  function closeGlassPanel() {
    glassPanel.hidden = true;
    card.classList.remove('editing');
  }
  glassSlider.addEventListener('input', () => applyGlass(glassSlider.value));      // live preview
  glassSlider.addEventListener('change', () => window.overlay?.setGlass(Number(glassSlider.value))); // save
  glassDone.addEventListener('click', closeGlassPanel);
  applyGlass(45);

  // ---- input ----
  const actions = { toggle, skip, reset };
  const onClick = (el, fn) => el.addEventListener('click', () => { fn(); el.blur(); });
  onClick(toggleBtn, toggle);
  onClick(skipBtn, skip);
  onClick(resetBtn, reset);
  onClick(menuBtn, () => window.overlay?.openMenu());

  // Local keys for when the overlay itself is focused.
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!glassPanel.hidden) {
      if (e.key === 'Escape' || e.key === 'Enter') closeGlassPanel();
      return; // let arrow keys move the slider
    }
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'p') { e.preventDefault(); toggle(); }
    else if (k === 's' || k === 'n') skip();
    else if (k === 'r') reset();
  });

  if (window.overlay) {
    window.overlay.onCommand(cmd => actions[cmd]?.());
    window.overlay.onGlass(applyGlass);
    window.overlay.onGlassPanel(openGlassPanel);
    window.overlay.onTheme(theme => { root.dataset.theme = theme === 'light' ? 'light' : 'dark'; });
    window.overlay.onNotice(msg => { notice = msg; noticeUntil = Date.now() + 6000; render(); });

    window.overlay.info().then(({ platform, shortcuts }) => {
      const nice = a => a.replace('CommandOrControl', platform === 'darwin' ? '⌘' : 'Ctrl')
                         .replace('Alt', platform === 'darwin' ? '⌥' : 'Alt');
      toggleBtn.title = `Start / pause (${nice(shortcuts.toggle)})`;
      skipBtn.title = `Skip (${nice(shortcuts.skip)})`;
      resetBtn.title = `Reset (${nice(shortcuts.reset)})`;
      menuBtn.title = `Menu · show/hide: ${nice(shortcuts.visibility)}`;
    });
  }

  setInterval(update, 250);
  render();
})();
