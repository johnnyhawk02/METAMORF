// node test/engine.test.mjs: the instrument offline (build step 1: the stub voice). Repeatable, finite, silent when it
// should be, no clicks when a knob turns during a note or a new note takes over, RETURN on the BPM grid, every key's
// output (level, pan, send) doing what it says.
import { Instrument } from '../engine/instrument.js';
import { PARAMS, BASE, OUT_DEFAULT, fullParams, zoneSizes, engineOf } from '../sound/params.js';
import { free, recipe, alter, RECIPE_TYPES } from '../sound/makers.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const fs = 48000, B = 128;
const seeded = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
// render n samples, calling at(i) at each block start (to change things mid-note)
function render(inst, n, at) {
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += B) { if (at) at(i); inst.render(L.subarray(i, Math.min(n, i + B)), R.subarray(i, Math.min(n, i + B))); }
  return { L, R };
}
const hit = (p, out = OUT_DEFAULT, n = fs, vel = 100) => { const I = new Instrument(fs); I.play(0, p, out, vel); return render(I, n); };
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const maxStep = (x, a = 1, b = x.length) => { let m = 0; for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };

// the layout: 25 keys in even zones, the extra keys at the top
ok(JSON.stringify([1, 2, 3, 4].map(zoneSizes)) === JSON.stringify([[25], [12, 13], [8, 8, 9], [6, 6, 6, 7]]), 'zone sizes ' + JSON.stringify([1, 2, 3, 4].map(zoneSizes)));
ok(engineOf(5, 4) === 0 && engineOf(6, 4) === 1 && engineOf(24, 4) === 3 && engineOf(18, 4) === 3 && engineOf(17, 4) === 2, 'engineOf');
// parameters: by id, missing ones take the default, unknown ones are dropped, values clamped
{ const p = fullParams({ a_tune: 5, nonsense: 1, decay: 'x' }); ok(p.a_tune === 1 && !('nonsense' in p) && p.decay === BASE.decay, 'fullParams ' + JSON.stringify(p)); }
ok(PARAMS.every((p) => p.safe[0] <= p.safe[1] && p.def >= (p.map === 'bip' ? -1 : 0) && p.def <= 1), 'a default or safe range out of bounds');

// repeatable: the same sound and velocity render the same, sample for sample
{ const rng = seeded(11);
  for (let t = 0; t < 5; t++) { const p = free(rng), a = hit(p).L, b = hit(p).L; ok(a.every((v, i) => v === b[i]), 'a sound rendered twice differs'); } }
// stable: random sounds (FREE, recipes, wild alters) stay finite, under 0 dBFS, without DC
{ const rng = seeded(7); let bad = 0, worst = 0;
  for (let t = 0; t < 300; t++) {
    const p = t % 3 === 0 ? free(rng) : t % 3 === 1 ? recipe(rng, RECIPE_TYPES[t % RECIPE_TYPES.length]) : alter(rng, free(rng), 1, true);
    const { L } = hit(p, { level: 1, pan: 0, send: 0, trim: 0 }, fs / 2, 127);
    let s = 0; for (let i = L.length - fs / 10; i < L.length; i++) s += L[i]; const dc = Math.abs(s / (fs / 10)), pk = peak(L); // (DC: an offset left in the last 100 ms)
    if (!L.every(Number.isFinite) || pk > 1 || (t % 3 < 2 && dc > 0.01)) bad++; worst = Math.max(worst, pk); // (DC: FREE and recipes; a wild alter may go subsonic)
  }
  ok(bad === 0, `${bad} random sounds not finite, over full scale or with DC (worst peak ${worst})`); }
// a voice ends: silent after its decay, and its engine free
{ const I = new Instrument(fs); I.play(0, { ...BASE, decay: 0.2 }, OUT_DEFAULT, 100); const { L } = render(I, fs / 2);
  ok(peak(L, fs / 4) === 0 && !I.eng[0].voice.on, 'a short sound still sounding after 250 ms'); }
// ATTACK at 0 doesn't click: the first samples rise over a ramp, no step bigger than the tone's own
{ const p = { ...BASE, attack: 0, p_amt: 0, a_tune: -0.5 }, { L } = hit(p, OUT_DEFAULT, 4800);
  ok(maxStep(L, 1, 8) < maxStep(L, 200, 4800) * 1.5 + 1e-3, `attack 0 clicks: ${maxStep(L, 1, 8)} vs ${maxStep(L, 200, 4800)}`); }
// every knob swept end to end over 50 ms during a long note: no step bigger than the steady note's own (plus a margin)
{ const steady = { ...BASE, a_tune: -0.3, p_amt: 0, decay: 1, curve: -1, hold: 1 };
  const ref = hit(steady, OUT_DEFAULT, fs / 2).L, refStep = maxStep(ref, fs / 10, fs / 2);
  for (const p of PARAMS) {
    if (['attack', 'hold'].includes(p.id)) continue; // (they shape a stage that has already passed)
    const lo = p.map === 'bip' ? -1 : 0, I = new Instrument(fs);
    I.play(0, { ...steady, [p.id]: lo }, OUT_DEFAULT, 100);
    const sweepAt = fs / 10, len = fs / 20;
    const { L } = render(I, fs / 2, (i) => { if (i >= sweepAt && i <= sweepAt + len) I.update(0, { [p.id]: lo + (1 - lo) * (i - sweepAt) / len }); });
    const st = maxStep(L, sweepAt, fs / 2);
    // a pitch knob may raise the tone's own steepness: compare with the steadiest note at its top setting
    const top = hit({ ...steady, [p.id]: 1 }, OUT_DEFAULT, fs / 2).L, topStep = maxStep(top, fs / 10, fs / 2);
    ok(L.every(Number.isFinite) && st <= Math.max(refStep, topStep) * 1.25 + 2e-3, `${p.id} swept in 50 ms: step ${st.toFixed(4)} vs ${Math.max(refStep, topStep).toFixed(4)}`);
  }
  // and the key's output (level, pan, send) turned during the note
  for (const k of ['level', 'pan']) {
    const I = new Instrument(fs); I.play(0, steady, { ...OUT_DEFAULT, [k]: k === 'pan' ? -1 : 0.2 }, 100);
    const { L, R } = render(I, fs / 2, (i) => { if (i >= fs / 10 && i <= fs / 10 + fs / 20) I.update(0, null, { [k]: k === 'pan' ? 1 : 1 }); });
    ok(Math.max(maxStep(L, fs / 10), maxStep(R, fs / 10)) <= refStep * 1.6 + 2e-3, `${k} turned in 50 ms clicks`);
  }
}
// a new note on a ringing engine: the old one fades out over a few ms, no step bigger than the notes' own
{ const p = { ...BASE, a_tune: -0.4, p_amt: 0, decay: 0.9, attack: 0.15 }, I = new Instrument(fs); I.play(0, p, OUT_DEFAULT, 127);
  const { L } = render(I, fs / 2, (i) => { if (i === 64 * B) I.play(0, { ...p, a_tune: -0.1 }, OUT_DEFAULT, 127); });
  const ref = hit({ ...p, a_tune: -0.1 }, OUT_DEFAULT, fs / 2, 127).L;
  // (while the old note fades the two overlap: no step bigger than both notes' own together, plus the fade's)
  const st = maxStep(L, 64 * B - 4, 64 * B + 400), own = maxStep(ref, 1000) + maxStep(L, 1000, 64 * B) + peak(L, 64 * B - 200, 64 * B) / (0.003 * fs);
  ok(st <= own * 1.1 + 1e-3, `a new note on a ringing engine clicks: ${st} vs ${own}`); }
// pan: hard left is silent on the right, centre equal on both sides; send collected, level 0 is silence
{ const L1 = hit(BASE, { ...OUT_DEFAULT, pan: -1 }, fs / 10); ok(peak(L1.R) < 1e-6 && peak(L1.L) > 0.05, 'pan hard left');
  const C = hit(BASE, OUT_DEFAULT, fs / 10); ok(Math.abs(peak(C.L) - peak(C.R)) < 1e-6, 'pan centre');
  ok(peak(hit(BASE, { ...OUT_DEFAULT, level: 0 }, fs / 10).L) === 0, 'level 0 is not silent');
  const I = new Instrument(fs); I.play(0, BASE, { ...OUT_DEFAULT, send: 0.5 }, 100); render(I, B); ok(peak(I.SL) > 0, 'the reverb send collects nothing'); }
// the engines are separate: a note on engine 2 doesn't stop engine 1
{ const I = new Instrument(fs), p = { ...BASE, decay: 0.8 }; I.play(0, p, OUT_DEFAULT, 100); render(I, B * 10); I.play(1, p, OUT_DEFAULT, 100); render(I, B);
  ok(I.eng[0].voice.on && I.eng[1].voice.on, 'a note on engine 2 stopped engine 1');
  I.setEngines(1); render(I, B * 10); ok(!I.eng[1].voice.on && I.eng[0].voice.on, 'ENGINES 1 left engine 2 sounding'); }
// RETURN: a note coming back starts on the next 1/16 of the BPM (120: every 6000 samples), or at once with NOW
{ const I = new Instrument(fs); I.setFx({ tempo: { bpm: 120, ret: 2 } }); render(I, 1000);
  I.back(0, BASE, OUT_DEFAULT, 100); const { L } = render(I, 8000);
  const first = L.findIndex((v) => v !== 0); ok(first === 5000 || first === 5001, 'RETURN 1/16 started at ' + (first + 1000));
  I.setFx({ tempo: { ret: 0 } }); I.back(0, BASE, OUT_DEFAULT, 100); ok(I.eng[0].voice.on && I.eng[0].pending === null, 'RETURN NOW');
  I.back(0, BASE, OUT_DEFAULT, 100); I.setFx({ tempo: { ret: 4 } }); I.back(0, BASE, OUT_DEFAULT, 100); I.release(0); ok(I.eng[0].pending === null, 'a release still brings the key back'); }
// the master: the output level scales, the limiter never lets a sample past full scale
{ const I = new Instrument(fs); I.setFx({ master: { level: 100 } }); I.play(0, { ...BASE, a_level: 1, decay: 0.6 }, { level: 1, pan: 0, send: 0, trim: 12 }, 127);
  const { L } = render(I, fs / 4); ok(peak(L) <= 1 && peak(L) > 0.9, 'the limiter: peak ' + peak(L)); }
// speed: four engines ringing, a second of sound, well under real time
{ const I = new Instrument(fs), p = { ...BASE, decay: 1, hold: 1 }; for (let e = 0; e < 4; e++) I.play(e, p, OUT_DEFAULT, 100);
  const t0 = performance.now(); render(I, fs); const ms = performance.now() - t0;
  console.log(`  four engines, one second: ${ms.toFixed(1)} ms`); ok(ms < 250, 'too slow: ' + ms); }
console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
