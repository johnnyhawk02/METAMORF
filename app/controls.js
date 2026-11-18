// The page's controls, with no knowledge of the sound: knobs, bars, the padlock and the dice. Only a press and drag
// changes a control: the scroll wheel, the trackpad and the arrow keys never do, nothing is focusable by Tab and
// nothing marks a control after it's let go, so passing the pointer over one is safe.
export const $ = (id) => document.getElementById(id);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- drags. A drag ends on the button coming up, and also on every way that can be missed: a move with no button
// held, lost pointer capture, the window losing focus, and the tab being hidden ----
const drags = new Set();
export function endDrags() { for (const end of [...drags]) end(); }
addEventListener('blur', endDrags);
document.addEventListener('visibilitychange', () => { if (document.hidden) endDrags(); });
// o: { min, max, get(), put(v), len (pixels for the whole range; none: the track's length, and a press jumps there),
//   held(bool) }
export function dragger(track, axis, o) {
  let d = null;
  const end = () => { if (!d) return; d = null; drags.delete(end); if (o.held) o.held(false); };
  track.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone already */ }
    e.preventDefault();
    const r = track.getBoundingClientRect(), len = o.len || (axis === 'x' ? r.width : r.height);
    const at = axis === 'x' ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height;
    const f = (o.get() - o.min) / (o.max - o.min);
    if (!o.len && Math.abs(at - f) * len > 8) o.put(o.min + clamp(at, 0, 1) * (o.max - o.min)); // a bar jumps to the press; a knob turns from where it is
    d = { last: axis === 'x' ? e.clientX : e.clientY, acc: o.get(), len, id: e.pointerId };
    drags.add(end);
    if (o.held) o.held(true);
  });
  track.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    if (!e.buttons) { end(); return; } // the button came up where we didn't hear it
    const p = axis === 'x' ? e.clientX : e.clientY, dp = axis === 'x' ? p - d.last : d.last - p;
    d.last = p; d.acc = clamp(d.acc + dp / d.len * (o.max - o.min) * (e.shiftKey ? 0.25 : 1), o.min, o.max);
    o.put(d.acc);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(ev, end);
}

// ---- a horizontal segmented bar (HOW MUCH) ----
export function hbar(box, label, o) {
  const el = document.createElement('div'); el.className = 'hb';
  el.innerHTML = '<span class="lab"></span><div class="htrack" role="slider"><i></i></div><output></output>';
  el.querySelector('.lab').textContent = label;
  const tr = el.querySelector('.htrack'), out = el.querySelector('output');
  tr.setAttribute('aria-label', label); tr.setAttribute('aria-valuemin', o.min); tr.setAttribute('aria-valuemax', o.max);
  const draw = () => { const v = o.get(); tr.style.setProperty('--f', (v - o.min) / (o.max - o.min)); out.textContent = o.show(v); tr.setAttribute('aria-valuenow', v); };
  const put = (v) => { v = clamp(Math.round(v), o.min, o.max); if (v !== o.get()) { o.set(v); draw(); } };
  dragger(tr, 'x', { ...o, put });
  for (const t of [el.querySelector('.lab'), tr]) t.addEventListener('dblclick', () => put(o.dflt));
  box.append(el);
  return draw;
}

// ---- a knob in the LCD look: a ring of segments lit up to the value, a pointer, and a notch outside the ring for the
// value it had before a hand edit. A plus-minus knob (centre given) has its centre at the top and lights outwards ----
const KNOB_N = 25, KNOB_A0 = Math.PI * 0.75, KNOB_SWEEP = Math.PI * 1.5;
export const KNOB_SVG = (() => {
  let t = '';
  for (let i = 0; i < KNOB_N; i++) {
    const a = KNOB_A0 + i / (KNOB_N - 1) * KNOB_SWEEP, c = Math.cos(a), s = Math.sin(a);
    t += `<line class="tk" x1="${(32 + 20 * c).toFixed(2)}" y1="${(32 + 20 * s).toFixed(2)}" x2="${(32 + 28 * c).toFixed(2)}" y2="${(32 + 28 * s).toFixed(2)}"/>`;
  }
  // (the modulation marks: an arc outside the ring for how far it reaches, a dot per source under the ring)
  const dots = [26, 32, 38].map((x, i) => `<rect class="md" data-s="${i}" x="${x - 2}" y="54" width="4" height="4"/>`).join('');
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${t}<path class="marc" d=""/>${dots}<line class="ptr" x1="32" y1="32" x2="46" y2="32"/><line class="notch" x1="61" y1="32" x2="64" y2="32"/></svg>`;
})();
const MARC_R = 31.5;
const arcPt = (f) => { const a = KNOB_A0 + clamp(f, 0, 1) * KNOB_SWEEP; return `${(32 + MARC_R * Math.cos(a)).toFixed(2)} ${(32 + MARC_R * Math.sin(a)).toFixed(2)}`; };
/** the arc outside the ring from f0 to f1 (0..1 of the sweep) */
export const arcPath = (f0, f1) => { f0 = clamp(f0, 0, 1); f1 = clamp(f1, 0, 1); if (f1 - f0 < 0.004) return ''; return `M ${arcPt(f0)} A ${MARC_R} ${MARC_R} 0 ${(f1 - f0) * KNOB_SWEEP > Math.PI ? 1 : 0} 1 ${arcPt(f1)}`; };
export const knobF = (v, min, max) => (max > min ? (v - min) / (max - min) : 0);
export const knobDeg = (f) => (KNOB_A0 + clamp(f, 0, 1) * KNOB_SWEEP) * 180 / Math.PI;
export function lightRing(ticks, f, cf) {
  const lit = Math.round(clamp(f, 0, 1) * (KNOB_N - 1));
  if (cf === undefined) ticks.forEach((t, i) => t.classList.toggle('on', i <= lit && (f > 0 || i === 0)));
  else { const c = Math.round(cf * (KNOB_N - 1)), a = Math.min(lit, c), b = Math.max(lit, c); ticks.forEach((t, i) => t.classList.toggle('on', i >= a && i <= b)); }
}
// a control's padlock: faint when open to the randomisers, solid when locked
export const LOCK_SVG = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>';
const LR_SVG = '<text class="lr" x="3" y="66">L</text><text class="lr" x="61" y="66">R</text>';
// o: { label, min, max, centre, step, get(), set(v), show(v), reset() (double-click), was() (the notch: undefined for
//   none), lock: { get(), toggle() } or none, lr, learn (the target LEARN maps), lit() (the label lit: a hand edit),
//   mod() (its modulation: null for none, or { lo, hi: how far it reaches, in the knob's units; on: [a bool per source] }) }
export function knob(o) {
  const el = document.createElement('div'); el.className = 'vf';
  el.innerHTML = `<output></output><div class="knob" role="slider">${KNOB_SVG}</div><span class="lab"></span>${o.lock ? `<button class="lock" type="button" tabindex="-1" aria-label="Lock ${o.label}">${LOCK_SVG}</button>` : ''}`;
  el.querySelector('.lab').textContent = o.label;
  const tr = el.querySelector('.knob'), out = el.querySelector('output'), lock = el.querySelector('.lock');
  const ticks = tr.querySelectorAll('.tk'), ptr = tr.querySelector('.ptr'), notch = tr.querySelector('.notch'), marc = tr.querySelector('.marc'), mds = tr.querySelectorAll('.md');
  tr.setAttribute('aria-label', o.label); tr.setAttribute('aria-valuemin', o.min); tr.setAttribute('aria-valuemax', o.max);
  if (o.lr) tr.querySelector('svg').insertAdjacentHTML('beforeend', LR_SVG);
  const cf = o.centre === undefined ? undefined : knobF(o.centre, o.min, o.max);
  const draw = () => {
    const v = o.get(), f = knobF(v, o.min, o.max);
    lightRing(ticks, f, cf);
    ptr.setAttribute('transform', `rotate(${knobDeg(f)} 32 32)`);
    out.textContent = o.show(v); tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', o.show(v));
    const w = o.was ? o.was() : undefined;
    tr.classList.toggle('morphed', w !== undefined && w !== v);
    if (w !== undefined) notch.setAttribute('transform', `rotate(${knobDeg(knobF(w, o.min, o.max))} 32 32)`);
    el.classList.toggle('keyed', !!(o.lit && o.lit()));
    const m = o.mod ? o.mod() : null;
    marc.setAttribute('d', m ? arcPath(knobF(m.lo, o.min, o.max), knobF(m.hi, o.min, o.max)) : '');
    mds.forEach((d, i) => d.classList.toggle('on', !!(m && m.on[i])));
    if (lock) { const l = o.lock.get(); lock.setAttribute('aria-pressed', l); lock.title = l ? `${o.label.toUpperCase()} is locked: the randomisers leave it as it is. Click to unlock` : `Lock ${o.label.toUpperCase()}: the randomisers then leave it as it is`; }
  };
  const put = (x) => {
    x = clamp(o.step ? Math.round(x / o.step) * o.step : x, o.min, o.max);
    if (o.centre !== undefined && Math.abs(x - o.centre) < (o.max - o.min) * 0.012) x = o.centre; // the centre catches the knob
    if (x === o.get()) return;
    o.set(x); draw();
  };
  dragger(tr, 'y', { min: o.min, max: o.max, len: 160, get: o.get, put, held: (h) => el.classList.toggle('held', h) });
  const reset = () => { if (o.reset) { o.reset(); draw(); } };
  el.querySelector('.lab').addEventListener('dblclick', reset); tr.addEventListener('dblclick', reset);
  if (o.learn) el.dataset.learn = JSON.stringify(o.learn);
  if (lock) lock.addEventListener('click', () => { o.lock.toggle(); draw(); });
  return { el, draw };
}

// ---- the dice (NEW SOUND): flat, seven pips, the lit ones its face. Pressed, it turns once while its face changes a
// few times, in about a third of a second ----
const DICE_PIPS = { tl: [5, 5], tr: [19, 5], ml: [5, 12], mr: [19, 12], bl: [5, 19], br: [19, 19], c: [12, 12] };
const DICE_FACES = [[], ['c'], ['tl', 'br'], ['tl', 'c', 'br'], ['tl', 'tr', 'bl', 'br'], ['tl', 'tr', 'c', 'bl', 'br'], ['tl', 'tr', 'ml', 'mr', 'bl', 'br']];
export const DIE_SVG = `<svg viewBox="0 0 28 28" aria-hidden="true">${Object.entries(DICE_PIPS).map(([k, [x, y]]) => `<rect class="pip" data-p="${k}" x="${x}" y="${y}" width="4" height="4"/>`).join('')}</svg>`;
export function makeDice(dice) {
  let face = 0, t = 0;
  const show = (n) => { face = n; for (const d of dice) for (const r of d.querySelectorAll('.pip')) r.classList.toggle('on', DICE_FACES[n].includes(r.dataset.p)); };
  for (const d of dice) d.addEventListener('animationend', () => d.classList.remove('roll'));
  show(5);
  return function roll() {
    clearInterval(t);
    const next = () => { let n; do n = 1 + Math.floor(Math.random() * 6); while (n === face); show(n); };
    next();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const d of dice) { d.classList.remove('roll'); void d.offsetWidth; d.classList.add('roll'); }
    let left = 3; t = setInterval(() => { next(); if (!--left) clearInterval(t); }, 80);
  };
}
