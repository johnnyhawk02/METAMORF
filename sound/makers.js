// New sounds, as normalised parameters by id. No UI here; rnd is a function giving 0..1.
//
// Build step 1 has the ones that need no kept sounds: FREE (every parameter anywhere in its safe range), the starter
// recipes (a sound of a named type, hand-tuned ranges for the stub voice) and ALTER (a nudge around a sound's home).
// LIBRARY, BREED, MORPH, STYLE and the learned recipes come with the library (build steps 10 and 11).
import { PARAMS, BY_ID, isBip } from './params.js?v=mwm5a0zk';

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
// and level-like ones stay near full. OSC B is off unless a type names it. Written for the engine core (two
// oscillators on BASIC); rewritten for the whole voice in build step 10. POSITION on BASIC: 0 sine, .25 triangle,
// .5 saw, .75 square, 1 narrow pulse. RATIO: 1/3 is x1, .5 is x2, .6 about x3, .69 about x4.4
export const STARTERS = {
  kick: { a_pos: [0, 0.12], a_tune: [-0.55, -0.4], p_amt: [0.25, 0.45], p_decay: [0.18, 0.32], p_curve: [0.4, 0.9], decay: [0.42, 0.58], curve: [0, 0.6], attack: [0, 0.05], hold: [0, 0.2], b_level: [0, 0] },
  tom: { a_pos: [0, 0.2], a_tune: [-0.4, -0.15], p_amt: [0.06, 0.15], p_decay: [0.3, 0.45], decay: [0.42, 0.55], attack: [0, 0.05], hold: [0, 0.15], b_level: [0, 0.3], b_pos: [0, 0.1], b_ratio: [0.38, 0.45], b_track: [0.7, 1] },
  perc: { a_pos: [0, 0.45], a_tune: [-0.1, 0.25], p_amt: [0.02, 0.1], p_decay: [0.15, 0.35], decay: [0.3, 0.45], attack: [0, 0.05], hold: [0, 0.1], b_level: [0, 0.5], b_pos: [0, 0.5], b_ratio: [0.4, 0.65], b_track: [0.5, 1] },
  zap: { a_pos: [0.25, 0.8], a_tune: [-0.3, 0.1], p_amt: [0.5, 0.9], p_decay: [0.35, 0.55], p_curve: [-0.3, 0.4], decay: [0.35, 0.5], attack: [0, 0.05], hold: [0, 0.1], b_level: [0, 0.6], b_pos: [0.4, 1], b_ratio: [0.33, 0.55], b_det: [-0.3, 0.3], b_track: [0.8, 1] },
  snare: { a_pos: [0.1, 0.3], a_tune: [-0.2, 0], p_amt: [0.08, 0.2], p_decay: [0.15, 0.3], decay: [0.35, 0.5], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.4, 0.8], b_pos: [0.6, 1], b_ratio: [0.45, 0.62], b_track: [0, 0.4] },
  clap: { a_pos: [0.5, 0.9], a_tune: [0, 0.2], p_amt: [0, 0.05], decay: [0.25, 0.38], attack: [0, 0.1], hold: [0, 0.1], b_level: [0.5, 0.9], b_pos: [0.7, 1], b_ratio: [0.5, 0.75], b_det: [-0.6, 0.6], b_track: [0, 0.3] },
  rim: { a_pos: [0.2, 0.6], a_tune: [0.15, 0.35], p_amt: [0.02, 0.08], p_decay: [0.05, 0.2], decay: [0.15, 0.28], attack: [0, 0.02], hold: [0, 0.05], b_level: [0.3, 0.7], b_pos: [0.5, 0.9], b_ratio: [0.55, 0.72], b_track: [0, 0.5] },
  bell: { a_pos: [0, 0.2], a_tune: [0.2, 0.5], p_amt: [-0.02, 0.02], decay: [0.55, 0.7], curve: [-0.3, 0.3], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.4, 0.8], b_pos: [0, 0.25], b_ratio: [0.55, 0.8], b_det: [-0.2, 0.2], b_track: [0, 0.2] },
  'closed hat': { a_pos: [0.8, 1], a_tune: [0.6, 0.8], p_amt: [0, 0.03], decay: [0.12, 0.25], curve: [0.5, 1], attack: [0, 0.02], hold: [0, 0.05], b_level: [0.6, 0.9], b_pos: [0.75, 1], b_ratio: [0.62, 0.9], b_det: [-0.8, 0.8], b_track: [0, 0.1] },
  'open hat': { a_pos: [0.8, 1], a_tune: [0.6, 0.8], p_amt: [0, 0.03], decay: [0.35, 0.5], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.6, 0.9], b_pos: [0.75, 1], b_ratio: [0.62, 0.9], b_det: [-0.8, 0.8], b_track: [0, 0.1] },
  cymbal: { a_pos: [0.7, 1], a_tune: [0.55, 0.75], p_amt: [0, 0.03], decay: [0.55, 0.72], attack: [0, 0.03], hold: [0, 0.1], b_level: [0.6, 0.9], b_pos: [0.7, 1], b_ratio: [0.65, 0.95], b_det: [-1, 1], b_track: [0, 0.1] },
};
export const RECIPE_TYPES = Object.keys(STARTERS);
/** a sound of a named type (a starter recipe: no keepers to learn from yet) */
export function recipe(rnd, type) {
  const r = STARTERS[type] || {}, o = {};
  for (const p of PARAMS) o[p.id] = round(pick(rnd, r[p.id] || (p.id === 'a_level' ? [0.75, 0.95] : p.id === 'a_fine' ? [-0.1, 0.1] : p.safe)));
  return o;
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
export { BY_ID };
