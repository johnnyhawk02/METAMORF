// Offline renders: one sound played by itself, faster than real time, for measuring (auto level, the dud filter, the
// rating mode). The same voice the instrument plays, so what is measured is what is heard; no master stage.
import { Voice } from './voice.js?v=mwm889or';

/** render params (normalised, by id) with out (level, pan, send, trim) at velocity vel, for up to seconds, at fs.
 * The render stops early once the voice has ended. Returns { L, R, peak, length } (L, R: Float32Array) */
export function renderSound(params, out, vel = 100, seconds = 2, fs = 48000) {
  const n = Math.round(seconds * fs), L = new Float32Array(n), R = new Float32Array(n), SL = new Float32Array(n), SR = new Float32Array(n);
  const v = new Voice(fs); v.start(params, out, vel, 1);
  let peak = 0, i = 0;
  for (; i < n && v.on; i += 128) peak = Math.max(peak, v.render(L, R, SL, SR, i, Math.min(n, i + 128)));
  return { L, R, peak, length: Math.min(n, i) };
}
