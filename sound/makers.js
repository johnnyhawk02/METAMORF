// New sounds, as normalised parameters by id. No UI here; rnd is a function giving 0..1.
//
// Build step 1 has the ones that need no kept sounds: FREE (every parameter anywhere in its safe range), the starter
// recipes (a sound of a named type, hand-tuned ranges for the stub voice) and ALTER (a nudge around a sound's home).
// LIBRARY, BREED, MORPH, STYLE and the learned recipes come with the library (build steps 10 and 11).
import { PARAMS, BY_ID, isBip } from './params.js?v=mwm45f0r';

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
// and level-like ones stay near full. Rewritten for the whole voice in build step 10
export const STARTERS = {
  kick: { a_tune: [-0.55, -0.4], p_amt: [0.25, 0.45], p_decay: [0.18, 0.32], p_curve: [0.4, 0.9], decay: [0.42, 0.58], curve: [0, 0.6], attack: [0, 0.05], hold: [0, 0.2] },
  tom: { a_tune: [-0.4, -0.15], p_amt: [0.06, 0.15], p_decay: [0.3, 0.45], decay: [0.42, 0.55], attack: [0, 0.05], hold: [0, 0.15] },
  perc: { a_tune: [-0.1, 0.25], p_amt: [0.02, 0.1], p_decay: [0.15, 0.35], decay: [0.3, 0.45], attack: [0, 0.05], hold: [0, 0.1] },
  zap: { a_tune: [-0.3, 0.1], p_amt: [0.5, 0.9], p_decay: [0.35, 0.55], p_curve: [-0.3, 0.4], decay: [0.35, 0.5], attack: [0, 0.05], hold: [0, 0.1] },
  snare: { a_tune: [-0.2, 0], p_amt: [0.08, 0.2], p_decay: [0.15, 0.3], decay: [0.35, 0.5], attack: [0, 0.03], hold: [0, 0.1] },
  clap: { a_tune: [0, 0.2], p_amt: [0, 0.05], decay: [0.25, 0.38], attack: [0, 0.1], hold: [0, 0.1] },
  rim: { a_tune: [0.15, 0.35], p_amt: [0.02, 0.08], p_decay: [0.05, 0.2], decay: [0.15, 0.28], attack: [0, 0.02], hold: [0, 0.05] },
  bell: { a_tune: [0.2, 0.5], p_amt: [-0.02, 0.02], decay: [0.55, 0.7], curve: [-0.3, 0.3], attack: [0, 0.03], hold: [0, 0.1] },
  'closed hat': { a_tune: [0.6, 0.8], p_amt: [0, 0.03], decay: [0.12, 0.25], curve: [0.5, 1], attack: [0, 0.02], hold: [0, 0.05] },
  'open hat': { a_tune: [0.6, 0.8], p_amt: [0, 0.03], decay: [0.35, 0.5], attack: [0, 0.03], hold: [0, 0.1] },
  cymbal: { a_tune: [0.55, 0.75], p_amt: [0, 0.03], decay: [0.55, 0.72], attack: [0, 0.03], hold: [0, 0.1] },
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
