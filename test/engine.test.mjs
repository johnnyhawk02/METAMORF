// node test/engine.test.mjs: the instrument offline (build step 2: the engine core, two oscillators on BASIC). Repeatable, finite, silent when it
// should be, no clicks when a knob turns during a note or a new note takes over, RETURN on the BPM grid, every key's
// output (level, pan, send) doing what it says.
import { Instrument } from '../engine/instrument.js';
import { PARAMS, BASE, OUT_DEFAULT, fullParams, zoneSizes, engineOf } from '../sound/params.js';
import { free, recipe, alter, RECIPE_TYPES } from '../sound/makers.js';
import { basic, read, fft, FRAME, LEVELS } from '../engine/tables.js';
import { renderSound } from '../engine/offline.js';
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
    // (a shape knob's steepest setting may sit in the middle of its range: compare with the steepest of five settings)
    const topStep = Math.max(...[0.25, 0.5, 0.75, 1].map((x) => maxStep(hit({ ...steady, [p.id]: lo + (1 - lo) * x }, OUT_DEFAULT, fs / 2).L, fs / 10, fs / 2)));
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
{ const I = new Instrument(fs), p = { ...BASE, decay: 1, hold: 1, b_level: 0.7, a_pos: 0.6, b_pos: 0.9 }; for (let e = 0; e < 4; e++) I.play(e, p, OUT_DEFAULT, 100);
  const t0 = performance.now(); render(I, fs); const ms = performance.now() - t0;
  console.log(`  four engines, one second: ${ms.toFixed(1)} ms`); ok(ms < 250, 'too slow: ' + ms); }

// ---- the wavetable (BASIC) ----
const spectrum = (x) => { // power by bin of a Blackman-Harris windowed block (sidelobes under -92 dB; length a power of two)
  const n = x.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; re[i] = x[i] * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t)); }
  fft(re, im, -1); const p = new Float64Array(n / 2); for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p;
};
{ const a = basic(), b = basic();
  ok(a.frames === 41 && a.data.length === LEVELS && a.data.every((d, l) => d.every((v, i) => v === b.data[l][i])), 'BASIC is not the same twice');
  ok(a.data.every((d) => d.every(Number.isFinite)), 'BASIC has a sample that is not a number');
  // each frame's full-band copy peaks at 1, and its first copy at the guard sample repeats the start
  let worst = 0; for (let f = 0; f < a.frames; f++) { let m = 0; for (let i = 0; i < FRAME; i++) m = Math.max(m, Math.abs(a.data[0][f * (FRAME + 1) + i])); worst = Math.max(worst, Math.abs(m - 1)); }
  ok(worst < 1e-5, 'a BASIC frame does not peak at 1: ' + worst);
  // frame 0 is a sine, frame 20 a saw (harmonics falling as 1/k), the last a narrow pulse (energy in many harmonics)
  const frame = (f) => Array.from({ length: FRAME }, (_, i) => a.data[0][f * (FRAME + 1) + i]);
  const sp = (f) => { const re = Float64Array.from(frame(f)), im = new Float64Array(FRAME); fft(re, im, -1); return Array.from({ length: 12 }, (_, k) => Math.hypot(re[k], im[k])); };
  const s0 = sp(0), s20 = sp(20), s40 = sp(40);
  ok(s0[2] < s0[1] * 1e-4 && s0[3] < s0[1] * 1e-4, 'BASIC frame 0 is not a sine');
  ok(Math.abs(s20[2] / s20[1] - 0.5) < 0.01 && Math.abs(s20[5] / s20[1] - 0.2) < 0.01, 'BASIC frame 20 is not a saw');
  ok(s40[5] / s40[1] > 0.5, 'the last BASIC frame is not a narrow pulse'); }
// band-limited: a saw at 2950 Hz (at 48 kHz) and a narrow pulse at 7130 Hz: everything off the harmonics stays under
// -60 dB of the total
{ const T = basic();
  for (const [pos, hz] of [[0.5, 2950], [1, 7130], [0.5, 13100]]) {
    const n = 16384, x = new Float64Array(n); let ph = 0; for (let i = 0; i < n; i++) { x[i] = read(T, pos, ph, hz, fs); ph = (ph + hz / fs) % 1; }
    const p = spectrum(x), bin = fs / n; let all = 0, off = 0;
    for (let k = 1; k < n / 2; k++) { all += p[k]; const f = k * bin, h = f / hz, d = Math.abs(h - Math.round(h)) * hz; if (d > 8 * bin || Math.round(h) < 1) off += p[k]; }
    const db = 10 * Math.log10(off / all); ok(db < -60, `BASIC at ${hz} Hz (position ${pos}): aliasing ${db.toFixed(1)} dB`);
  } }
// a pitch sweep through every octave copy: the level never steps (a saw falling from 12 kHz to 30 Hz in 2 s)
{ const T = basic(), n = 2 * fs; let ph = 0, prev = null, worst = 0, rms = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const hz = 12000 * Math.pow(30 / 12000, i / n), y = read(T, 0.5, ph, hz, fs); ph = (ph + hz / fs) % 1; rms += y * y; cnt++;
    if (cnt === 2400) { const r = Math.sqrt(rms / cnt); if (prev !== null && hz < 8000) worst = Math.max(worst, Math.abs(20 * Math.log10(r / prev))); prev = r; rms = 0; cnt = 0; }
  }
  ok(worst < 1, `a saw sweeping down: the level steps by ${worst.toFixed(2)} dB between 50 ms blocks`); }
// OSC B: RATIO 2 an octave above A, TRACK 0 holds B still while A sweeps, its level 0 silences it
{ const only = (p) => renderSound({ ...BASE, a_level: 0, b_level: 0.8, p_amt: 0, decay: 0.8, hold: 0.5, ...p }, OUT_DEFAULT, 100, 0.25, fs).L;
  const zc = (x) => { let c = 0; for (let i = fs / 20; i < fs / 5; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / 0.15; };
  const b1 = zc(only({ b_ratio: 1 / 3 })), b2 = zc(only({ b_ratio: 0.5 }));
  ok(Math.abs(b1 - 261.6) < 10 && Math.abs(b2 - 523.3) < 15, `OSC B pitch ${b1} and ${b2} Hz at ratio 1 and 2`);
  const fixed = zc(only({ b_track: 0, p_amt: 0.5, p_decay: 1 })), moving = zc(only({ b_track: 1, p_amt: 0.5, p_decay: 1 }));
  ok(Math.abs(fixed - 261.6) < 10 && moving > fixed * 3, `TRACK 0 should hold B's pitch: ${fixed} vs ${moving} Hz`);
  ok(peak(renderSound({ ...BASE, b_level: 0 }, OUT_DEFAULT, 100, 0.1, fs).L) === peak(renderSound({ ...BASE, b_level: 0, b_ratio: 0.9, b_pos: 1 }, OUT_DEFAULT, 100, 0.1, fs).L), 'OSC B at level 0 still sounds'); }
// the offline render is the voice the instrument plays: the same samples (before the master)
{ const p = recipe(seeded(3), 'snare'), off = renderSound(p, OUT_DEFAULT, 100, 0.3, fs), I = new Instrument(fs); I.play(0, p, OUT_DEFAULT, 100);
  const n = 0.3 * fs, EL = new Float32Array(n); for (let i = 0; i < n; i += B) { I.render(new Float32Array(B), new Float32Array(B)); EL.set(I.EL[0].subarray(0, Math.min(B, n - i)), i); }
  ok(EL.every((v, i) => v === off.L[i]), 'the offline render differs from the instrument');
  ok(off.peak > 0 && off.length > 0 && off.length <= n, 'the offline render: peak and length'); }
console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
