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
  // AMP
  { id: 'attack', label: 'attack', sec: 'amp', map: 'cube', lo: 0, hi: 200, def: 0, safe: [0, 0.35], show: fmtMs },
  { id: 'hold', label: 'hold', sec: 'amp', map: 'cube', lo: 0, hi: 500, def: 0, safe: [0, 0.4], show: fmtMs },
  { id: 'decay', label: 'decay', sec: 'amp', map: 'log', lo: 5, hi: 8000, def: 0.5, safe: [0.2, 0.75], show: fmtMs },
  { id: 'curve', label: 'curve', sec: 'amp', map: 'bip', lo: -1, hi: 1, def: 0.3, safe: [-0.6, 1], show: (c) => signed(c * 100) },
  // PITCH ENV
  { id: 'p_amt', label: 'amount', sec: 'pitch env', map: 'bip', lo: -48, hi: 96, def: 0.15, safe: [-0.1, 0.6], show: (s) => signed(s, Math.abs(s) < 10 ? 1 : 0) + 'st', gate: true, dep: ['p_decay', 'p_curve'] },
  { id: 'p_decay', label: 'decay', sec: 'pitch env', map: 'log', lo: 1, hi: 2000, def: 0.35, safe: [0.1, 0.7], show: fmtMs },
  { id: 'p_curve', label: 'curve', sec: 'pitch env', map: 'bip', lo: -1, hi: 1, def: 0.5, safe: [-0.5, 1], show: (c) => signed(c * 100) },
];
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
