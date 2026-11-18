// METAMORF: the page. 25 keys on MIDI channel 1, split between 1 to 4 mono engines; every key has its own sound, and the
// knobs edit the key played last. The sound engine is in engine/ and sound/ (no UI there); the controls, colours and
// phone view are in this folder.
import { PARAMS, BY_ID, SECTIONS, BASE, OUT_DEFAULT, TYPES, KEYS, MAX_ENGINES, DEFAULT_ENGINES, DEFAULT_LOW, isBip, showValue, fullParams, clampN,
  levelText, panText, sendText, panRange, engineOf, zoneOf } from '../sound/params.js?v=mwm7rfj6';
import { free, recipe, alter, pickTables, RECIPE_TYPES } from '../sound/makers.js?v=mwm7rfj6';
import { FX_DEFAULTS, RETURN_BEATS } from '../engine/instrument.js?v=mwm7rfj6';
import { DIRT_DEFAULTS, dirtHz, scHz, decayMs, volDb, pregainDb, bassDb } from '../sound/dirt.js?v=mwm7rfj6';
import { presetName } from './names.js?v=mwm7rfj6';
import { $, clamp, hbar, knob, makeDice, DIE_SVG } from './controls.js?v=mwm7rfj6';
import { setupColours } from './colours.js?v=mwm7rfj6';
import { setupPhone } from './phone.js?v=mwm7rfj6';
import { render as renderOffline } from './offline.js?v=mwm7rfj6';
import * as WT from './wavetables.js?v=mwm7rfj6';
import { decodeWav, autoSize, SIZES } from './wav.js?v=mwm7rfj6';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); // C3 = 60
const ENG = (e) => `ENGINE ${e + 1}`;

// ---------------------------------------------------------------------------------------------------------------
// state, kept in this browser
// ---------------------------------------------------------------------------------------------------------------
const STORE = 'metamorf-v1';
const TYPE_IDS = TYPES.map((t) => t[0]);
// a key: its sound (p: every parameter, normalised, by id; name, type, from), its hand edits (o: what a control was
// before it was changed by hand), its home (what ALTER varies around), its lock, and its output (out: level, pan,
// send, trim: part of the mix, not of the sound), and its oscillators' tables (t: a and b, by id)
const baseTables = () => ({ a: WT.DEFAULT_TABLE, b: WT.DEFAULT_TABLE });
const blankKey = () => ({ p: { ...BASE }, t: baseTables(), name: '', type: '', from: 'base', o: {}, home: null, lock: false, out: { ...OUT_DEFAULT } });
const tidyT = (t) => ({ a: WT.validId(t?.a) ? t.a : WT.DEFAULT_TABLE, b: WT.validId(t?.b) ? t.b : WT.DEFAULT_TABLE });
const S = {
  keys: Array.from({ length: KEYS }, blankKey),
  engines: DEFAULT_ENGINES, low: DEFAULT_LOW,
  cur: 0, // the key on screen (its place, 0..24): the knobs edit it
  lastIn: [0, 6, 12, 18], // each engine's last key, for its tab
  locks: [[], [], [], []], // each engine's knobs with a closed padlock (ids; 'out.pan' etc. for the output's)
  rand: { alter: 10, wild: false, source: 'free' },
  ccMap: null, // CC number -> target; null: the Bass Station 2 map
  fx: structuredClone(FX_DEFAULTS),
  engLevel: [100, 100, 100, 100], // each engine's level (0..127), from the Bass Station 2's oscillator level knobs
  view: 'synth', preset: { id: null, name: '' }, fresh: true,
};
// a key as stored or imported, checked and tidied (null: not a key)
const cleanName = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 .+#-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
const cleanLabel = (s) => String(s ?? '').replace(/[^a-z0-9 .+-]/gi, '').slice(0, 24); // (shown as HTML)
const num = (x, lo, hi, d) => { const v = Number(x); return Number.isFinite(v) ? clamp(v, lo, hi) : d; };
function tidyKey(k) {
  if (!k || typeof k !== 'object') return blankKey();
  const o = {}; if (k.o && typeof k.o === 'object') for (const id in k.o) if (BY_ID[id] && typeof k.o[id] === 'number') o[id] = clampN(BY_ID[id], k.o[id]);
  const out = k.out || {};
  return { p: fullParams(k.p), t: tidyT(k.t), name: cleanName(k.name), type: TYPE_IDS.includes(k.type) ? k.type : '', from: cleanLabel(k.from) || 'base', o,
    home: k.home && typeof k.home === 'object' ? fullParams(k.home) : null, lock: !!k.lock,
    out: { level: num(out.level, 0, 1, OUT_DEFAULT.level), pan: num(out.pan, -1, 1, 0), send: num(out.send, 0, 1, 0), trim: num(out.trim, -16, 12, 0) } };
}
const FX_MAX = { dirt: { on: 1, pregain: 48, cutoff: 127, swap: 1, xover: 1, gain: 127, clip: 1, bass: 24, tone: 127, dirty: 127, clean: 127, sc: 1, src: 4, scfilt: 2, freq: 127, sens: 127, decay: 127, dir: 1, target: 2 },
  master: { level: 100 } };
function tidyFx(fx) {
  const o = structuredClone(FX_DEFAULTS);
  for (const k in FX_MAX) for (const f in FX_MAX[k]) if (fx && fx[k] && Number.isFinite(Number(fx[k][f]))) o[k][f] = clamp(Math.round(Number(fx[k][f])), 0, FX_MAX[k][f]);
  return o;
}
try {
  const d = JSON.parse(localStorage.getItem(STORE));
  if (d && d.v === 1 && Array.isArray(d.keys)) {
    S.keys = Array.from({ length: KEYS }, (_, i) => tidyKey(d.keys[i]));
    S.engines = clamp(d.engines | 0, 1, MAX_ENGINES); S.low = clamp(d.low | 0, 0, 103); S.cur = clamp(d.cur | 0, 0, KEYS - 1);
    if (Array.isArray(d.lastIn)) S.lastIn = [0, 1, 2, 3].map((e) => clamp(d.lastIn[e] | 0, 0, KEYS - 1));
    if (Array.isArray(d.locks)) S.locks = [0, 1, 2, 3].map((e) => (Array.isArray(d.locks[e]) ? d.locks[e].filter((id) => BY_ID[id] || /^out\.(pan|send|level)$/.test(id) || /^tbl\.[ab]$/.test(id)) : []));
    if (d.rand) S.rand = { alter: clamp(d.rand.alter | 0, 1, 100) || 10, wild: !!d.rand.wild, source: ['library', 'breed', 'morph', 'style', 'free', 'recipe'].includes(d.rand.source) ? d.rand.source : 'free' };
    S.ccMap = d.ccMap && typeof d.ccMap === 'object' ? d.ccMap : null;
    S.fx = tidyFx(d.fx); S.fx.tempo = { bpm: clamp(d.fx?.tempo?.bpm | 0, 40, 240) || 120, ret: clamp(d.fx?.tempo?.ret ?? 2, 0, 4) };
    if (Array.isArray(d.engLevel)) S.engLevel = [0, 1, 2, 3].map((e) => clamp(d.engLevel[e] ?? 100, 0, 127));
    S.view = d.view === 'fx' ? 'fx' : 'synth';
    if (d.preset && typeof d.preset.name === 'string') S.preset = { id: typeof d.preset.id === 'string' ? d.preset.id : null, name: d.preset.name };
    S.fresh = false;
  }
} catch (e) { /* first visit, or storage blocked */ }
let saveT = 0;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, keys: S.keys, engines: S.engines, low: S.low, cur: S.cur, lastIn: S.lastIn, locks: S.locks, rand: S.rand, ccMap: S.ccMap, fx: S.fx, engLevel: S.engLevel, view: S.view, preset: S.preset })); } catch (e) { /* not kept */ }
    drawPreset();
  }, 300);
};

// the layout: places 0..24 from LOW KEY up; each place's engine
const engOf = (place) => engineOf(place, S.engines);
const zone = (e) => zoneOf(e, S.engines);
const noteOf = (place) => S.low + place;
const keyName = (place) => `${ENG(engOf(place))} ${noteName(noteOf(place))}`;
const K = () => S.keys[S.cur];
const engineGain = (e) => S.engLevel[e] / 100;

// ---------------------------------------------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------------------------------------------
let ctx = null, node = null, heard = 0, audioError = '';
const send = (m) => { if (node) node.port.postMessage(m); };
async function startAudio() {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('../sound/worklet.js?v=mwm7rfj6', import.meta.url));
  node = new AudioWorkletNode(ctx, 'metamorf', { numberOfInputs: 0, outputChannelCount: [2] });
  WT.attach((m) => send(m), () => drawKnobs());
  node.port.onmessage = (e) => { if (e.data.type === 'peaks') { heard = Math.max(heard, ...e.data.peaks); showPeaks(e.data.peaks); showSc(e.data.sc || 0); } };
  // (the sound engine failed on the audio thread: say so, rather than play silence)
  node.onprocessorerror = () => { audioError = 'the sound engine stopped'; detail('<em>no sound</em>: the sound engine stopped with an error. Reload the page; if it keeps happening, tell Claude'); };
  node.connect(ctx.destination);
  sendFx(); send({ type: 'engines', n: S.engines }); sendEngineGains(); sendTables();
  if (ctx.state !== 'running') await ctx.resume();
}
// every table the keys name, to the audio thread (each once; until one arrives its notes play BASIC)
const sendTables = () => WT.ensure(S.keys.flatMap((k) => [k.t.a, k.t.b]));
// a key's sound as the engine takes it: its parameters, and its tables by id
const sound = (k) => ({ ...k.p, $a: k.t.a, $b: k.t.b });
const sendFx = () => { send({ type: 'fx', fx: S.fx }); save(); };
const sendEngineGains = () => send({ type: 'egain', gains: [0, 1, 2, 3].map(engineGain) });
// what each engine is playing (its key's place), so a change to that key reaches the note still ringing
const ringing = [-1, -1, -1, -1];
function play(place, vel, { back = false } = {}) {
  const e = engOf(place), k = S.keys[place];
  if (ctx && ctx.state !== 'running') ctx.resume();
  WT.ensure([k.t.a, k.t.b]);
  send({ type: back ? 'back' : 'play', e, params: sound(k), out: k.out, vel });
  ringing[e] = place;
  showLast(place, vel);
  pick(place);
}
// a key's sound or output changed: to the note ringing, if it's this key's
const touch = (place) => { const e = engOf(place); if (ringing[e] === place) send({ type: 'update', e, params: sound(S.keys[place]), out: S.keys[place].out }); };
// the key on screen becomes this one (its engine's tab with it)
function pick(place) {
  const was = engOf(S.cur);
  S.cur = place; S.lastIn[engOf(place)] = place; save();
  if (S.view !== 'synth' || was !== engOf(place)) { S.view = 'synth'; drawView(); }
  drawAll();
}

// ---------------------------------------------------------------------------------------------------------------
// UNDO: every change to the sounds (a knob turned, a randomiser, NEW SOUND, PASTE, CLEAR, ENGINES, a preset, INIT
// PATCH), the last 40, newest first. A whole drag of a knob is one step (merge: the same control again within 1.2 s).
// The effects and the master aren't sounds: only a preset or INIT PATCH (whole) brings them back too
// ---------------------------------------------------------------------------------------------------------------
const undoStack = [];
function snapshot(what, merge, whole) {
  const now = performance.now(), top = undoStack[undoStack.length - 1];
  if (top && merge && top.merge === merge && now - top.t < 1200) { top.t = now; return; }
  undoStack.push({ what, merge, t: now, engines: S.engines, keys: structuredClone(S.keys), ...(whole ? { fx: structuredClone(S.fx), preset: { ...S.preset } } : {}) });
  if (undoStack.length > 40) undoStack.shift();
  drawUndo();
}
function drawUndo() {
  const b = $('undo'), top = undoStack[undoStack.length - 1];
  b.disabled = !top; b.title = top ? `Take back: ${top.what} (Z, or Cmd+Z / Ctrl+Z); ${undoStack.length} step${undoStack.length === 1 ? '' : 's'} kept` : 'Nothing to take back yet';
}
function undo() {
  const u = undoStack.pop();
  if (!u) { detail('nothing to undo'); return; }
  if (!u.fx) S.keys.forEach((k, i) => { if (k.lock) u.keys[i] = k; }); // a key locked now stays as it is
  S.keys = u.keys;
  if (u.engines !== S.engines) showEngines(u.engines);
  if (u.fx) { applyFx(u.fx); S.preset = u.preset; drawPreset(); }
  save(); drawUndo(); drawAll(); touch(S.cur);
  detail(`undone: <em>${u.what}</em>${undoStack.length ? ` · ${undoStack.length} more` : ''}`);
}
$('undo').addEventListener('click', undo);

// ---------------------------------------------------------------------------------------------------------------
// editing the key on screen
// ---------------------------------------------------------------------------------------------------------------
const lockedMsg = () => detail(`${keyName(S.cur)} is locked: <em>LOCK KEY</em> (L) unlocks it`);
// a control changed by hand: the value it had is kept (o), so its label lights, the notch shows where it was, and a
// double-click puts it back. Turned back to that value, it's no longer an edit. ALTER's home starts again from here
function editParam(id, v) {
  const k = K(); if (k.lock) { lockedMsg(); drawKnobs(); return; }
  snapshot(`${keyName(S.cur)} ${BY_ID[id].sec.toUpperCase()} ${BY_ID[id].label.toUpperCase()}`, `p/${S.cur}/${id}`);
  if (!(id in k.o)) k.o[id] = k.p[id];
  k.p[id] = v; if (k.o[id] === v) delete k.o[id];
  k.home = null;
  touch(S.cur); save(); drawStrip(); drawKeyHead();
}
function editOut(f, v) {
  const k = K(); if (k.lock) { lockedMsg(); drawKnobs(); return; }
  snapshot(`${keyName(S.cur)} ${f.toUpperCase()}`, `o/${S.cur}/${f}`);
  k.out[f] = v; touch(S.cur); save();
}
const editCount = (k) => Object.keys(k.o).length;

// ---------------------------------------------------------------------------------------------------------------
// MIDI: notes and knobs on channel 1
// ---------------------------------------------------------------------------------------------------------------
function midiStatus(text, live) { const el = $('midi-status'); el.textContent = text; el.classList.toggle('live', !!live); el.title = text; }
function onMidi(e) {
  const [st, a, b] = e.data, ch = (st & 0x0f) + 1, kind = st & 0xf0;
  if (kind === 0xb0) { if (ch === 1) onCC(a, b); return; }
  if (kind === 0x80 || (kind === 0x90 && !b)) { if (ch === 1) noteOff(a); return; }
  if (kind === 0x90) noteOn(ch, a, b);
}
// each engine is mono, last-note priority: the keys held in its zone, oldest first. A new key takes over; letting go
// of the newest while an earlier one is still held brings that one back on the next step of the BPM grid (RETURN).
// The zones don't affect each other
const held = [[], [], [], []];
function keyDown(place, vel) {
  const st = held[engOf(place)], i = st.findIndex((k) => k.place === place);
  if (i >= 0) st.splice(i, 1);
  st.push({ place, vel });
  play(place, vel);
}
function noteOff(note) {
  const place = note - S.low; if (place < 0 || place >= KEYS) return;
  const e = engOf(place), st = held[e], i = st.findIndex((k) => k.place === place);
  if (i < 0) return;
  st.splice(i, 1);
  if (i < st.length) return; // not the newest key: the zone stays on the newest
  if (!st.length) { send({ type: 'release', e }); return; }
  const prev = st[st.length - 1];
  play(prev.place, prev.vel, { back: true });
}
function allOff() { held.forEach((st, e) => { if (st.length) { st.length = 0; send({ type: 'release', e }); } }); }
function noteOn(ch, note, vel) {
  if (ch !== 1) { showLastText(`CH ${ch} · ${noteName(note)} · only channel 1 plays`); return; }
  const place = note - S.low;
  if (place < 0 || place >= KEYS) { showLastText(`${noteName(note)} #${note} · outside the keys (${noteName(S.low)}-${noteName(S.low + KEYS - 1)})`); return; }
  keyDown(place, vel);
}
async function startMidi() {
  if (!navigator.requestMIDIAccess) { midiStatus('MIDI: not in this browser (use Chrome or Edge)'); return; }
  try {
    const midi = await navigator.requestMIDIAccess();
    const hook = () => { const ins = [...midi.inputs.values()]; for (const i of ins) i.onmidimessage = onMidi; midiStatus(ins.length ? 'MIDI: ' + ins.map((i) => i.name).join(', ') : 'MIDI: no input connected', ins.length); };
    midi.onstatechange = hook; hook();
  } catch (err) { midiStatus('MIDI: permission refused'); }
}
// ---- hardware knobs: CCs on channel 1, acting on the last key played. The default map suits a Bass Station 2 (its
// published CC numbers); LEARN maps any knob. A target: { t: 'par', id } | { t: 'out', k } | { t: 'elevel', e } ----
const CC_DEFAULT = {
  16: { t: 'par', id: 'cutoff', name: 'filter freq' }, 82: { t: 'par', id: 'reso', name: 'resonance' }, 114: { t: 'par', id: 'drive', name: 'overdrive' },
  90: { t: 'par', id: 'attack', name: 'amp attack' }, 91: { t: 'par', id: 'decay', name: 'amp decay' },
  85: { t: 'par', id: 'p_amt', name: 'mod env depth' }, 103: { t: 'par', id: 'p_decay', name: 'mod env decay' }, 94: { t: 'par', id: 'fm_ab', name: 'distortion' },
  27: { t: 'par', id: 'a_tune', name: 'osc 1 coarse' }, 26: { t: 'par', id: 'a_fine', name: 'osc 1 fine' },
  18: { t: 'par', id: 'f_morph', name: 'lfo 1 speed' }, 5: { t: 'out', k: 'send', name: 'portamento' },
  20: { t: 'elevel', e: 0, name: 'osc 1 level' }, 21: { t: 'elevel', e: 1, name: 'osc 2 level' }, 22: { t: 'elevel', e: 2, name: 'sub osc level' },
};
// the engine's parts a knob of the map waits for, until they are built
const LATER = { cutoff: 'the filter', reso: 'the filter', f_morph: 'the filter' };
const ccMap = () => S.ccMap || CC_DEFAULT;
const OUT_NAMES = { send: 'reverb send', pan: 'pan', level: 'level' };
const ccTargetName = (t) => (t.t === 'par' ? (BY_ID[t.id] ? `${BY_ID[t.id].sec} ${BY_ID[t.id].label}` : t.id) : t.t === 'out' ? OUT_NAMES[t.k] : t.t === 'randkey' ? 'new sound on the key' : `${ENG(t.e).toLowerCase()} level`);
const ccHeld = {};
let learn = null; // null, { armed: true } waiting for a control, then { target } waiting for a knob
let ccDraw = 0;
function onCC(cc, val) {
  if (cc === 120 || cc === 123) { allOff(); return; }
  if (learn && learn.target) {
    S.ccMap = { ...ccMap() };
    for (const c in S.ccMap) if (JSON.stringify(S.ccMap[c]) === JSON.stringify(learn.target)) delete S.ccMap[c]; // one knob per control
    S.ccMap[cc] = learn.target; save();
    showLastText(`CC${cc} → ${ccTargetName(learn.target).toUpperCase()}`); setLearn(null); return;
  }
  const t = ccMap()[cc];
  if (!t) { showLastText(`CC${cc} ${val} · not mapped (LEARN maps it)`); return; }
  let text;
  if (t.t === 'randkey') { const up = val >= 64, was = ccHeld[cc]; ccHeld[cc] = up; if (up && !was) randKey(); return; }
  if (t.t === 'elevel') { S.engLevel[t.e] = val; sendEngineGains(); save(); text = `${ENG(t.e)} LEVEL ${val}`; }
  else if (t.t === 'out') {
    const v = t.k === 'pan' ? (Math.abs(val - 64) <= 1 ? 0 : (val - 64) / 63) : val / 127;
    editOut(t.k, clamp(v, t.k === 'pan' ? -1 : 0, 1)); text = `${keyName(S.cur)} ${OUT_NAMES[t.k]} ${t.k === 'pan' ? panText(K().out.pan) : t.k === 'send' ? sendText(K().out.send) : levelText(K().out.level)}`;
  } else {
    const p = BY_ID[t.id];
    if (!p) { showLastText(`CC${cc} · ${(t.name || t.id).toUpperCase()} waits for ${LATER[t.id] || 'a part not built yet'}`); return; }
    const v = isBip(p) ? (Math.abs(val - 64) <= 1 ? 0 : clamp((val - 64) / 63, -1, 1)) : val / 127;
    editParam(p.id, v); text = `${keyName(S.cur)} ${p.label} ${showValue(p, v)}`;
  }
  showLastText(`CC${cc} · ${text.toUpperCase()}`);
  if (!ccDraw) ccDraw = requestAnimationFrame(() => { ccDraw = 0; drawKnobs(); });
}
function setLearn(l) {
  learn = l; $('learn').setAttribute('aria-pressed', !!l); document.body.classList.toggle('learning', !!l);
  if (l && !l.target) detail('LEARN: click a control on screen, then turn a knob (Esc cancels)');
  else if (l) detail(`LEARN: now turn a knob for <em>${ccTargetName(l.target)}</em>`);
}
$('learn').addEventListener('click', () => { setLearn(learn ? null : { armed: true }); if (learn) openSettings(false); });
$('cc-reset').addEventListener('click', () => { S.ccMap = null; save(); setLearn(null); detail('knobs: back to the Bass Station 2 map'); });
document.addEventListener('pointerdown', (e) => {
  if (!learn) return;
  const el = e.target.closest('[data-learn]'); if (!el) return;
  e.stopPropagation(); setLearn({ target: JSON.parse(el.dataset.learn) });
}, true);

// ---------------------------------------------------------------------------------------------------------------
// the top bar's boxes, the meters, the message line
// ---------------------------------------------------------------------------------------------------------------
const detail = (html) => { $('detail').innerHTML = html; };
let lastT = 0;
function showLastText(t) { $('last-text').textContent = t; const box = $('last'); box.classList.add('hit'); clearTimeout(lastT); lastT = setTimeout(() => box.classList.remove('hit'), 90); }
const showLast = (place, vel) => showLastText(`${keyName(place)} #${noteOf(place)} · V${vel}`);
function flash(e) { const led = engBtns[e]?.querySelector('i'); if (!led) return; led.classList.add('on'); clearTimeout(led._t); led._t = setTimeout(() => led.classList.remove('on'), 90); }
const showPeaks = (peaks) => peaks.forEach((p, e) => { if (p > 0.02) flash(e); });
let scShown = 0;
function showSc(v) { scShown = Math.max(v, scShown * 0.8); const n = Math.round(Math.min(1, scShown) * 12); document.querySelectorAll('.envm .segs i').forEach((x, i) => x.classList.toggle('on', i < n)); }

// ---------------------------------------------------------------------------------------------------------------
// the engine bar: a tab for each engine (under its keys on the strip), and FX + MASTER (F)
// ---------------------------------------------------------------------------------------------------------------
const engBtns = [0, 1, 2, 3].map((e) => {
  const b = document.createElement('button'); b.className = 'btn snd'; b.type = 'button'; b.setAttribute('role', 'tab');
  b.innerHTML = `<i></i><span>${ENG(e)}</span><span class="ch"></span>`;
  b.addEventListener('click', () => { S.view = 'synth'; pick(S.lastIn[e] >= zone(e).lo && S.lastIn[e] <= zone(e).hi ? S.lastIn[e] : zone(e).lo); });
  $('sounds').insertBefore(b, $('fx-tab')); return b;
});
function drawView() {
  const fx = S.view === 'fx';
  $('fxside').hidden = !fx; document.querySelector('.editor').hidden = fx;
  engBtns.forEach((b, e) => b.setAttribute('aria-selected', !fx && e === engOf(S.cur)));
  $('fx-tab').setAttribute('aria-selected', fx);
}
$('fx-tab').addEventListener('click', () => { S.view = S.view === 'fx' ? 'synth' : 'fx'; save(); drawView(); });

// ---------------------------------------------------------------------------------------------------------------
// the knob grid: the key's sound, section by section, on one grid of equal cells (one knob to a cell), every knob
// lined up with the ones above and below. The last two columns are the key's own: its FX SEND in row 1, its big
// LEVEL under it. Rules sit on cell edges
// ---------------------------------------------------------------------------------------------------------------
const GRID_COLS = 13, GRID_ROWS = 4;
// (as docs/SPEC.md lays out the whole voice: FILTER 1, MOD ENV, FILTER 2 and LFO join in build steps 5 to 7)
const ROWS = [['osc a', 'osc b', 'fm'], ['noise', 'click', 'pitch env', 'drive'], ['amp'], ['output']];
// a part at zero is greyed (its knobs still turn); FM is off when both its amounts are
const PART_GATE = { 'osc a': ['a_level'], 'osc b': ['b_level'], fm: ['fm_ab', 'fm_ba'], noise: ['n_level'], click: ['c_level'], 'pitch env': ['p_amt'], drive: ['drive'] };
let knobDraws = [];
const drawKnobs = () => knobDraws.forEach((d) => d());
const locked = (e, id) => S.locks[e].includes(id);
function toggleLock(id, label) {
  const e = engOf(S.cur), on = !locked(e, id);
  S.locks[e] = on ? [...S.locks[e], id] : S.locks[e].filter((x) => x !== id); save(); drawLocks();
  detail(on ? `${ENG(e)} ${label} <em>locked</em>: the randomisers leave it as it is, on every key of the engine` : `${ENG(e)} ${label} <em>unlocked</em>`);
}
// POSITION: BASIC's shapes by name, any other table as how far through it
const POS_OF = { a_pos: 'a', b_pos: 'b' };
const showParam = (p, v) => (POS_OF[p.id] && K().t[POS_OF[p.id]] !== WT.DEFAULT_TABLE ? Math.round(v * 100) + '%' : showValue(p, v));
function paramKnob(p) {
  return knob({ label: p.label, min: isBip(p) ? -1 : 0, max: 1, centre: isBip(p) ? 0 : undefined,
    get: () => K().p[p.id], show: (v) => showParam(p, v), was: () => K().o[p.id], lit: () => p.id in K().o,
    set: (v) => { editParam(p.id, v); detail(`${keyName(S.cur)} ${p.sec.toUpperCase()} ${p.label.toUpperCase()} <em>${showParam(p, v)}</em>${p.id === 'c_direct' ? ' · the click skips the filters by this much once they arrive (build step 5)' : ''}`); drawGates(); },
    reset: () => { const w = K().o[p.id]; if (K().lock) lockedMsg(); else if (w !== undefined) { editParam(p.id, w); detail(`${keyName(S.cur)} ${p.label.toUpperCase()} back to <em>${showParam(p, w)}</em>`); drawGates(); } },
    lock: { get: () => locked(engOf(S.cur), p.id), toggle: () => toggleLock(p.id, `${p.sec.toUpperCase()} ${p.label.toUpperCase()}`) },
    learn: { t: 'par', id: p.id } });
}
// TABLE: which wavetable an oscillator reads, stepping through the built-ins and then the user's own. Not a hand edit
// with a notch (it's a reference, not a value); UNDO takes it back. A missing one reads MISSING (and plays BASIC)
const tblLabel = (o) => `OSC ${o.toUpperCase()} TABLE`;
function editTable(o, id) {
  const k = K(); if (k.lock) { lockedMsg(); drawKnobs(); return; }
  snapshot(`${keyName(S.cur)} ${tblLabel(o)}`, `t/${S.cur}/${o}`);
  k.t[o] = id; WT.ensure([id]); touch(S.cur); save(); drawStrip(); drawKeyHead(); drawKnobs();
}
function tableKnob(o) {
  const ids = () => { const l = WT.tableIds(); return WT.known(K().t[o]) ? l : [...l, K().t[o]]; };
  return knob({ label: 'table', min: 0, max: 1, step: 0,
    get: () => { const l = ids(); return l.length > 1 ? l.indexOf(K().t[o]) / (l.length - 1) : 0; },
    show: () => WT.tableName(K().t[o]),
    set: (v) => { const l = ids(), id = l[Math.round(v * (l.length - 1))]; if (id !== K().t[o]) { editTable(o, id); detail(`${keyName(S.cur)} ${tblLabel(o)} <em>${WT.tableName(id)}</em>${WT.isUser(id) ? ' (your own)' : ''}`); } },
    reset: () => { if (K().lock) lockedMsg(); else if (K().t[o] !== WT.DEFAULT_TABLE) { editTable(o, WT.DEFAULT_TABLE); detail(`${keyName(S.cur)} ${tblLabel(o)} back to <em>BASIC</em>`); } },
    lock: { get: () => locked(engOf(S.cur), 'tbl.' + o), toggle: () => toggleLock('tbl.' + o, tblLabel(o)) } });
}
const OUT_KNOBS = {
  pan: { label: 'pan', min: -1, max: 1, centre: 0, lr: true, show: panText, dflt: 0 },
  send: { label: 'reverb', min: 0, max: 1, show: sendText, dflt: 0 },
  level: { label: 'level', min: 0, max: 1, show: levelText, dflt: OUT_DEFAULT.level },
};
function outKnob(f) {
  const d = OUT_KNOBS[f];
  return knob({ ...d, get: () => K().out[f],
    set: (v) => { editOut(f, v); detail(`${keyName(S.cur)} ${d.label.toUpperCase()} <em>${d.show(v)}</em>${f === 'send' ? ' · the reverb arrives in build step 8' : ''}`); },
    reset: () => { if (K().lock) lockedMsg(); else editOut(f, d.dflt); },
    lock: { get: () => locked(engOf(S.cur), 'out.' + f), toggle: () => toggleLock('out.' + f, d.label.toUpperCase()) },
    learn: { t: 'out', k: f } });
}
let gateDraws = [];
const drawGates = () => gateDraws.forEach((d) => d());
function buildKnobs() {
  const box = $('faders'); box.innerHTML = ''; knobDraws = []; gateDraws = [];
  box.style.setProperty('--cols', GRID_COLS + 2); box.style.setProperty('--rows', GRID_ROWS);
  const cell = (el, r0, r1, c0, c1) => { el.style.gridArea = `${r0} / ${c0} / ${r1} / ${c1}`; return el; };
  for (let r = 0; r < GRID_ROWS; r++) {
    let col = 1;
    const sect = (n, cls) => { const el = document.createElement('div'); el.className = 'sect' + (cls || '') + (r ? ' rt' : '') + (col > 1 ? ' sep' : ''); el.style.setProperty('--n', n); cell(el, r + 1, r + 2, col, col + n); col += n; box.append(el); return el; };
    for (const sec of ROWS[r] || []) {
      const tbl = { 'osc a': 'a', 'osc b': 'b' }[sec];
      const list = sec === 'output' ? ['pan'] : [...(tbl ? ['table'] : []), ...PARAMS.filter((p) => p.sec === sec)];
      const el = sect(list.length);
      el.innerHTML = `<h3>${sec}</h3><div class="row"></div>`;
      for (const p of list) { const k = sec === 'output' ? outKnob(p) : p === 'table' ? tableKnob(tbl) : paramKnob(p); el.querySelector('.row').append(k.el); knobDraws.push(k.draw); }
      const g = PART_GATE[sec]; if (g) { const d = () => el.classList.toggle('off', g.every((id) => !K().p[id])); gateDraws.push(d); knobDraws.push(d); }
    }
    if (col <= GRID_COLS) sect(GRID_COLS + 1 - col, ' fill');
  }
  const sends = cell(document.createElement('div'), 1, 2, GRID_COLS + 1, GRID_COLS + 3); sends.className = 'sect sends sep'; sends.style.setProperty('--n', 2);
  sends.innerHTML = '<h3>fx send</h3><div class="row"></div>';
  { const k = outKnob('send'); sends.querySelector('.row').append(k.el); knobDraws.push(k.draw); }
  box.append(sends);
  const big = outKnob('level'); cell(big.el, 2, GRID_ROWS + 1, GRID_COLS + 1, GRID_COLS + 3); big.el.classList.add('big', 'rt', 'sep'); box.append(big.el); knobDraws.push(big.draw);
  drawKnobs();
}

// ---------------------------------------------------------------------------------------------------------------
// the key panel: the key, what it plays, the strip of all 25 keys, its buttons and MAKE THIS KEY
// ---------------------------------------------------------------------------------------------------------------
const missing = (k) => (!WT.known(k.t.a) && k.p.a_level > 0) || (!WT.known(k.t.b) && k.p.b_level > 0);
function whatText(k) {
  const n = editCount(k), edits = n ? ` · ${n} edit${n === 1 ? '' : 's'}` : '', gone = missing(k) ? ' · table missing' : '';
  if (k.from === 'base') return `the base sound${edits}${gone}`;
  return `${k.name || 'unnamed'} · ${k.type || k.from}${edits}${gone}`;
}
function drawKeyHead() {
  const k = K(), place = S.cur, note = noteOf(place);
  $('kh-note').textContent = noteName(note); $('kh-num').textContent = '#' + note;
  $('kh-engine').textContent = ENG(engOf(place)); $('kh-info').textContent = (k.lock ? 'locked · ' : '') + whatText(k);
  $('lock-key').setAttribute('aria-pressed', k.lock); $('lock-key').querySelector('span').textContent = k.lock ? 'LOCKED' : 'LOCK KEY';
  diceBtn.disabled = k.lock; $('alter-key').disabled = k.lock; $('paste-key').disabled = k.lock || !clip; $('clear-key').disabled = k.lock || k.from === 'base' && !editCount(k);
  for (const b of $('make').querySelectorAll('.btn')) b.disabled = k.lock;
  $('screen').classList.toggle('keylocked', k.lock);
}
const stripKeys = [];
function buildStrip() {
  const box = $('keystrip'); box.innerHTML = ''; stripKeys.length = 0;
  for (let e = 0; e < S.engines; e++) {
    const z = zone(e), g = document.createElement('div'); g.className = 'kgroup';
    g.innerHTML = `<span class="kz">${ENG(e)}</span><div class="keys"></div>`;
    for (let place = z.lo; place <= z.hi; place++) {
      const k = document.createElement('button'); k.type = 'button'; k.tabIndex = -1;
      k.className = 'k' + ([1, 3, 6, 8, 10].includes(noteOf(place) % 12) ? ' blk' : '');
      k.innerHTML = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>';
      let down = false;
      k.addEventListener('pointerdown', (ev) => { if (ev.button) return; try { k.setPointerCapture(ev.pointerId); } catch (err) { /* gone */ } down = true; startAudio().then(() => keyDown(place, 100)); });
      const up = () => { if (down) { down = false; noteOff(noteOf(place)); } };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) k.addEventListener(ev, up);
      g.querySelector('.keys').append(k); stripKeys.push({ k, place });
    }
    box.append(g);
  }
}
function drawStrip() {
  for (const { k, place } of stripKeys) {
    const key = S.keys[place];
    k.classList.toggle('sel', place === S.cur); k.classList.toggle('locked', key.lock); k.classList.toggle('own', editCount(key) > 0 && !key.lock);
    k.title = `${keyName(place)} #${noteOf(place)} · ${whatText(key)}${key.lock ? ' · locked' : ''}`;
  }
  drawPhone();
}
function drawAll() { drawKeyHead(); drawStrip(); drawKnobs(); drawView(); }
// ---- the key's buttons: NEW SOUND (the dice, K), ALTER KEY (A), LOCK KEY (L), COPY, PASTE, CLEAR ----
const diceBtn = document.createElement('button');
diceBtn.type = 'button'; diceBtn.className = 'dicebtn'; diceBtn.id = 'rand-key'; diceBtn.tabIndex = -1;
diceBtn.setAttribute('aria-label', 'New sound on this key'); diceBtn.innerHTML = `<span class="die">${DIE_SVG}</span>`;
$('pv-die').innerHTML = DIE_SVG;
$('keyacts').prepend(diceBtn);
const rollDice = makeDice([diceBtn, $('pv-dice')]);
diceBtn.addEventListener('click', () => { if (!learn) randKey(); });
diceBtn.dataset.learn = JSON.stringify({ t: 'randkey' });
function lockKey() {
  const k = K(); k.lock = !k.lock; save(); drawAll();
  detail(`${keyName(S.cur)}: ${k.lock ? 'locked, nothing changes it now' : 'unlocked'}`);
}
$('lock-key').addEventListener('click', lockKey);
$('alter-key').addEventListener('click', () => alterKey());
let clip = null;
function copyKey() {
  const k = K(); clip = structuredClone({ p: k.p, t: k.t, name: k.name, type: k.type, from: k.from });
  $('paste-key').disabled = K().lock; $('paste-key').title = `Paste ${clip.name || 'the base sound'} onto this key (Cmd+V / Ctrl+V)`;
  detail(`copied <em>${keyName(S.cur)}</em> · pick a key and paste (Cmd+V / Ctrl+V)`);
}
function pasteKey() {
  if (!clip) { detail('nothing copied yet: COPY (Cmd+C / Ctrl+C) a key first'); return; }
  if (K().lock) { lockedMsg(); return; }
  const place = S.cur;
  change(`PASTE ${keyName(place)}`, () => { const k = S.keys[place]; Object.assign(k, structuredClone(clip), { o: {}, home: null }); },
    `pasted <em>${clip.name || 'the base sound'}</em> onto ${keyName(place)} · UNDO takes it back`, place);
}
function clearKey() {
  if (K().lock) { lockedMsg(); return; }
  const place = S.cur;
  change(`CLEAR ${keyName(place)}`, () => { Object.assign(S.keys[place], { p: { ...BASE }, t: baseTables(), name: '', type: '', from: 'base', o: {}, home: null }); }, `${keyName(place)}: back to the base sound`, place);
}
$('copy-key').addEventListener('click', copyKey);
$('paste-key').addEventListener('click', pasteKey);
$('clear-key').addEventListener('click', clearKey);
// MAKE THIS KEY: a sound of a type on the key on screen, a new one each press
function buildMake() {
  const el = $('make'); el.innerHTML = '<span class="dim mkl">MAKE<br>THIS<br>KEY</span><div class="mk"></div>';
  for (const [type, text] of [...TYPES, ['', 'ANY']]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.tabIndex = -1; b.textContent = text; b.dataset.type = type;
    b.title = type ? `Make this key a ${type}: a new one each press (UNDO takes it back)` : 'Make this key a sound of any type: a new one each press (UNDO takes it back)';
    b.addEventListener('click', () => { if (!learn) randKey(type || RECIPE_TYPES[Math.floor(rnd() * RECIPE_TYPES.length)]); });
    el.querySelector('.mk').append(b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the randomisers. Every one keeps locked keys, closed padlocks and each key's send, places pan by the sound's type,
// and says in the message line what it made and what it kept. (Auto level and the dud filter come in build step 9.)
// ---------------------------------------------------------------------------------------------------------------
let rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
const rnd = () => { rngState ^= rngState << 13; rngState >>>= 0; rngState ^= rngState >>> 17; rngState ^= rngState << 5; rngState >>>= 0; return rngState / 4294967296; };
const SOURCES = {
  library: { name: 'LIBRARY', cap: 'A KEPT SOUND AS IT IS', needs: true },
  breed: { name: 'BREED', cap: 'TWO KEPT SOUNDS CROSSED, SECTION BY SECTION', needs: true },
  morph: { name: 'MORPH', cap: 'TWO KEPT SOUNDS BLENDED, 25 TO 75% OF THE WAY', needs: true },
  style: { name: 'STYLE', cap: 'EVERY KNOB FROM A DIFFERENT KEPT SOUND OF THE TYPE', needs: true },
  free: { name: 'FREE', cap: 'EVERY KNOB ANYWHERE IN ITS SAFE RANGE' },
  recipe: { name: 'RECIPE', cap: 'A SOUND OF A TYPE: KICK, TOM, SNARE, CLAP, HATS …' },
};
const source = () => (SOURCES[S.rand.source] && !SOURCES[S.rand.source].needs ? S.rand.source : 'free');
function drawSource() {
  const src = source();
  for (const b of document.querySelectorAll('.srcrow .btn')) {
    const d = SOURCES[b.dataset.src]; b.setAttribute('aria-pressed', b.dataset.src === src); b.disabled = !!d.needs;
    b.title = d.needs ? `${d.cap.toLowerCase()}: needs kept sounds (the RATE tab comes in build step 10)` : d.cap.toLowerCase();
  }
  $('src-cap').textContent = SOURCES[src].cap;
  diceBtn.title = `NEW SOUND (K): a new ${SOURCES[src].name.toLowerCase()} sound on this key only. UNDO takes it back; LEARN can put it on a button`;
}
for (const b of document.querySelectorAll('.srcrow .btn')) b.addEventListener('click', () => { S.rand.source = b.dataset.src; save(); drawSource(); detail(`NEW SOUNDS FROM <em>${SOURCES[source()].name}</em>: ${SOURCES[source()].cap.toLowerCase()}`); });
// a new sound: { p, name, type, from }
function newSound(type) {
  const src = type ? 'recipe' : source(), t = type || (src === 'recipe' ? RECIPE_TYPES[Math.floor(rnd() * RECIPE_TYPES.length)] : '');
  const p = t ? recipe(rnd, t) : free(rnd);
  return { p, t: pickTables(rnd, t, p), name: presetName(rnd), type: t, from: t ? 'recipe' : 'free' };
}
// a new sound onto a key: its locked knobs keep what the key had, its send stays, its pan follows the type
function deal(place, s) {
  const k = S.keys[place], e = engOf(place), keep = S.locks[e];
  const p = { ...s.p }; for (const id of keep) if (BY_ID[id]) p[id] = k.p[id];
  const t = { a: keep.includes('tbl.a') ? k.t.a : s.t.a, b: keep.includes('tbl.b') ? k.t.b : s.t.b };
  Object.assign(k, { p, t, name: s.name, type: s.type, from: s.from, o: {}, home: null });
  if (!keep.includes('out.pan')) { const r = panRange(s.type); k.out.pan = Math.round((rnd() * 2 - 1) * r * 100) / 100; }
}
const keptNote = (engines) => {
  const names = [...new Set(engines.flatMap((e) => S.locks[e]).map((id) => (BY_ID[id] ? `${BY_ID[id].sec} ${BY_ID[id].label}` : id.startsWith('tbl.') ? `osc ${id.slice(4)} table` : id.slice(4)).toUpperCase()))];
  return !names.length ? '' : names.join(', ').length <= 16 ? ` · locked <em>${names.join(', ')}</em> kept` : ` · <em>${names.length} locked knobs</em> kept`;
};
const onEngines = () => Array.from({ length: S.engines }, (_, e) => e);
const placesOf = (e) => { const z = zone(e), o = []; for (let i = z.lo; i <= z.hi; i++) o.push(i); return o; };
// a change to the sounds: one UNDO step, then everything redrawn and said
async function change(what, fn, said, playPlace, whole) {
  await startAudio();
  snapshot(what, undefined, whole);
  fn(); sendTables(); save(); drawAll(); drawLocks(); touch(S.cur);
  detail(said);
  if (playPlace !== undefined) play(playPlace, 100);
}
function randKey(type) {
  const place = S.cur; if (S.keys[place].lock) { lockedMsg(); return; }
  const s = newSound(type); rollDice();
  change(`NEW SOUND ${keyName(place)}`, () => deal(place, s), `${keyName(place)}: <em>${s.name}</em> · ${s.type || s.from}${keptNote([engOf(place)])} (UNDO takes it back)`, place);
}
function scatter(e) { for (const place of placesOf(e)) if (!S.keys[place].lock) deal(place, newSound()); }
// ALTER: every unlocked knob moved around the key's home (what it was before the first alter since a hand edit) by
// HOW MUCH, inside its safe range (WILD: anywhere), so repeated presses vary one sound instead of drifting away
function alterOne(place) {
  const k = S.keys[place]; if (k.lock) return;
  if (!k.home) k.home = { ...k.p };
  const keep = S.locks[engOf(place)];
  k.p = alter(rnd, k.home, S.rand.alter / 100, S.rand.wild, (id) => keep.includes(id)); k.o = {};
  for (const id of keep) if (BY_ID[id]) k.p[id] = k.home[id];
}
const wildly = () => (S.rand.wild ? ' wild' : '');
function alterKey() {
  const place = S.cur; if (S.keys[place].lock) { lockedMsg(); return; }
  change(`ALTER ${keyName(place)}`, () => alterOne(place), `${keyName(place)} altered <em>${S.rand.alter}%${wildly()}</em>${keptNote([engOf(place)])} (UNDO takes it back)`, place);
}
const curEng = () => engOf(S.cur);
$('scatter').addEventListener('click', () => { const e = curEng(); change(`RANDOM ${ENG(e)}`, () => scatter(e), `${ENG(e)}: a new ${SOURCES[source()].name.toLowerCase()} sound on every key${keptNote([e])}`); });
$('kit-scatter').addEventListener('click', () => change('RANDOM ALL', () => onEngines().forEach(scatter), `all engines: a new ${SOURCES[source()].name.toLowerCase()} sound on every key${keptNote(onEngines())}`));
$('alter').addEventListener('click', () => { const e = curEng(); change(`ALTER ${ENG(e)}`, () => placesOf(e).forEach(alterOne), `${ENG(e)}: every key altered <em>${S.rand.alter}%${wildly()}</em>${keptNote([e])}`); });
$('kit-alter').addEventListener('click', () => change('ALTER ALL', () => onEngines().forEach((e) => placesOf(e).forEach(alterOne)), `all engines: every key altered <em>${S.rand.alter}%${wildly()}</em>${keptNote(onEngines())}`));
const randDraws = [hbar($('rand-bars'), 'ALTER', { min: 1, max: 100, get: () => S.rand.alter, set: (v) => { S.rand.alter = v; save(); }, show: (v) => v + '%', dflt: 10 })];
$('wild').checked = S.rand.wild;
$('wild').addEventListener('change', () => { S.rand.wild = $('wild').checked; save(); });
// ---- INIT PATCH: a new patch in one press. Every key a new sound (locked keys and hand edits too: it asks first when
// a key is locked), 30% of the keys a reverb send (45..95 of 127), BPM back to 120, the distortion and the output
// level back to their starting settings. RETURN, the engine levels and the padlocks stay ----
const INIT_REVERB = 0.3, INIT_SEND = [45, 95];
function initPatch() {
  S.keys.forEach((k) => { k.lock = false; });
  onEngines().forEach(scatter);
  const order = S.keys.map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const wet = new Set(order.slice(0, Math.round(INIT_REVERB * KEYS)));
  S.keys.forEach((k, i) => { if (!locked(engOf(i), 'out.send')) k.out.send = wet.has(i) ? (INIT_SEND[0] + Math.floor(rnd() * (INIT_SEND[1] - INIT_SEND[0] + 1))) / 127 : 0; });
  const d = structuredClone(FX_DEFAULTS); applyFx({ dirt: d.dirt, master: d.master, tempo: { bpm: 120, ret: S.fx.tempo.ret } });
  S.preset = { id: null, name: newName() };
  return S.keys.filter((k) => k.out.send > 0).length;
}
let initArmed = 0;
const lockedKeys = () => S.keys.filter((k) => k.lock).length;
function drawInit() {
  const nl = lockedKeys();
  $('init-patch').setAttribute('aria-pressed', !!initArmed);
  $('init-info').innerHTML = initArmed ? `REPLACES ${nl} LOCKED KEY${nl === 1 ? '' : 'S'}<br>PRESS AGAIN TO GO` : `A NEW SOUND ON EVERY KEY<br>${INIT_REVERB * 100}% REVERB · BPM, FX + MASTER RESET`;
}
function disarmInit() { clearTimeout(initArmed); initArmed = 0; drawInit(); }
$('init-patch').addEventListener('click', () => {
  const nl = lockedKeys();
  if (nl && !initArmed) { initArmed = setTimeout(disarmInit, 4000); drawInit(); detail(`INIT PATCH replaces every key, the <em>${nl} locked</em> too: press it again to go ahead`); return; }
  disarmInit();
  let n = 0;
  change('INIT PATCH', () => { n = initPatch(); }, '', undefined, true).then(() => { drawPreset(); detail(`new patch <em>${S.preset.name}</em>: reverb send on ${n} keys · BPM, FX, master reset${keptNote(onEngines())}`); });
});
// ---- the knob padlocks: how many are closed, and UNLOCK ALL ----
const lockCount = () => S.locks.reduce((a, l) => a + l.length, 0);
function drawLocks() { const n = lockCount(); $('lock-count').textContent = n ? `${n} LOCKED` : 'NONE LOCKED'; $('lock-none').disabled = !n; drawKnobs(); }
$('lock-none').addEventListener('click', () => { const n = lockCount(); S.locks = [[], [], [], []]; save(); drawLocks(); detail(`<em>${n}</em> knob${n === 1 ? '' : 's'} unlocked: everything is open to the randomisers again`); });

// ---------------------------------------------------------------------------------------------------------------
// the menus: RANDOM, SETTINGS, PRESET. One open at a time; a press outside or Esc closes them
// ---------------------------------------------------------------------------------------------------------------
function openMenu(open) { $('menu-panel').hidden = !open; $('menu-btn').setAttribute('aria-expanded', open); if (initArmed) disarmInit(); else drawInit(); if (open) { openPresets(false); openSettings(false); $('rand-name').textContent = ENG(curEng()); } }
function openSettings(open) { $('settings-panel').hidden = !open; $('settings-btn').setAttribute('aria-expanded', open); if (open) { openMenu(false); openPresets(false); } }
$('menu-btn').addEventListener('click', () => openMenu($('menu-panel').hidden));
$('settings-btn').addEventListener('click', () => openSettings($('settings-panel').hidden));
document.addEventListener('pointerdown', (e) => {
  if (!$('menu-panel').hidden && !e.target.closest('#menu')) openMenu(false);
  if (!$('preset-panel').hidden && !e.target.closest('#pmenu')) openPresets(false);
  if (!$('settings-panel').hidden && !e.target.closest('#smenu')) openSettings(false);
});
setupColours(detail);

// ---------------------------------------------------------------------------------------------------------------
// FX + MASTER: the master distortion (sound/dirt.js) with its sidechain, and the output level. (The reverb and the
// compressor come in build step 8.)
// ---------------------------------------------------------------------------------------------------------------
const hz = (f) => (f < 1000 ? Math.round(f) + 'Hz' : (f / 1000).toFixed(f < 9950 ? 1 : 0) + 'k');
const sdb = (d) => (d > 0 ? '+' : '') + Math.round(d) + 'dB';
let fxDraws = [];
function applyFx(fx) {
  for (const k of ['dirt', 'master', 'tempo']) if (fx[k]) Object.assign(S.fx[k], fx[k]);
  $('bpm').textContent = S.fx.tempo.bpm; drawRet(); sendFx(); fxDraws.forEach((d) => d());
}
function buildFx() {
  const top = $('fxglobal'); top.innerHTML = ''; fxDraws = [];
  const D = S.fx.dirt, say = (what) => detail(`MASTER DISTORTION ${what}`);
  const gk = (label, o) => { const k = knob({ label, step: 1, min: 0, ...o }); fxDraws.push(k.draw); return k.el; };
  const dk = (k, label, max, show, centre) => gk(label, { max, centre, show: show || String, get: () => D[k], set: (v) => { D[k] = v; sendFx(); say(`${label.toUpperCase()} <em>${show ? show(v) : v}</em>`); }, reset: () => { D[k] = DIRT_DEFAULTS[k]; sendFx(); } });
  const drawDirt = () => dirtSects.forEach(([el, k]) => el.classList.toggle('off', !D[k]));
  const cycle = (b, k, names, label, lit = true) => {
    const draw = () => { b.textContent = names[D[k]] ?? names[0]; if (lit) b.setAttribute('aria-pressed', D[k] > 0); };
    b.addEventListener('click', () => { D[k] = (D[k] + 1) % names.length; sendFx(); draw(); drawDirt(); say(`${label ? label + ' ' : ''}<em>${names[D[k]]}</em>`); });
    fxDraws.push(draw); return b;
  };
  const sw = (k, label, names, title) => {
    const el = document.createElement('div'); el.className = 'vf vsw';
    el.innerHTML = '<output></output><button class="swb" type="button" tabindex="-1"></button><span class="lab"></span>';
    el.querySelector('.lab').textContent = label; el.querySelector('.swb').title = title;
    cycle(el.querySelector('.swb'), k, names, label.toUpperCase()); return el;
  };
  const hbtn = (k, names, label, title) => { const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.className = 'btn sm hdb'; b.title = title; return cycle(b, k, names, label, names[0] === 'OFF'); };
  const sect = (n, rows) => {
    const el = document.createElement('div'); el.className = 'sect dirt'; el.style.setProperty('--n', n); el.innerHTML = '<h3></h3>';
    for (const items of rows) { const r = document.createElement('div'); r.className = 'row'; r.append(...items); el.append(r); }
    return el;
  };
  const col = (h) => { const c = document.createElement('div'); c.className = 'fxcol'; c.innerHTML = `<h2>${h}</h2>`; top.append(c); return c; };
  const c1 = col('MASTER <span class="dim">EVERYTHING GOES THROUGH</span>'), c2 = col('&nbsp;');
  const dist = sect(6, [
    [dk('pregain', 'pregain', 48, (v) => sdb(pregainDb(v)), 24), dk('cutoff', 'cutoff', 127, (v) => hz(dirtHz(v))),
      sw('swap', 'filter', ['HP', 'LP'], 'The filter before the distortion: high-pass (the lows stay out of it) or low-pass'),
      sw('xover', 'xover', ['OFF', 'ON'], 'Crossover: the half the filter takes away goes to the clean path'),
      dk('gain', 'gain', 127), sw('clip', 'clip', ['DIODE', 'LED'], 'Clipping: diodes clip early and hard; LEDs later, louder and more open')],
    [dk('bass', 'bass', 24, (v) => sdb(bassDb(v)), 12), dk('tone', 'tone', 127, (v) => (v === 64 ? 'scoop' : (v > 64 ? '+' : '') + (v - 64)), 64),
      dk('dirty', 'dirty', 127, (v) => (v ? sdb(volDb(v)) : 'off')), dk('clean', 'clean', 127, (v) => (v ? sdb(volDb(v)) : 'off'))],
  ]);
  dist.querySelector('h3').append(Object.assign(document.createElement('span'), { className: 't', textContent: 'DISTORTION' }), hbtn('on', ['OFF', 'ON'], '', 'Switch the master distortion in or out'));
  const env = document.createElement('div'); env.className = 'envm';
  env.innerHTML = `<output></output><div class="segs">${'<i></i>'.repeat(12)}</div><span class="lab">env</span>`;
  const side = sect(6, [[sw('src', 'source', ['MIX', 'ENG 1', 'ENG 2', 'ENG 3', 'ENG 4'], 'What the sidechain listens to: the whole mix, or one engine on its own'),
    sw('scfilt', 'filter', ['LP', 'BP', 'HP'], "The sidechain's filter: low-pass, band-pass or high-pass at FREQ"),
    dk('freq', 'freq', 127, (v) => hz(scHz(v))), dk('sens', 'sens', 127), dk('decay', 'decay', 127, (v) => { const ms = decayMs(v); return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's'; }), env]]);
  side.querySelector('h3').append(Object.assign(document.createElement('span'), { className: 't', textContent: 'SIDECHAIN' }), hbtn('sc', ['OFF', 'ON'], 'SIDECHAIN', 'Let the sidechain turn a knob of the distortion'),
    Object.assign(document.createElement('span'), { className: 'dim', textContent: 'TURNS' }), hbtn('target', ['PREGAIN', 'CUTOFF', 'TONE'], 'SIDECHAIN TURNS', 'The knob the sidechain turns'),
    hbtn('dir', ['UP', 'DOWN'], 'SIDECHAIN DIRECTION', 'Which way it turns it: up to the top of its range, or down to the bottom'));
  const dirtSects = [[dist, 'on'], [side, 'sc']]; fxDraws.push(drawDirt);
  c1.append(dist, side);
  const out = document.createElement('div'); out.className = 'sect mout'; out.style.setProperty('--n', 1); out.innerHTML = '<h3>OUTPUT</h3><div class="row"></div>';
  out.querySelector('.row').append(gk('level', { max: 100, show: (v) => v + '%', get: () => S.fx.master.level, set: (v) => { S.fx.master.level = v; sendFx(); detail(`OUTPUT LEVEL <em>${v}%</em>`); }, reset: () => { S.fx.master.level = FX_DEFAULTS.master.level; sendFx(); } }));
  c2.append(out);
  fxDraws.forEach((d) => d());
}

// ---------------------------------------------------------------------------------------------------------------
// the computer's keys: [ and ] (or the arrows) step to the key before or after and play it, Space plays it again,
// K a new sound, A alter, L lock, Z undo, F the FX + MASTER tab, 1-4 pick an engine, Cmd/Ctrl+C and V copy and paste
// ---------------------------------------------------------------------------------------------------------------
function stepKey(by) { const to = (S.cur + by + KEYS) % KEYS; startAudio().then(() => play(to, 100)); }
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { openMenu(false); openPresets(false); openSettings(false); if (learn) setLearn(null); return; }
  const typing = e.target.closest('input, select, textarea, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'v')) {
    if (typing || String(getSelection())) return;
    e.preventDefault(); if (e.key === 'c') copyKey(); else pasteKey(); return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === 'z') { if (typing) return; e.preventDefault(); undo(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key >= '1' && key <= String(S.engines)) engBtns[Number(key) - 1].click();
  else if (key === 'z') undo();
  else if (key === '[' || key === ']') stepKey(key === ']' ? 1 : -1);
  else if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); stepKey(key === 'ArrowRight' ? 1 : -1); }
  else if (key === ' ') { e.preventDefault(); startAudio().then(() => play(S.cur, 100)); }
  else if (key === 'k') randKey();
  else if (key === 'a') alterKey();
  else if (key === 'l') lockKey();
  else if (key === 'f') $('fx-tab').click();
});
// (Space and Enter never press a button that was clicked last: only the keys above act)
document.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button')) e.preventDefault(); }, true);
document.addEventListener('mousedown', (e) => { if (e.target.closest('button, [role="slider"]')) e.preventDefault(); }); // (a click never leaves a control focused)

// ---------------------------------------------------------------------------------------------------------------
// PRESETS: the whole patch (every key's sound, edits, home, lock and output, the engine count, the effects, the master
// and the BPM) kept under a name in this browser. The keys are kept by place, so a preset loads the same at any LOW
// KEY. Not in a preset: the padlocks, the knob map, LOW KEY, the RANDOM menu's settings, the screen's colours
// ---------------------------------------------------------------------------------------------------------------
const PRESET_STORE = 'metamorf-presets-v1';
const newId = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36).padStart(4, '0');
function tidyPreset(p) {
  const d = p && p.data;
  if (!d || d.v !== 1 || !Array.isArray(d.keys)) return null;
  return { id: /^[a-z0-9]{6,24}$/.test(p.id) ? p.id : newId(), name: cleanName(p.name) || 'UNNAMED', t: Number(p.t) || 0,
    data: { v: 1, engines: clamp(d.engines | 0, 1, MAX_ENGINES) || DEFAULT_ENGINES, keys: Array.from({ length: KEYS }, (_, i) => tidyKey(d.keys[i])), fx: tidyFx(d.fx), bpm: clamp(d.bpm | 0, 40, 240) || 120 } };
}
let presets = [];
try { const a = JSON.parse(localStorage.getItem(PRESET_STORE)); if (Array.isArray(a)) presets = a.map(tidyPreset).filter(Boolean); } catch (e) { /* none kept */ }
function storePresets() { try { localStorage.setItem(PRESET_STORE, JSON.stringify(presets)); return true; } catch (e) { return false; } }
const storeOr = (said) => { if (!storePresets()) said += ' · <em>the browser would not keep it</em> (storage full or blocked): EXPORT writes a file'; detail(said); };
const patchData = () => tidyPreset({ data: { v: 1, engines: S.engines, keys: S.keys, fx: S.fx, bpm: S.fx.tempo.bpm } }).data; // (as a preset holds it: tidied)
const canon = (x) => (Array.isArray(x) ? '[' + x.map(canon).join() + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map((k) => k + ':' + canon(x[k])).join() + '}' : JSON.stringify(x));
const presetSaved = () => presets.find((p) => p.id === S.preset.id);
const presetDirty = () => { const p = presetSaved(); return !p || canon(p.data) !== canon(patchData()); };
const newName = () => presetName(Math.random, new Set([...presets.map((p) => p.name), S.preset.name]));
function applyPatch(d) {
  S.keys = structuredClone(d.keys);
  showEngines(d.engines);
  applyFx({ dirt: d.fx.dirt, master: d.fx.master, tempo: { bpm: d.bpm } });
}
function loadPreset(id, what) {
  const p = presets.find((x) => x.id === id); if (!p) return;
  change(`${what || 'LOAD'} ${p.name}`, () => { applyPatch(p.data); S.preset = { id: p.id, name: p.name }; }, `${what ? what.toLowerCase() : 'loaded'} <em>${p.name}</em> (UNDO takes it back)`, undefined, true).then(drawPreset);
}
function savePreset(asNew) {
  let p = asNew ? null : presetSaved();
  if (asNew) S.preset = { id: null, name: newName() };
  if (p) { p.data = patchData(); p.name = S.preset.name; p.t = Date.now(); }
  else { p = { id: newId(), name: S.preset.name, t: Date.now(), data: patchData() }; presets.push(p); S.preset.id = p.id; }
  save(); drawPreset();
  storeOr(`saved <em>${p.name}</em>${asNew ? ' as a new preset' : ''} · ${presets.length} preset${presets.length === 1 ? '' : 's'} kept in this browser`);
}
function renamePreset(name) {
  name = cleanName(name);
  if (!name || name === S.preset.name) { drawPreset(); return; }
  S.preset.name = name; const p = presetSaved(); if (p) p.name = name;
  save(); drawPreset();
  if (p) storeOr(`preset renamed <em>${name}</em>`); else detail(`this patch is <em>${name}</em>: SAVE keeps it`);
}
let delArmed = null, delT = 0;
function deletePreset(id) {
  const p = presets.find((x) => x.id === id); if (!p) return;
  clearTimeout(delT);
  if (delArmed !== id) { delArmed = id; delT = setTimeout(() => { delArmed = null; drawPreset(); }, 4000); drawPreset(); detail(`delete <em>${p.name}</em>? Press its SURE? (it can't be undone)`); return; }
  delArmed = null; presets = presets.filter((x) => x.id !== id);
  if (S.preset.id === id) S.preset.id = null;
  save(); drawPreset(); storeOr(`deleted <em>${p.name}</em>`);
}
function exportPresets() {
  if (!presets.length) { detail('nothing saved yet: SAVE keeps this patch, then EXPORT writes the list to a file'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'metamorf', kind: 'presets', version: 1, items: presets, tables: WT.embed(presets.flatMap((x) => x.data.keys.flatMap((k) => [k.t.a, k.t.b]))) }, null, 1)], { type: 'application/json' }));
  a.download = `metamorf-presets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  detail(`exported <em>${presets.length}</em> preset${presets.length === 1 ? '' : 's'} to ${a.download}`);
}
async function importPresets(text) {
  let list, tables = 0;
  try { const j = JSON.parse(text); list = j && j.app === 'metamorf' && j.kind === 'presets' ? j.items : null; if (list) tables = await WT.adopt(j.tables); } catch (e) { list = null; }
  if (tables) { drawWt(); drawAll(); }
  if (!Array.isArray(list)) { detail('that file has no METAMORF presets in it'); return 0; }
  let added = 0, had = 0;
  for (const raw of list) {
    const p = tidyPreset(raw); if (!p) continue;
    const old = presets.find((x) => x.id === p.id);
    if (old && canon(old.data) === canon(p.data)) { had++; continue; }
    if (old) p.id = newId();
    if (!p.t) p.t = Date.now();
    presets.push(p); added++;
  }
  drawPreset();
  const tb = tables ? ` and <em>${tables}</em> wavetable${tables === 1 ? '' : 's'} of your own` : '';
  storeOr(added ? `imported <em>${added}</em> preset${added === 1 ? '' : 's'}${tb}${had ? ` (${had} already here)` : ''}` : had ? `nothing new: all ${had} are already here${tb}` : 'that file has no METAMORF presets in it');
  return added;
}
function drawPreset() {
  const p = presetSaved(), dirty = presetDirty();
  $('preset-name').textContent = S.preset.name; $('preset-mark').textContent = dirty ? '*' : '';
  $('preset-btn').title = `${S.preset.name}: ${!p ? 'not saved yet' : dirty ? 'changed since it was saved' : 'saved'}. Save, load, rename and delete presets, and write them to a file`;
  drawPhone();
  if ($('preset-panel').hidden) return;
  $('preset-state').textContent = !p ? 'NOT SAVED YET' : dirty ? 'CHANGED SINCE SAVED' : 'SAVED';
  if (document.activeElement !== $('preset-input')) $('preset-input').value = S.preset.name;
  $('preset-save').disabled = !!p && !dirty; $('preset-save-new').disabled = !p; $('preset-revert').disabled = !p || !dirty;
  $('preset-count').textContent = presets.length ? String(presets.length) : '';
  const list = $('preset-list'); list.innerHTML = '';
  if (!presets.length) { list.innerHTML = '<p class="dim">NOTHING SAVED YET<br>SAVE KEEPS THIS PATCH IN THIS BROWSER</p>'; return; }
  for (const x of [...presets].sort((a, b) => b.t - a.t)) {
    const row = document.createElement('div'); row.className = 'prow'; if (x.id === S.preset.id) row.setAttribute('aria-current', 'true');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pload'; b.textContent = x.name; b.title = `Load ${x.name} (UNDO goes back to this patch)`;
    b.addEventListener('click', () => loadPreset(x.id));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'pdel'; del.textContent = delArmed === x.id ? 'SURE?' : 'X';
    del.title = `Delete ${x.name}: press twice`; del.setAttribute('aria-label', `Delete ${x.name}`); del.setAttribute('aria-pressed', delArmed === x.id);
    del.addEventListener('click', () => deletePreset(x.id));
    row.append(b, del); list.append(row);
  }
}
function openPresets(open) {
  $('preset-panel').hidden = !open; $('preset-btn').setAttribute('aria-expanded', open);
  if (open) { openMenu(false); openSettings(false); drawPreset(); } else if (delArmed) { clearTimeout(delT); delArmed = null; }
}
$('preset-btn').addEventListener('click', () => openPresets($('preset-panel').hidden));
$('preset-input').addEventListener('change', () => renamePreset($('preset-input').value));
$('preset-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('preset-input').blur(); });
$('preset-roll').addEventListener('click', () => renamePreset(newName()));
$('preset-save').addEventListener('click', () => savePreset(false));
$('preset-save-new').addEventListener('click', () => savePreset(true));
$('preset-revert').addEventListener('click', () => loadPreset(S.preset.id, 'BACK TO THE SAVED'));
$('preset-export').addEventListener('click', exportPresets);
$('preset-import').addEventListener('click', () => $('preset-file').click());
$('preset-file').addEventListener('change', async () => { const f = $('preset-file').files[0]; if (f) importPresets(await f.text()); $('preset-file').value = ''; });

// ---------------------------------------------------------------------------------------------------------------
// SETTINGS: the tempo and RETURN, ENGINES and LOW KEY
// ---------------------------------------------------------------------------------------------------------------
function setBpm(v) { S.fx.tempo.bpm = clamp(Math.round(v), 40, 240); $('bpm').textContent = S.fx.tempo.bpm; sendFx(); }
$('bpm-down').addEventListener('click', (e) => setBpm(S.fx.tempo.bpm - (e.shiftKey ? 10 : 1)));
$('bpm-up').addEventListener('click', (e) => setBpm(S.fx.tempo.bpm + (e.shiftKey ? 10 : 1)));
$('bpm').addEventListener('dblclick', () => setBpm(120));
const RETURNS = ['NOW', '1/32', '1/16', '1/8', '1/4'];
function drawRet() { $('ret').textContent = RETURNS[S.fx.tempo.ret] ?? '1/16'; }
$('ret').addEventListener('click', (e) => {
  S.fx.tempo.ret = (S.fx.tempo.ret + (e.shiftKey ? RETURNS.length - 1 : 1)) % RETURNS.length; drawRet(); sendFx();
  detail(`RETURN <em>${RETURNS[S.fx.tempo.ret]}</em>: let go of the newest key of an engine and the earlier held key comes back ${RETURN_BEATS[S.fx.tempo.ret] ? 'on the next ' + RETURNS[S.fx.tempo.ret] : 'at once'}`);
});
function drawZones() {
  $('zones').textContent = 'MIDI CH 1 · C3 = #60';
  engBtns.forEach((b, e) => { const on = e < S.engines, z = zone(Math.min(e, S.engines - 1)); b.hidden = !on; b.querySelector('.ch').textContent = on ? `${noteName(noteOf(z.lo))}-${noteName(noteOf(z.hi))}` : ''; b.title = on ? `${ENG(e)}: keys ${noteName(noteOf(z.lo))} to ${noteName(noteOf(z.hi))} (${e + 1})` : ''; });
  $('engines').textContent = S.engines; $('eng-down').disabled = S.engines <= 1; $('eng-up').disabled = S.engines >= MAX_ENGINES;
  $('low-key').textContent = `${noteName(S.low)} #${S.low}`; $('low-down').disabled = S.low - 12 < 0; $('low-up').disabled = S.low + 12 + KEYS - 1 > 127;
}
function moveZones(by) {
  const to = S.low + by; if (to < 0 || to + KEYS - 1 > 127) return;
  allOff(); S.low = to; save(); buildStrip(); drawZones(); drawAll(); fitScreen();
  detail(`lowest key <em>${noteName(to)} #${to}</em>`);
}
$('low-down').addEventListener('click', () => moveZones(-12));
$('low-up').addEventListener('click', () => moveZones(12));
// ENGINES: how many mono engines share the 25 keys, 1 to 4, on even zones side by side. Every key keeps its sound
function showEngines(n) {
  if (n === S.engines) return;
  allOff(); S.engines = n; send({ type: 'engines', n }); ringing.fill(-1);
  buildStrip(); buildPads(); drawZones(); drawAll(); fitScreen();
}
function setEngineCount(n) {
  n = clamp(n, 1, MAX_ENGINES); if (n === S.engines) return;
  snapshot(`ENGINES ${S.engines} → ${n}`);
  showEngines(n); save();
  detail(`ENGINES <em>${n}</em>: ${onEngines().map((e) => `${ENG(e)} ${noteName(noteOf(zone(e).lo))}-${noteName(noteOf(zone(e).hi))}`).join(' · ')}`);
}
$('eng-down').addEventListener('click', () => setEngineCount(S.engines - 1));
$('eng-up').addEventListener('click', () => setEngineCount(S.engines + 1));

// ---------------------------------------------------------------------------------------------------------------
// the phone view (app/phone.js): its buttons press the big screen's own, so the rules live in one place
// ---------------------------------------------------------------------------------------------------------------
const phone = setupPhone({
  S, KEYS, engOf, zone, noteOf, noteName, ENG, whatText, startAudio, keyDown, noteOff, editOut, detail, lockedMsg, sendText,
});
const drawPhone = () => phone.draw();
const buildPads = () => phone.buildPads();

// ---------------------------------------------------------------------------------------------------------------
// fit the screen to small windows: below 1264 x 850 the whole screen is laid out at that size and scaled down, so
// every knob stays visible and nothing scrolls
// ---------------------------------------------------------------------------------------------------------------
const FIT_W = 1264, FIT_H = 850;
function alignEngines() {
  const row = $('sounds'), sc = $('screen'), k = sc.getBoundingClientRect().width / sc.offsetWidth || 1, base = row.getBoundingClientRect().left;
  const groups = [...document.querySelectorAll('#keystrip .kgroup')], narrow = groups.some((g) => g.getBoundingClientRect().width / k < 150); // (all alike: if one is narrow, all show the name only)
  const place = (b, el) => { const r = el.getBoundingClientRect(); Object.assign(b.style, { left: `${(r.left - base) / k}px`, width: `${r.width / k}px` }); b.classList.toggle('narrow', narrow); };
  groups.forEach((g, i) => place(engBtns[i], g));
  const tag = row.querySelector('.tag'); tag.style.left = `${parseFloat(engBtns[0].style.left) - tag.offsetWidth - 12}px`;
}
function fitScreen() {
  const sc = $('screen'), vw = innerWidth - 16, vh = innerHeight - 16, s = Math.min(1, vw / FIT_W, vh / FIT_H);
  if (phone.set()) { sc.removeAttribute('style'); return; }
  if (s < 1) Object.assign(sc.style, { width: `${vw / s}px`, height: `${vh / s}px`, maxWidth: 'none', margin: '0', transform: `scale(${s})`, transformOrigin: '0 0' });
  else sc.removeAttribute('style');
  alignEngines();
}
addEventListener('resize', fitScreen);

// ---------------------------------------------------------------------------------------------------------------
// SETTINGS > WAVETABLES: a WAV file in as a table of your own (kept in this browser), the list, DELETE (X, then SURE?)
// ---------------------------------------------------------------------------------------------------------------
let wtArmed = null, wtT = 0;
const usesOf = (id) => S.keys.filter((k) => (k.t.a === id && k.p.a_level > 0) || (k.t.b === id && k.p.b_level > 0)).length;
function wtDrawing(u) {
  const f = Math.floor((u.count - 1) / 2), N = 2048, o = f * N; let d = '';
  for (let i = 0; i <= 64; i++) { const v = u.frames[o + Math.min(N - 1, Math.round(i * N / 64))]; d += (i ? 'L' : 'M') + i + ' ' + (14 - v * 12).toFixed(1); }
  return `<svg viewBox="0 0 64 28" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}
function drawWt() {
  const list = $('wt-list'), users = WT.userList(); list.innerHTML = '';
  $('wt-count').textContent = users.length ? String(users.length) : '';
  if (!users.length) { list.innerHTML = '<p class="dim">NONE LOADED YET<br>LOAD WAV: ONE CYCLE PER FRAME, UP TO 256 FRAMES</p>'; return; }
  for (const u of users) {
    const row = document.createElement('div'); row.className = 'prow';
    const name = document.createElement('span'); name.className = 'wtname'; name.innerHTML = `${u.name}<small>${u.count} FRAME${u.count === 1 ? '' : 'S'}</small>`;
    const draw = document.createElement('span'); draw.innerHTML = wtDrawing(u); draw.style.display = 'flex';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'pdel'; del.textContent = wtArmed === u.id ? 'SURE?' : 'X';
    del.title = `Delete ${u.name}: press twice`; del.setAttribute('aria-label', `Delete ${u.name}`); del.setAttribute('aria-pressed', wtArmed === u.id);
    del.addEventListener('click', () => deleteWt(u.id));
    row.append(name, draw, del); list.append(row);
  }
}
async function deleteWt(id) {
  const u = WT.user(id); if (!u) return;
  clearTimeout(wtT);
  const n = usesOf(id);
  if (wtArmed !== id) { wtArmed = id; wtT = setTimeout(() => { wtArmed = null; drawWt(); }, 4000); drawWt(); detail(`delete <em>${u.name}</em>? Press its SURE? (it can't be undone)${n ? ` · ${n} key${n === 1 ? ' uses' : 's use'} it` : ''}`); return; }
  wtArmed = null; await WT.removeUser(id); drawWt(); drawAll();
  detail(`deleted <em>${u.name}</em>${n ? ` · ${n} key${n === 1 ? '' : 's'} that used it play BASIC now (table missing); loading the same file again brings it back` : ''}`);
}
async function keepWt(w, size, file) {
  $('wt-sizes').hidden = true; file = WT.tableNameFrom(file);
  try {
    const { rec, isNew, kept } = await WT.keepWav(w, size, file);
    drawWt(); drawAll();
    detail(isNew ? `loaded <em>${rec.name}</em>: ${rec.count} frame${rec.count === 1 ? '' : 's'} · the TABLE knobs can pick it now${kept ? '' : ' · <em>the browser would not keep it</em> (storage full or blocked): it goes when the page closes'}`
      : `<em>${rec.name}</em> is already loaded (the same frames): nothing added`);
  } catch (e) { detail(`<em>${file}</em> not loaded: ${e.message}`); }
}
function askSize(w, file) {
  const box = $('wt-sizes'); box.hidden = false; const nm = WT.tableNameFrom(file);
  box.innerHTML = `<p class="dim">${nm}: ${w.samples.length} SAMPLES. HOW LONG IS ONE CYCLE?</p>`;
  for (const n of [...SIZES, 0]) {
    const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.className = 'btn';
    const frames = n ? Math.floor(w.samples.length / n) : 1;
    b.textContent = n ? String(n) : 'WHOLE FILE'; b.disabled = !frames;
    b.title = n ? `${n} samples a cycle: ${Math.min(256, frames)} frame${frames === 1 ? '' : 's'}` : 'The whole file is one cycle: one frame';
    b.addEventListener('click', () => keepWt(w, n, file));
    box.append(b);
  }
  detail(`<em>${nm}</em> has no frame size marked: pick how many samples one cycle is (SETTINGS > WAVETABLES)`);
}
$('wt-load').addEventListener('click', () => $('wt-file').click());
$('wt-file').addEventListener('change', async () => {
  const f = $('wt-file').files[0]; $('wt-file').value = ''; if (!f) return;
  let w; try { w = decodeWav(await f.arrayBuffer()); } catch (e) { detail(`<em>${WT.tableNameFrom(f.name)}</em> not loaded: ${e.message}`); return; }
  const size = autoSize(w);
  if (size) keepWt(w, size, f.name); else askSize(w, f.name);
});

// ---------------------------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------------------------
$('start-btn').addEventListener('click', async () => {
  $('start').hidden = true;
  await startAudio();
  if (!phone.on) startMidi(); // (on a phone the pads are the keys: it isn't asked for MIDI there)
  else if (navigator.permissions) navigator.permissions.query({ name: 'midi' }).then((s) => { if (s.state === 'granted') startMidi(); }).catch(() => {});
});
$('start-text').textContent = 'MIDI channel 1, 25 keys from C2: every key has its own sound. Play one and the screen shows it, ready to edit.';
if (new URLSearchParams(location.search).has('nostart')) $('start').hidden = true; // (screenshots)
S.preset = { id: S.preset.id, name: cleanName(S.preset.name) || newName() };
if (S.preset.id && !presetSaved()) S.preset.id = null;
if (S.fresh) { onEngines().forEach(scatter); S.fresh = false; save(); } // a first visit starts with a sound on every key
buildMake(); buildStrip(); buildKnobs(); buildFx(); buildPads(); drawZones(); drawRet(); drawSource(); drawLocks(); drawInit(); drawUndo();
$('bpm').textContent = S.fx.tempo.bpm;
drawAll(); drawPreset(); randDraws.forEach((d) => d());
fitScreen();
document.fonts?.ready.then(alignEngines);
drawWt(); WT.loadUsers().then((n) => { if (n) { drawWt(); drawAll(); sendTables(); } });

// for testing without a controller: metamorf.noteOn(channel, note, velocity), metamorf.cc(number, value)
window.metamorf = { noteOn: (ch, note, vel = 100) => noteOn(ch, note, vel), noteOff: (note) => noteOff(note), cc: (cc, val) => onCC(cc, val),
  keys: () => S.keys, cur: () => S.cur, engines: () => S.engines, low: () => S.low, fx: () => S.fx, locks: () => S.locks, rand: () => S.rand,
  presets: { list: () => presets, now: () => S.preset, dirty: presetDirty, import: importPresets }, undoDepth: () => undoStack.length,
  audio: () => ({ state: ctx ? ctx.state : 'none', heard, error: audioError }),
  render: (place = S.cur, seconds = 1) => WT.forRender([S.keys[place].t.a, S.keys[place].t.b]).then(() => renderOffline(sound(S.keys[place]), S.keys[place].out, 100, seconds)), tables: () => WT.userList().map((u) => ({ id: u.id, name: u.name, count: u.count })) }; // (an offline render of a key, in the Worker)
window.metamorfReady = true; // index.html's load check
