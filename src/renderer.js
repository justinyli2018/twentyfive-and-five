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

  // Only touch the page when something visible changed: with no GPU (common
  // on Linux) every repaint costs CPU, so this keeps the overlay nearly idle.
  let lastReport = '', lastIcon = '';
  const shown = {};
  function put(key, value, apply) {
    if (shown[key] === value) return;
    shown[key] = value;
    apply(value);
  }
  function render() {
    const t = fmt(remaining);
    put('time', t, v => { timeEl.textContent = v; });

    const label = notice && Date.now() < noticeUntil ? notice
      : !running && remaining === DUR[mode] ? `${LABEL[mode]} · ready` : LABEL[mode];
    put('label', label, v => { modeEl.textContent = v; });

    // Progress from the displayed seconds, so the bar moves when the digits do.
    const secsLeft = Math.max(0, Math.ceil(remaining / 1000));
    const pct = (100 * (1 - (secsLeft * 1000) / DUR[mode])).toFixed(2) + '%';
    put('bar', pct, v => { progress.style.width = v; });
    put('mode', mode, v => { card.dataset.mode = v; });
    put('paused', !running, v => card.classList.toggle('paused', v));

    const icon = running ? 'pause' : 'play';
    if (icon !== lastIcon) { toggleBtn.innerHTML = running ? ICON_PAUSE : ICON_PLAY; lastIcon = icon; }

    put('title', `${t} · ${LABEL[mode]}`, v => { document.title = v; });
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

  // ---- appearance ----
  // Colours live in CSS custom properties that animate, so changing
  // data-theme / data-style fades the whole overlay across (styles.css).
  const themeRing = $('themeRing');
  function applyAppearance({ theme, style, nativeGlass, platform }) {
    root.dataset.theme = theme === 'light' ? 'light' : 'dark';
    root.dataset.style = style === 'neutral' ? 'neutral' : 'tinted';
    root.dataset.platform = platform || '';
    if (nativeGlass) root.dataset.native = '';
    else delete root.dataset.native;
  }

  // Progress ring shown while a detected change is being confirmed.
  function showPending(p) {
    if (!p) { themeRing.classList.remove('active'); return; }
    themeRing.dataset.to = p.to;
    themeRing.title = `Switching to ${p.to} in a moment`;
    themeRing.style.setProperty('--ring-ms', `${p.ms}ms`);
    themeRing.classList.remove('active');
    void themeRing.offsetWidth; // restart the fill animation
    themeRing.classList.add('active');
  }
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
    if (e.target.closest && e.target.closest('.todo')) return; // typing in the to-do list
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
    window.overlay.onAppearance(applyAppearance);
    window.overlay.onThemePending(showPending);
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

  // Paused "breathing": a slow fade of the digits, updated ~12× a second.
  let breathStart = 0;
  setInterval(() => {
    if (running) {
      if (breathStart) { breathStart = 0; timeEl.style.opacity = ''; }
      return;
    }
    if (!breathStart) breathStart = performance.now();
    const phase = ((performance.now() - breathStart) / 2400) * 2 * Math.PI;
    timeEl.style.opacity = (0.725 + 0.275 * Math.cos(phase)).toFixed(2); // 1 → 0.45 → 1
  }, 83);

  setInterval(update, 250);
  render();
})();
