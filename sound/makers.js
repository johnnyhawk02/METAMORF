// New sounds, as normalised parameters by id. No UI here; rnd is a function giving 0..1.
//
// Build step 1 has the ones that need no kept sounds: FREE (every parameter anywhere in its safe range), the starter
// recipes (a sound of a named type, hand-tuned ranges for the stub voice) and ALTER (a nudge around a sound's home).
// LIBRARY, BREED, MORPH, STYLE and the learned recipes come with the library (build steps 10 and 11).
import { PARAMS, BY_ID, isBip, MOD_ROUTES, MOD_SOURCES, routeKey, validRoute } from './params.js?v=mwm8ivhg';
import { BUILTIN_IDS } from '../engine/tables.js?v=mwm8ivhg';

const pick = (rnd, [lo, hi]) => lo + rnd() * (hi - lo);
const lim = (p) => [isBip(p) ? -1 : 0, 1];
const round = (x) => Math.round(x * 1e4) / 1e4; // (stored compactly)

/** FREE: every parameter anywhere in its percussion-safe range */
export function free(rnd) {
  const o = {};
  for (const p of PARAMS) o[p.id] = round(pick(rnd, p.safe));
  return o;
}

// the starter recipes: for each type, a range per parameter (normalised); a parameter not named takes its safe range,
// and level-like ones stay near full. OSC B, FM, NOISE, CLICK and DRIVE are off unless a type names them. Written for the engine core (two
// oscillators on BASIC); rewritten for the whole voice in build step 10. POSITION on BASIC: 0 sine, .25 triangle,
// .5 saw, .75 square, 1 narrow pulse. RATIO: 1/3 is x1, .5 is x2, .6 about x3, .69 about x4.4
export const STARTERS = {
  kick: { a_pos: [0, 0.12], a_tune: [-0.55, -0.4], p_amt: [0.25, 0.45], p_decay: [0.18, 0.32], p_curve: [0.4, 0.9], decay: [0.42, 0.58], curve: [0, 0.6], attack: [0, 0.05], hold: [0, 0.2], b_level: [0, 0], c_level: [0.15, 0.5], c_shape: [0, 0.45], c_tone: [0.6, 0.85], c_len: [0.15, 0.45], c_direct: [0.4, 1], drive: [0, 0.35], cutoff: [0.55, 0.85], reso: [0, 0.4], f_morph: [0, 0] },
  tom: { a_pos: [0, 0.2], a_tune: [-0.4, -0.15], p_amt: [0.06, 0.15], p_decay: [0.3, 0.45], decay: [0.42, 0.55], attack: [0, 0.05], hold: [0, 0.15], b_level: [0, 0.3], b_pos: [0, 0.1], b_ratio: [0.38, 0.45], b_track: [0.7, 1], c_level: [0, 0.25], c_shape: [0, 0.5], drive: [0, 0.25], n_level: [0, 0.12], n_colour: [-0.6, 0], n_decay: [0.3, 0.6], cutoff: [0.6, 0.9], f2_mix: [0, 0.3], f2_blend: [0, 0.2] },
  perc: { a_pos: [0, 0.45], a_tune: [-0.1, 0.25], p_amt: [0.02, 0.1], p_decay: [0.15, 0.35], decay: [0.3, 0.45], attack: [0, 0.05], hold: [0, 0.1], b_level: [0, 0.5], b_pos: [0, 0.5], b_ratio: [0.4, 0.65], b_track: [0.5, 1], fm_ab: [0, 0.3], c_level: [0, 0.3], c_shape: [0.2, 0.8], f2_mix: [0, 0.5], f2_blend: [0, 0.6], f2_track: [0.5, 1] },
  zap: { a_pos: [0.25, 0.8], a_tune: [-0.3, 0.1], p_amt: [0.5, 0.9], p_decay: [0.35, 0.55], p_curve: [-0.3, 0.4], decay: [0.35, 0.5], attack: [0, 0.05], hold: [0, 0.1], b_level: [0, 0.6], b_pos: [0.4, 1], b_ratio: [0.33, 0.55], b_det: [-0.3, 0.3], b_track: [0.8, 1], fm_ab: [0, 0.5], fm_ba: [0, 0.3], drive: [0, 0.5], reso: [0.3, 0.7], f_track: [0.5, 1], cutoff: [0.5, 0.85], f_morph: [0, 0.5] },
  snare: { a_pos: [0.1, 0.3], a_tune: [-0.2, 0], p_amt: [0.08, 0.2], p_decay: [0.15, 0.3], decay: [0.35, 0.5], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.4, 0.8], b_pos: [0.6, 1], b_ratio: [0.45, 0.62], b_track: [0, 0.4], n_level: [0.45, 0.85], n_colour: [-0.1, 0.6], n_decay: [0.55, 0.85], c_level: [0.1, 0.45], c_shape: [0.5, 1], c_tone: [0.65, 0.9], drive: [0, 0.3], f_morph: [0.2, 0.75], cutoff: [0.6, 0.9], reso: [0, 0.35] },
  clap: { repeat: [0.25, 0.45], spacing: [0.45, 0.62], a_pos: [0.5, 0.9], a_tune: [0, 0.2], p_amt: [0, 0.05], decay: [0.25, 0.38], attack: [0, 0.1], hold: [0, 0.1], b_level: [0.5, 0.9], b_pos: [0.7, 1], b_ratio: [0.5, 0.75], b_det: [-0.6, 0.6], b_track: [0, 0.3], n_level: [0.6, 0.95], n_colour: [-0.2, 0.4], n_decay: [0.6, 0.85], c_level: [0, 0.3], c_shape: [0.8, 1], f_morph: [0.35, 0.65], cutoff: [0.62, 0.82], reso: [0.1, 0.45] },
  rim: { a_pos: [0.2, 0.6], a_tune: [0.15, 0.35], p_amt: [0.02, 0.08], p_decay: [0.05, 0.2], decay: [0.15, 0.28], attack: [0, 0.02], hold: [0, 0.05], b_level: [0.3, 0.7], b_pos: [0.5, 0.9], b_ratio: [0.55, 0.72], b_track: [0, 0.5], c_level: [0.35, 0.75], c_shape: [0.3, 0.7], c_tone: [0.75, 0.95], c_len: [0.1, 0.4], fm_ab: [0, 0.3], f2_mix: [0, 0.4], f2_blend: [0, 0.3], f2_track: [0.5, 1] },
  bell: { a_pos: [0, 0.2], a_tune: [0.2, 0.5], p_amt: [-0.02, 0.02], decay: [0.55, 0.7], curve: [-0.3, 0.3], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.4, 0.8], b_pos: [0, 0.25], b_ratio: [0.55, 0.8], b_det: [-0.2, 0.2], b_track: [0, 0.2], fm_ab: [0.1, 0.45], f2_mix: [0, 0.4], f2_blend: [0, 0.4], f2_track: [0.7, 1] },
  'closed hat': { a_pos: [0.8, 1], a_tune: [0.6, 0.8], p_amt: [0, 0.03], decay: [0.12, 0.25], curve: [0.5, 1], attack: [0, 0.02], hold: [0, 0.05], b_level: [0.6, 0.9], b_pos: [0.75, 1], b_ratio: [0.62, 0.9], b_det: [-0.8, 0.8], b_track: [0, 0.1], n_level: [0.5, 0.9], n_colour: [0.5, 1], n_decay: [0.5, 0.8], fm_ab: [0.2, 0.6], fm_ba: [0, 0.35], f_morph: [0.75, 1], cutoff: [0.75, 0.95], reso: [0, 0.4] },
  'open hat': { a_pos: [0.8, 1], a_tune: [0.6, 0.8], p_amt: [0, 0.03], decay: [0.35, 0.5], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.6, 0.9], b_pos: [0.75, 1], b_ratio: [0.62, 0.9], b_det: [-0.8, 0.8], b_track: [0, 0.1], n_level: [0.5, 0.9], n_colour: [0.5, 1], n_decay: [0.6, 0.85], fm_ab: [0.2, 0.6], fm_ba: [0, 0.35], f_morph: [0.7, 1], cutoff: [0.72, 0.92], reso: [0, 0.4] },
  cymbal: { a_pos: [0.7, 1], a_tune: [0.55, 0.75], p_amt: [0, 0.03], decay: [0.55, 0.72], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.6, 0.9], b_pos: [0.7, 1], b_ratio: [0.65, 0.95], b_det: [-1, 1], b_track: [0, 0.1], n_level: [0.35, 0.75], n_colour: [0.3, 0.9], n_decay: [0.65, 0.9], fm_ab: [0.3, 0.7], fm_ba: [0.1, 0.45], f_morph: [0.6, 1], cutoff: [0.7, 0.9], reso: [0, 0.3] },
};
export const RECIPE_TYPES = Object.keys(STARTERS);
// parts a recipe leaves off unless its type names them (FM, NOISE, CLICK, DRIVE, FILTER 2; OSC B is named by every type)
const OFF_UNLESS = ['fm_ab', 'fm_ba', 'n_level', 'c_level', 'drive', 'f2_mix'];
// and FILTER 1 open, near enough, unless the type says otherwise
const OPEN = { cutoff: [0.85, 1], f_morph: [0, 0.1], reso: [0, 0.3], f_track: [0, 0.5] };
/** a sound of a named type (a starter recipe: no keepers to learn from yet) */
export function recipe(rnd, type) {
  const r = STARTERS[type] || {}, o = {};
  for (const p of PARAMS) o[p.id] = round(pick(rnd, r[p.id] || (p.id === 'a_level' ? [0.75, 0.95] : p.id === 'a_fine' ? [-0.1, 0.1] : OFF_UNLESS.includes(p.id) ? [0, 0] : OPEN[p.id] || p.safe)));
  return o;
}

// the tables a new sound's oscillators use. FREE: any built-in for each. A recipe: BASIC most of the time (its
// positions above are written for BASIC), else one of the type's own; a table other than BASIC gets a POSITION
// anywhere in it. Each entry: the type's choices for [OSC A, OSC B], with how often BASIC is kept
const B = (n) => 'builtin:' + n;
const TABLE_PICKS = {
  kick: [[B('harmonics'), B('odd'), B('bend')], [], 0.75],
  tom: [[B('harmonics'), B('odd'), B('formant')], [B('harmonics'), B('odd')], 0.6],
  perc: [[B('harmonics'), B('odd'), B('formant'), B('bend'), B('fold')], [B('sparse'), B('formant'), B('sync')], 0.4],
  zap: [[B('sync'), B('bend'), B('fold'), B('pulse')], [B('sync'), B('pulse'), B('steps')], 0.35],
  snare: [[B('harmonics'), B('bend')], [B('grit'), B('fold'), B('steps')], 0.45],
  clap: [[B('grit'), B('fold')], [B('grit'), B('steps')], 0.45],
  rim: [[B('odd'), B('bend'), B('formant')], [B('sparse'), B('grit')], 0.45],
  bell: [[B('harmonics'), B('sparse')], [B('sparse'), B('harmonics'), B('formant')], 0.4],
  'closed hat': [[B('grit'), B('sparse'), B('steps')], [B('grit'), B('sparse'), B('sync')], 0.35],
  'open hat': [[B('grit'), B('sparse'), B('steps')], [B('grit'), B('sparse'), B('sync')], 0.35],
  cymbal: [[B('grit'), B('sparse')], [B('grit'), B('sparse'), B('sync')], 0.35],
};
/** the tables for a new sound of a type ('' for FREE); p (its parameters) gets a fresh POSITION for a table that
 * isn't BASIC. -> { a, b } */
export function pickTables(rnd, type, p) {
  const one = (list, keepBasic) => (!list.length || rnd() < keepBasic ? B('basic') : list[Math.floor(rnd() * list.length)]);
  const r = TABLE_PICKS[type];
  const t = r ? { a: one(r[0], r[2]), b: one(r[1], r[2]) } : { a: BUILTIN_IDS[Math.floor(rnd() * BUILTIN_IDS.length)], b: BUILTIN_IDS[Math.floor(rnd() * BUILTIN_IDS.length)] };
  if (r && t.a !== B('basic')) p.a_pos = round(rnd());
  if (r && t.b !== B('basic')) p.b_pos = round(rnd());
  return t;
}

/** ALTER: each parameter moved around the home by depth (0..1) of its range: its safe range, or the whole range when
 * wild (the home always stays reachable). keep(id): a parameter that must not move (a closed padlock) */
export function alter(rnd, home, depth, wild, keep = () => false) {
  const o = { ...home };
  for (const p of PARAMS) {
    if (keep(p.id)) continue;
    const h = home[p.id], [a, b] = wild ? lim(p) : p.safe, lo = Math.min(a, h), hi = Math.max(b, h);
    o[p.id] = round(Math.min(hi, Math.max(lo, h + (rnd() * 2 - 1) * depth * (hi - lo))));
  }
  return o;
}

// ---- modulation routes ($m beside the parameters: { 'env>cutoff': amount -1..1 }) ----
// FREE: none, one or two of the routes that make sense, at any amount. A recipe: each of its type's routes by its
// chance, at an amount in its range. ALTER moves the amounts a sound has, never adds or removes a route.
const ROUTE_PICKS = { // [route, chance, [lo, hi] amount]
  kick: [['env>cutoff', 0.4, [0.3, 0.8]], ['vel>decay', 0.3, [0.1, 0.4]], ['vel>p_amt', 0.3, [0.1, 0.4]]],
  tom: [['vel>p_amt', 0.4, [0.2, 0.5]], ['vel>cutoff', 0.3, [0.3, 0.7]]],
  perc: [['env>a_pos', 0.4, [0.2, 0.7]], ['env>fm_ab', 0.3, [0.2, 0.6]], ['vel>fm_ab', 0.2, [0.2, 0.5]]],
  zap: [['env>fm_ab', 0.4, [0.3, 0.8]], ['env>a_pos', 0.4, [-0.7, 0.7]], ['lfo>a_tune', 0.2, [0.02, 0.08]]],
  snare: [['vel>cutoff', 0.4, [0.2, 0.6]], ['env>cutoff', 0.3, [0.2, 0.6]]],
  clap: [['env>cutoff', 0.4, [0.2, 0.6]], ['vel>cutoff', 0.3, [0.2, 0.5]]],
  rim: [['vel>c_level', 0.4, [0.2, 0.5]], ['env>f2_pitch', 0.2, [-0.4, 0.4]]],
  bell: [['lfo>a_pos', 0.3, [0.1, 0.3]], ['vel>fm_ab', 0.4, [0.2, 0.5]], ['env>fm_ab', 0.3, [0.2, 0.5]]],
  'closed hat': [['vel>decay', 0.4, [0.1, 0.3]], ['env>fm_ab', 0.3, [0.2, 0.5]]],
  'open hat': [['vel>decay', 0.4, [0.1, 0.3]], ['env>cutoff', 0.3, [0.1, 0.4]]],
  cymbal: [['lfo>b_pos', 0.3, [0.1, 0.4]], ['vel>decay', 0.3, [0.1, 0.3]]],
};
const ALL_ROUTES = MOD_SOURCES.flatMap((s) => MOD_ROUTES[s].map((id) => routeKey(s, id)));
/** the routes for a new sound of a type ('' for FREE) */
export function pickRoutes(rnd, type) {
  const m = {}, r = ROUTE_PICKS[type];
  if (r) { for (const [key, chance, rg] of r) if (rnd() < chance) m[key] = round(pick(rnd, rg)); return m; }
  const n = Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) { const key = ALL_ROUTES[Math.floor(rnd() * ALL_ROUTES.length)]; m[key] = round((rnd() < 0.5 ? -1 : 1) * (0.15 + rnd() * 0.65)); }
  return m;
}
/** ALTER on the routes: each amount moved around its home by depth (never past ±1, never to the other side unless wild) */
export function alterRoutes(rnd, home, depth, wild) {
  const o = {};
  for (const key in home || {}) {
    if (!validRoute(key)) continue;
    const h = home[key], lo = wild ? -1 : h < 0 ? -1 : 0, hi = wild ? 1 : h < 0 ? 0 : 1;
    o[key] = round(Math.min(hi, Math.max(lo, h + (rnd() * 2 - 1) * depth * (hi - lo))));
  }
  return o;
}
export { BY_ID };
