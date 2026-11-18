// The sound's parameters: every one continuous, stored as a normalised float (0..1, or -1..1 for a bipolar one) and
// mapped to real units by a curve. No UI and no audio here: the page, the engine and the tests all read this file.
//
// Build step 2 has the engine core: two wavetable oscillators (on BASIC until the other tables come in step 3), the amp
// envelope and the pitch envelope. Later steps add the rest of docs/SPEC.md section 4 here, by id: a sound stores its
// parameters by id, so adding parameters never breaks a sound.
//
// A parameter: { id, label, sec, map, lo, hi, def, safe: [lo, hi] (normalised: where FREE and ALTER go), show(v),
//   gate: true when it switches its part off at zero, dep: the ids a gate switches off with it }.

const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) + 'ms' : ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(ms < 9950 ? 2 : 1) + 's');
// POSITION on BASIC: where between its shapes (the soft labels; a table of its own names comes with step 3)
const BASIC_NAMES = ['SINE', 'TRI', 'SAW', 'SQUARE', 'PULSE'];
const posText = (x) => { const f = x * 4, i = Math.min(3, Math.floor(f)), t = f - i; return t < 0.05 ? BASIC_NAMES[i] : t > 0.95 ? BASIC_NAMES[i + 1] : `${BASIC_NAMES[i]}>${BASIC_NAMES[i + 1].slice(0, 3)} ${Math.round(t * 100)}`; };
// RATIO: shown to two places, with a whole ratio named when it is close (the knob never snaps)
const ratioText = (r) => (Math.abs(r - Math.round(r)) < 0.01 && r >= 0.99 ? '×' + Math.round(r) : '×' + (r < 10 ? r.toFixed(2) : r.toFixed(1)));
// NOISE COLOUR: dark, white, bright; CLICK SHAPE: between its three
const colourText = (c) => (Math.abs(c) < 0.03 ? 'WHITE' : (c < 0 ? 'DARK ' : 'BRIGHT ') + Math.round(Math.abs(c) * 100));
const CLICKS = ['PULSE', 'CHIRP', 'BURST'];
const clickShapeText = (x) => { const f = x * 2, i = Math.min(1, Math.floor(f)), t = f - i; return t < 0.05 ? CLICKS[i] : t > 0.95 ? CLICKS[i + 1] : `${CLICKS[i].slice(0, 3)}>${CLICKS[i + 1].slice(0, 3)} ${Math.round(t * 100)}`; };
const hzText = (f) => (f < 1000 ? Math.round(f) + 'Hz' : (f / 1000).toFixed(f < 9950 ? 1 : 0) + 'k');
// FILTER 1 MORPH, FILTER 2 COMB > VOWEL and VOWEL: soft labels between their points
const between = (names, x) => { const n = names.length - 1, f = x * n, i = Math.min(n - 1, Math.floor(f)), t = f - i; return t < 0.05 ? names[i] : t > 0.95 ? names[i + 1] : `${names[i]}>${names[i + 1]} ${Math.round(t * 100)}`; };
const morphText = (x) => between(['LP', 'BP', 'HP'], x);
const vowelText = (x) => between(['A', 'E', 'I', 'O', 'U'], x);
const blendText = (x) => (x < 0.03 ? 'COMB' : x > 0.97 ? 'VOWEL' : `C${Math.round((1 - x) * 100)}/V${Math.round(x * 100)}`);
const repeatText = (r) => (r < 0.005 ? 'OFF' : Math.abs(r - Math.round(r)) < 0.005 ? '×' + Math.round(r) : '×' + Math.floor(r) + '+' + Math.round((r - Math.floor(r)) * 100) + '%');
const signed = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

// the curves, normalised value -> real units
export const MAPS = {
  lin: (x, lo, hi) => lo + (hi - lo) * x,
  log: (x, lo, hi) => lo * Math.pow(hi / lo, x), // frequencies and times: even in pitch and in log time
  cube: (x, lo, hi) => lo + (hi - lo) * x * x * x, // a time that starts at zero (attack, hold): fine control at the short end
  bip: (x, lo, hi) => (x >= 0 ? x * hi : -x * lo), // bipolar, -1..1: centre 0, each side its own reach (lo is negative)
};

export const PARAMS = [
  // OSC A
  { id: 'a_pos', label: 'position', sec: 'osc a', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => posText(x) },
  { id: 'a_tune', label: 'tune', sec: 'osc a', map: 'bip', lo: -48, hi: 48, def: 0, safe: [-0.6, 0.7], show: (s) => signed(s, Math.abs(s) < 10 ? 1 : 0) + 'st' },
  { id: 'a_fine', label: 'fine', sec: 'osc a', map: 'bip', lo: -100, hi: 100, def: 0, safe: [-0.3, 0.3], show: (c) => signed(c) + 'c' },
  { id: 'a_level', label: 'level', sec: 'osc a', map: 'lin', lo: 0, hi: 1, def: 0.8, safe: [0.5, 1], show: (x) => Math.round(x * 100) + '%', gate: true, dep: ['a_pos'] },
  // OSC B: its pitch from A's (RATIO, DETUNE), following A's pitch envelope by TRACK
  { id: 'b_pos', label: 'position', sec: 'osc b', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => posText(x) },
  { id: 'b_ratio', label: 'ratio', sec: 'osc b', map: 'log', lo: 0.25, hi: 16, def: 1 / 3, safe: [0, 1], show: ratioText },
  { id: 'b_det', label: 'detune', sec: 'osc b', map: 'bip', lo: -100, hi: 100, def: 0, safe: [-0.3, 0.3], show: (c) => signed(c) + 'c' },
  { id: 'b_track', label: 'track', sec: 'osc b', map: 'lin', lo: 0, hi: 1, def: 1, safe: [0, 1], show: (x) => Math.round(x * 100) + '%' },
  { id: 'b_level', label: 'level', sec: 'osc b', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.9], show: (x) => Math.round(x * 100) + '%', gate: true, dep: ['b_pos', 'b_ratio', 'b_det', 'b_track'] },
  // FM: phase modulation each way (both: cross-FM)
  { id: 'fm_ab', label: 'a > b', sec: 'fm', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.5], show: (x) => Math.round(x * 100) + '%', gate: true },
  { id: 'fm_ba', label: 'b > a', sec: 'fm', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.4], show: (x) => Math.round(x * 100) + '%', gate: true },
  // NOISE: on its own decay (a share of the amp's), seeded per note
  { id: 'n_level', label: 'level', sec: 'noise', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.7], show: (x) => Math.round(x * 100) + '%', gate: true, dep: ['n_colour', 'n_decay', 'n_seed'] },
  { id: 'n_colour', label: 'colour', sec: 'noise', map: 'bip', lo: -1, hi: 1, def: 0, safe: [-0.8, 1], show: colourText },
  { id: 'n_decay', label: 'decay', sec: 'noise', map: 'log', lo: 0.1, hi: 2, def: Math.log(10) / Math.log(20), safe: [0.2, 1], show: (x) => '×' + x.toFixed(x < 1 ? 2 : 1) },
  { id: 'n_seed', label: 'seed', sec: 'noise', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => String(Math.floor(x * 65535)) },
  // CLICK: generated at the note's start
  { id: 'c_level', label: 'level', sec: 'click', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.6], show: (x) => Math.round(x * 100) + '%', gate: true, dep: ['c_shape', 'c_tone', 'c_len', 'c_direct'] },
  { id: 'c_shape', label: 'shape', sec: 'click', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: clickShapeText },
  { id: 'c_tone', label: 'tone', sec: 'click', map: 'log', lo: 20, hi: 16000, def: Math.log(100) / Math.log(800), safe: [0.35, 1], show: hzText },
  { id: 'c_len', label: 'length', sec: 'click', map: 'log', lo: 0.2, hi: 30, def: Math.log(15) / Math.log(150), safe: [0.1, 0.8], show: fmtMs },
  { id: 'c_direct', label: 'direct', sec: 'click', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => Math.round(x * 100) + '%' },
  // DRIVE: before the filters
  { id: 'drive', label: 'amount', sec: 'drive', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.6], show: (x) => Math.round(x * 100) + '%', gate: true },
  // FILTER 1: the morph filter (LP > BP > HP), after DRIVE
  { id: 'f_morph', label: 'morph', sec: 'filter 1', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: morphText },
  { id: 'cutoff', label: 'cutoff', sec: 'filter 1', map: 'log', lo: 20, hi: 20000, def: 1, safe: [0.35, 1], show: hzText },
  { id: 'reso', label: 'resonance', sec: 'filter 1', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.7], show: (x) => Math.round(x * 100) + '%' },
  { id: 'f_track', label: 'track', sec: 'filter 1', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => Math.round(x * 100) + '%' },
  // FILTER 2: the comb and the vowel filter, blended (MIX: how much of it)
  { id: 'f2_mix', label: 'mix', sec: 'filter 2', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 0.8], show: (x) => Math.round(x * 100) + '%', gate: true, dep: ['f2_blend', 'f2_pitch', 'f2_track', 'f2_res', 'f2_damp', 'f2_vowel'] },
  { id: 'f2_blend', label: 'comb>vowel', sec: 'filter 2', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: blendText },
  { id: 'f2_pitch', label: 'pitch', sec: 'filter 2', map: 'log', lo: 20, hi: 8000, def: Math.log(10) / Math.log(400), safe: [0.2, 0.9], show: hzText },
  { id: 'f2_track', label: 'track', sec: 'filter 2', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => Math.round(x * 100) + '%' },
  { id: 'f2_res', label: 'resonance', sec: 'filter 2', map: 'bip', lo: -0.98, hi: 0.98, def: 0.6, safe: [-0.9, 0.95], show: (x) => signed(x * 100) },
  { id: 'f2_damp', label: 'damp', sec: 'filter 2', map: 'lin', lo: 0, hi: 1, def: 0.3, safe: [0, 1], show: (x) => Math.round(x * 100) + '%' },
  { id: 'f2_vowel', label: 'vowel', sec: 'filter 2', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: vowelText },
  // AMP
  { id: 'attack', label: 'attack', sec: 'amp', map: 'cube', lo: 0, hi: 200, def: 0, safe: [0, 0.35], show: fmtMs },
  { id: 'hold', label: 'hold', sec: 'amp', map: 'cube', lo: 0, hi: 500, def: 0, safe: [0, 0.4], show: fmtMs },
  { id: 'decay', label: 'decay', sec: 'amp', map: 'log', lo: 5, hi: 8000, def: 0.5, safe: [0.2, 0.75], show: fmtMs },
  { id: 'curve', label: 'curve', sec: 'amp', map: 'bip', lo: -1, hi: 1, def: 0.3, safe: [-0.6, 1], show: (c) => signed(c * 100) },
  // PITCH ENV
  { id: 'p_amt', label: 'amount', sec: 'pitch env', map: 'bip', lo: -48, hi: 96, def: 0.15, safe: [-0.1, 0.6], show: (s) => signed(s, Math.abs(s) < 10 ? 1 : 0) + 'st', gate: true, dep: ['p_decay', 'p_curve'] },
  { id: 'p_decay', label: 'decay', sec: 'pitch env', map: 'log', lo: 1, hi: 2000, def: 0.35, safe: [0.1, 0.7], show: fmtMs },
  { id: 'p_curve', label: 'curve', sec: 'pitch env', map: 'bip', lo: -1, hi: 1, def: 0.5, safe: [-0.5, 1], show: (c) => signed(c * 100) },
  // REPEAT (in AMP): the envelopes start again SPACING apart; the whole part counts, the fraction is the last one's level
  { id: 'repeat', label: 'repeat', sec: 'amp', map: 'lin', lo: 0, hi: 8, def: 0, safe: [0, 0], show: repeatText },
  { id: 'spacing', label: 'spacing', sec: 'amp', map: 'log', lo: 1, hi: 80, def: Math.log(10) / Math.log(80), safe: [0.3, 0.8], show: fmtMs },
  // MOD ENV and the LFO: sources only, heard through the routes ($m)
  { id: 'me_decay', label: 'decay', sec: 'mod env', map: 'log', lo: 1, hi: 4000, def: 0.6, safe: [0.2, 0.8], show: fmtMs },
  { id: 'me_curve', label: 'curve', sec: 'mod env', map: 'bip', lo: -1, hi: 1, def: 0.3, safe: [-0.6, 1], show: (c) => signed(c * 100) },
  { id: 'lfo_rate', label: 'rate', sec: 'lfo', map: 'log', lo: 0.05, hi: 2000, def: Math.log(100) / Math.log(40000), safe: [0.35, 0.8], show: (f) => (f < 10 ? f.toFixed(f < 1 ? 2 : 1) + 'Hz' : hzText(f)) },
  { id: 'lfo_shape', label: 'shape', sec: 'lfo', map: 'lin', lo: 0, hi: 1, def: 0, safe: [0, 1], show: (x) => between(['SINE', 'TRI', 'SAW', 'SQR', 'RAND'], x) },
];
// ---- modulation: three sources; the curated routes (what the randomisers reach for) ----
export const MOD_SOURCES = ['env', 'lfo', 'vel'];
export const MOD_NAMES = { env: 'MOD ENV', lfo: 'LFO', vel: 'VELOCITY' };
export const MOD_ROUTES = {
  env: ['fm_ab', 'fm_ba', 'a_pos', 'b_pos', 'cutoff', 'f2_pitch'],
  lfo: ['a_tune', 'a_pos', 'b_pos', 'cutoff', 'fm_ab', 'fm_ba', 'a_level'],
  vel: ['decay', 'p_amt', 'cutoff', 'fm_ab', 'fm_ba', 'c_level'],
};
// how far amount 1 moves a destination, in its normalised units (1 unless a full sweep would be too much)
const DEPTHS = { a_tune: [1, 0.5, 0.5], cutoff: [0.8, 0.4, 0.4], f2_pitch: [0.46, 0.23, 0.23] };
export const modDepth = (s, id) => (DEPTHS[id] ? DEPTHS[id][typeof s === 'number' ? s : MOD_SOURCES.indexOf(s)] : 1);
export const routeKey = (s, id) => s + '>' + id;
/** a source can reach any sound parameter but NOISE SEED (read at note start: only VELOCITY moves it); the curated
 * routes above are the ones the randomisers use */
export const modulatable = (s, id) => MOD_SOURCES.includes(s) && !!BY_ID[id] && (id !== 'n_seed' || s === 'vel');
export const validRoute = (key) => { const [s, id] = String(key).split('>'); return modulatable(s, id); };
export const BY_ID = Object.fromEntries(PARAMS.map((p) => [p.id, p]));
export const SECTIONS = [...new Set(PARAMS.map((p) => p.sec))];
export const isBip = (p) => p.map === 'bip';
// a normalised value in real units, and as the knob shows it
export const real = (p, x) => MAPS[p.map](x, p.lo, p.hi);
export const showValue = (p, x) => p.show(real(p, x));
export const clampN = (p, x) => Math.min(1, Math.max(isBip(p) ? -1 : 0, Number.isFinite(x) ? x : p.def));
// a whole sound's parameters with every id present (missing: its default; unknown ids dropped)
export function fullParams(src) {
  const o = {};
  for (const p of PARAMS) o[p.id] = clampN(p, src && typeof src[p.id] === 'number' ? src[p.id] : p.def);
  return o;
}
export const BASE = Object.freeze(fullParams({})); // CLEAR's sound: every parameter at its default

// the key's OUTPUT: part of the mix, not of the sound (never morphed, never moved by ALTER, kept by new sounds)
export const OUT_DEFAULT = Object.freeze({ level: 0.8, pan: 0, send: 0, trim: 0 }); // trim in dB (auto level, build step 9)
export const levelGain = (x) => x * x * 1.5625; // LEVEL: 0.8 is unity, 1 is +3.9 dB
export const levelText = (x) => (x <= 0.001 ? '-inf' : (20 * Math.log10(levelGain(x))).toFixed(1) + 'dB');
export const panText = (x) => (Math.abs(x) < 0.005 ? 'C' : (x < 0 ? 'L' : 'R') + Math.round(Math.abs(x) * 100));
export const sendText = (x) => String(Math.round(x * 127));

// the sound types (RATE, MAKE THIS KEY, the pan rule): [id, the button's text]
export const TYPES = [['kick', 'KICK'], ['tom', 'TOM'], ['perc', 'PERC'], ['zap', 'ZAP'], ['snare', 'SNARE'], ['clap', 'CLAP'], ['rim', 'RIM'],
  ['bell', 'BELL'], ['closed hat', 'C HAT'], ['open hat', 'O HAT'], ['cymbal', 'CYMBAL']];
// pan when randomising: kicks centred, snares and claps within 20%, everything else anywhere
export const panRange = (type) => (type === 'kick' ? 0 : type === 'snare' || type === 'clap' ? 0.2 : 1);

// the 25 keys split into 1 to 4 even zones side by side, the extra keys at the top
export const KEYS = 25, MAX_ENGINES = 4, DEFAULT_ENGINES = 4, DEFAULT_LOW = 48;
export const zoneSizes = (n) => Array.from({ length: n }, (_, i) => Math.floor(KEYS / n) + (i >= n - (KEYS % n) ? 1 : 0));
// the engine of a key's place (0..24) with n engines
export function engineOf(place, n) { const s = zoneSizes(n); let a = 0; for (let i = 0; i < n; i++) { a += s[i]; if (place < a) return i; } return n - 1; }
export function zoneOf(e, n) { const s = zoneSizes(n), lo = s.slice(0, e).reduce((a, b) => a + b, 0); return { lo, hi: lo + s[e] - 1 }; }
