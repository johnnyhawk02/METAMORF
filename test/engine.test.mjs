// node test/engine.test.mjs: the instrument offline (build step 2: the engine core, two oscillators on BASIC). Repeatable, finite, silent when it
// should be, no clicks when a knob turns during a note or a new note takes over, RETURN on the BPM grid, every key's
// output (level, pan, send) doing what it says.
import { Instrument } from '../engine/instrument.js';
import { PARAMS, BASE, OUT_DEFAULT, fullParams, zoneSizes, engineOf } from '../sound/params.js';
import { free, recipe, alter, RECIPE_TYPES } from '../sound/makers.js';
import { readFileSync } from 'node:fs';
import { basic, builtin, read, fft, LEVELS, BUILTINS as MAKERS, fromFrames, DEFAULT_TABLE } from '../engine/tables.js';
// (the tables the voice holds: the voice's own copy of the module, by the same cache-busting stamp it imports it with)
const STAMP = (/from '\.\/tables\.js(\?v=\w+)?'/.exec(readFileSync(new URL('../engine/voice.js', import.meta.url), 'utf8')) || [])[1] || '';
const { need, hold, table } = await import('../engine/tables.js' + STAMP);
import { renderSound } from '../engine/offline.js';
import { Voice } from '../engine/voice.js';
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
    let s = 0, e = 0; for (let i = 0; i < L.length; i++) { s += L[i]; e += L[i] * L[i]; } const dc = Math.abs(s / L.length) / Math.max(0.3, Math.sqrt(e / L.length)), pk = peak(L); // (DC: the mean over the whole 500 ms against the RMS (at least 0.3), under a tenth, so a loud dark noise or a slow cross-FM wander still ringing isn't taken for an offset)
    if (!L.every(Number.isFinite) || pk > 1 || (t % 3 < 2 && dc > 0.1)) bad++; // (cross-FM through DRIVE can wander slowly below 10 Hz: musical, not an offset; the voice's DC blocker takes any true DC) worst = Math.max(worst, pk); // (DC: FREE and recipes; a wild alter may go subsonic)
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
  // each frame's full-band copy peaks at 1
  const N0 = a.size[0], frame = (f) => Array.from({ length: N0 }, (_, i) => a.data[0][f * (N0 + 5) + 2 + i]);
  let worst = 0; for (let f = 0; f < a.frames; f++) worst = Math.max(worst, Math.abs(Math.max(...frame(f).map(Math.abs)) - 1));
  ok(worst < 1e-5, 'a BASIC frame does not peak at 1: ' + worst);
  // frame 0 is a sine, frame 20 a saw (harmonics falling as 1/k), the last a narrow pulse (energy in many harmonics)
  const sp = (f) => { const re = Float64Array.from(frame(f)), im = new Float64Array(N0); fft(re, im, -1); return Array.from({ length: 12 }, (_, k) => Math.hypot(re[k], im[k])); };
  const s0 = sp(0), s20 = sp(20), s40 = sp(40);
  ok(s0[2] < s0[1] * 1e-4 && s0[3] < s0[1] * 1e-4, 'BASIC frame 0 is not a sine');
  ok(Math.abs(s20[2] / s20[1] - 0.5) < 0.01 && Math.abs(s20[5] / s20[1] - 0.2) < 0.01, 'BASIC frame 20 is not a saw');
  ok(s40[5] / s40[1] > 0.5, 'the last BASIC frame is not a narrow pulse'); }

// ---- every built-in table from C-2 (MIDI 0, 8.2 Hz; and 4.1 Hz, an octave lower) to C7 (MIDI 108, 4186 Hz), at 48
// and 44.1 kHz, at five positions: nothing off the harmonics above -60 dB (no aliasing, no interpolation images);
// every harmonic up to a quarter of the sample rate within 0.5 dB of the table's own (the band-limiting takes
// nothing from the audible range below that); the low notes keep their highs (to 16 kHz at C-2 and below) ----
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BUILTINS = MAKERS.map((b) => (b[0] === DEFAULT_TABLE ? basic() : builtin(b[0])));
const t0 = Date.now();
for (const T of process.env.QUICK ? [] : BUILTINS) for (const rate of [48000, 44100]) {
  let worstAlias = -999, worstBand = 0, lowTop = Infinity, quiet = 0; const where = [];
  const pitches = [4.0879, ...Array.from({ length: 19 }, (_, i) => midiHz(i * 6)), midiHz(105), midiHz(107)];
  for (const hz of pitches) for (const pos of [0, 0.25, 0.5, 0.75, 1]) {
    // the reference: this frame's own spectrum, from the full-band copy
    const N0 = T.size[0], fp = pos * (T.frames - 1), f0 = Math.min(fp | 0, T.frames - 2), ff = fp - f0, ref = new Float64Array(N0), rim = new Float64Array(N0);
    for (let i = 0; i < N0; i++) ref[i] = T.data[0][f0 * (N0 + 5) + 2 + i] * (1 - ff) + T.data[0][(f0 + 1) * (N0 + 5) + 2 + i] * ff;
    fft(ref, rim, -1); const want = (k) => (k < N0 / 2 ? Math.hypot(ref[k], rim[k]) / (N0 / 2) : 0);
    // (a frame with almost nothing under half the rate at this pitch, such as SYNC's last, a pure 8th harmonic, plays
    // almost silence up here: nothing to measure)
    let inband = 0, full = 0, kmax = 1; for (let k = 1; k < N0 / 2; k++) { const w = want(k) ** 2; full += w; if (k * hz < rate / 2) { inband += w; if (w > want(kmax) ** 2) kmax = k; } }
    if (inband < 1e-3 * full) { quiet++; continue; }
    const n = hz < 30 ? 1 << 19 : hz < 300 ? 1 << 17 : 1 << 15, x = new Float64Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { x[i] = read(T, pos, ph, hz, rate); ph += hz / rate; ph -= Math.floor(ph); }
    const p = spectrum(x), bin = rate / n; let all = 0, off = 0;
    const harm = new Float64Array(Math.floor(rate / 2 / hz) + 2);
    for (let k = 1; k < n / 2; k++) { all += p[k]; const h = k * bin / hz, hk = Math.round(h); if (Math.abs(h - hk) * hz > 8 * bin || hk < 1) off += p[k]; else harm[hk] += p[k]; }
    const db = 10 * Math.log10(off / all); if (db > worstAlias) { worstAlias = db; where[0] = `${hz.toFixed(1)} Hz pos ${pos}`; }
    // (the window's power gain: compare with the fundamental, as ratios of the table's own)
    const g1 = Math.sqrt(harm[kmax]) / want(kmax);
    let top = 0;
    for (let k = 1; k < harm.length && k * hz < rate / 2; k++) {
      const w = want(k); if (w < want(kmax) * 1e-4) continue; // (harmonics under -80 dB of the strongest: too faint to judge)
      const got = 20 * Math.log10(Math.sqrt(harm[k]) / g1 / w);
      // (at C-2 and below, everything up to 15.5 kHz must be kept; above, up to a quarter of the rate)
      if (got > -0.5) top = k * hz; else if (k * hz <= (hz < 9 ? 15500 : rate * 0.24) && -got > worstBand) { worstBand = -got; where[1] = `${hz.toFixed(1)} Hz pos ${pos}, harmonic ${k}`; }
    }
    if (hz < 9 && pos === 0.5) lowTop = Math.min(lowTop, top);
  }
  console.log(`  ${T.name} at ${rate}: worst aliasing ${worstAlias.toFixed(1)} dB (${where[0]}), worst loss under ${rate * 0.24} Hz ${worstBand.toFixed(2)} dB, a saw at C-2 and below reaches ${Math.round(lowTop)} Hz${quiet ? ` (${quiet} near-silent cases skipped)` : ''}`);
  ok(worstAlias < -60, `${T.name} at ${rate}: aliasing ${worstAlias.toFixed(1)} dB at ${where[0]}`);
  ok(worstBand < 0.5, `${T.name} at ${rate}: a harmonic under a quarter of the rate lost ${worstBand.toFixed(2)} dB at ${where[1]}`);
  if (T.name === 'BASIC') ok(lowTop >= 15500, `${T.name} at ${rate}: a saw at C-2 and below only reaches ${lowTop} Hz`);
}
console.log(`  (every built-in table checked in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
// every built-in table: the same every time it is built (the seeded ones too), every sample a number, each frame
// peaking at 1, and the frames all different (a sweep, not a still)
for (const T of BUILTINS) {
  const again = builtin(T.id), N0 = T.size[0], d = T.data[0], frame = (f) => d.subarray(f * (N0 + 5) + 2, f * (N0 + 5) + 2 + N0);
  ok(T.data.every((x, l) => x.every((v, i) => v === again.data[l][i])), `${T.name} is not the same twice`);
  ok(T.data.every((x) => x.every(Number.isFinite)), `${T.name} has a sample that is not a number`);
  let worst = 0, same = 0; for (let f = 0; f < T.frames; f++) { let m = 0; for (const v of frame(f)) m = Math.max(m, Math.abs(v)); worst = Math.max(worst, Math.abs(m - 1)); if (f && frame(f).every((v, i) => Math.abs(v - frame(f - 1)[i]) < 1e-6)) same++; }
  ok(worst < 1e-5, `a ${T.name} frame does not peak at 1: ${worst}`);
  ok(same === 0, `${T.name}: ${same} frames are the same as the one before`);
}
ok(BUILTINS.length === 11 && new Set(BUILTINS.map((t) => t.id)).size === 11 && BUILTINS.every((t) => /^builtin:[a-z]+$/.test(t.id)), 'the built-in ids');
// no stepping: a saw and a narrow pulse sweeping from C7 down to C-2 and back over 4 s: the level of each 50 ms
// stays within 1.5 dB of its neighbour, and the waveform never jumps (a change of copy is a crossfade)
for (const pos of [0.5, 1]) { const T = BUILTINS[0], n = 4 * fs; let ph = 0, prev = null, worst = 0, at = 0, rms = 0, cnt = 0, jump = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const t = i < n / 2 ? i / (n / 2) : 2 - i / (n / 2), hz = midiHz(108 - 108 * t), y = read(T, pos, ph, hz, fs);
    ph += hz / fs; ph -= Math.floor(ph); rms += y * y; cnt++;
    if (cnt === 2400) { const r = Math.sqrt(rms / cnt); if (prev !== null && hz > 400) { /* (a block of at least twenty cycles: fewer read uneven) */ const st = Math.abs(20 * Math.log10(r / prev)); if (st > worst) { worst = st; at = hz; } } prev = r; rms = 0; cnt = 0; }
    // the same phase read a hair higher in pitch: a crossfade never jumps
    const y2 = read(T, pos, ph, hz * 1.0001, fs), y1 = read(T, pos, ph, hz, fs); jump = Math.max(jump, Math.abs(y2 - y1)); last = y;
  }
  // (a 50 ms block spans almost 3 semitones of this sweep: a narrow pulse, whose top octave carries much of its
  // level, may lose up to 1.5 dB of it smoothly over the crossfade to the next copy; a step would show as a jump)
  ok(worst < 1.5, `a sweep at position ${pos}: the level steps by ${worst.toFixed(2)} dB between 50 ms blocks (at ${at.toFixed(0)} Hz)`);
  ok(jump < 0.01, `a sweep at position ${pos}: the waveform jumps by ${jump.toFixed(4)} for a pitch change of 0.0001`); }
// above C7: a pitch envelope can push a note right up to the top (0.45 of the rate); still nothing aliased
{ const T = BUILTINS[0]; let worst = -999;
  for (const hz of [6000, 9000, 15000, 21000]) for (const pos of [0.5, 1]) {
    const n = 1 << 15, x = new Float64Array(n); let ph = 0; for (let i = 0; i < n; i++) { x[i] = read(T, pos, ph, hz, fs); ph = (ph + hz / fs) % 1; }
    const p = spectrum(x), bin = fs / n; let all = 0, off = 0;
    for (let k = 1; k < n / 2; k++) { all += p[k]; const h = k * bin / hz; if (Math.abs(h - Math.round(h)) * hz > 8 * bin || Math.round(h) < 1) off += p[k]; }
    worst = Math.max(worst, 10 * Math.log10(off / all));
  }
  ok(worst < -60, `above C7: aliasing ${worst.toFixed(1)} dB`); }
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
// ---- tables in the voice ----
// a table the thread doesn't hold plays BASIC (and nothing breaks); once it arrives, the next note uses it
{ const p = { ...BASE, a_pos: 0.5, p_amt: 0 }, want = renderSound(p, OUT_DEFAULT, 100, 0.2, fs).L;
  const gone = renderSound({ ...p, $a: 'user:00000000000000ff' }, OUT_DEFAULT, 100, 0.2, fs).L;
  ok(gone.every((v, i) => v === want[i]), 'a missing table does not play BASIC');
  need('builtin:grit'); const g = renderSound({ ...p, $a: 'builtin:grit' }, OUT_DEFAULT, 100, 0.2, fs).L;
  ok(g.some((v, i) => Math.abs(v - want[i]) > 0.01), 'GRIT plays the same as BASIC'); }
// a table changed during a note crossfades: at any point of the cycle, no step bigger than the two tables' own
{ need('builtin:bend'); // (BEND's first frame is a cosine, upside down: a sine turned a quarter-cycle on, so a hard switch would jump)
  const p = { ...BASE, a_pos: 0, a_tune: 0, p_amt: 0, decay: 0.9, hold: 0.8 };
  // (the engine's own output, before the master: the master's gain moves with the level)
  const pre = (inst, n) => { const L = new Float32Array(n); for (let i = 0; i < n; i += B) { inst.render(new Float32Array(B), new Float32Array(B)); L.set(inst.EL[0].subarray(0, Math.min(B, n - i)), i); } return L; };
  let worst = 0, last = null;
  for (let k = 0; k < 8; k++) {
    const n0 = (40 + k) * B, I = new Instrument(fs); I.play(0, { ...p, $a: DEFAULT_TABLE }, OUT_DEFAULT, 100);
    const a = pre(I, n0); I.update(0, { $a: 'builtin:bend' }, null); const b = pre(I, fs / 50);
    const I2 = new Instrument(fs); I2.play(0, { ...p, $a: 'builtin:bend' }, OUT_DEFAULT, 100); const sq = pre(I2, n0 + fs / 50).subarray(n0);
    const own = Math.max(maxStep(a, n0 - 400), maxStep(sq)), jump = Math.abs(b[0] - a[n0 - 1]), at = Math.max(maxStep(b), jump);
    worst = Math.max(worst, at / own); last = [b, sq];
  }
  ok(worst <= 1.05, `a table change mid-note steps by ${worst.toFixed(2)} times the tables' own`);
  ok(Math.abs(peak(last[0], fs / 100) - peak(last[1], fs / 100)) < 0.02, 'after a table change the note plays the new table'); }
// a user table from frames: a saw drawn naively (every sample, all its aliasing included) reads band-limited
{ const frames = Array.from({ length: 4 }, (_, f) => Float32Array.from({ length: 2048 }, (_, i) => (((i / 2048) * (f + 1)) % 1) * 2 - 1));
  const T = fromFrames('user:0123456789abcdef', 'TEST', frames); hold(T);
  ok(table('user:0123456789abcdef') === T && T.frames === 4, 'a user table is held');
  let worst = -999;
  for (const hz of [110, 1000, 3000]) for (const pos of [0, 1]) {
    const n = 1 << 15, x = new Float64Array(n); let ph = 0; for (let i = 0; i < n; i++) { x[i] = read(T, pos, ph, hz, fs); ph = (ph + hz / fs) % 1; }
    const sp = spectrum(x), bin = fs / n; let all = 0, off = 0;
    for (let k = 1; k < n / 2; k++) { all += sp[k]; const h = k * bin / hz; if (Math.abs(h - Math.round(h)) * hz > 8 * bin || Math.round(h) < 1) off += sp[k]; }
    worst = Math.max(worst, 10 * Math.log10(off / all));
  }
  ok(worst < -60, `a user table aliases at ${worst.toFixed(1)} dB`); }
// the offline render with a table other than BASIC is still the instrument's voice
{ const p = { ...recipe(seeded(5), 'closed hat'), $a: 'builtin:grit', $b: 'builtin:sparse' }; need('builtin:sparse');
  const off = renderSound(p, OUT_DEFAULT, 100, 0.2, fs), I = new Instrument(fs); I.play(0, p, OUT_DEFAULT, 100);
  const n = 0.2 * fs, EL = new Float32Array(n); for (let i = 0; i < n; i += B) { I.render(new Float32Array(B), new Float32Array(B)); EL.set(I.EL[0].subarray(0, Math.min(B, n - i)), i); }
  ok(EL.every((v, i) => v === off.L[i]), 'the offline render with tables differs from the instrument'); }
// ---- FM, NOISE, CLICK, DRIVE (build step 4) ----
const voice = (p, sec = 0.5) => renderSound({ ...BASE, p_amt: 0, ...p }, OUT_DEFAULT, 100, sec, fs).L;
const rms = (x, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };
// brightness: the energy above 4 kHz over the energy below 1 kHz
const tilt = (x) => { const sp = spectrum(x), bin = fs / x.length; let hi = 0, lo = 0; for (let k = 1; k < sp.length; k++) { if (k * bin > 4000) hi += sp[k]; else if (k * bin < 1000) lo += sp[k]; } return hi / lo; };
// the share of the energy above the fundamental's band (2 x f0 and up)
const overtones = (x, f0) => { const sp = spectrum(x), bin = fs / x.length; let hi = 0, all = 0; for (let k = 1; k < sp.length; k++) { all += sp[k]; if (k * bin > 1.5 * f0) hi += sp[k]; } return hi / all; };
const centroid = (x) => { const sp = spectrum(x); let a = 0, b = 0; for (let k = 1; k < sp.length; k++) { a += k * sp[k]; b += sp[k]; } return a / b * fs / x.length; };
// a part at zero is off: its other knobs change nothing
{ const ref = voice({});
  const same = (p) => voice(p).every((v, i) => v === ref[i]);
  ok(same({ n_colour: 0.9, n_decay: 0.1, n_seed: 0.7 }), 'NOISE at 0: its knobs still change the sound');
  ok(same({ c_shape: 0.7, c_tone: 0.2, c_len: 0.9, c_direct: 1 }), 'CLICK at 0: its knobs still change the sound'); }
// NOISE: the same seed the same noise, another seed other noise; COLOUR moves it from dark to bright at about the same
// level; its DECAY a share of the amp's
{ const n = (p) => voice({ a_level: 0, n_level: 1, hold: 0.5, decay: 0.8, ...p }, 0.3);
  const a = n({ n_seed: 0.3 }), b = n({ n_seed: 0.3 }), c = n({ n_seed: 0.31 });
  ok(a.every((v, i) => v === b[i]) && rms(a) > 0.05, 'NOISE: the same seed plays different noise');
  ok(a.some((v, i) => Math.abs(v - c[i]) > 0.01), 'NOISE: another seed plays the same noise');
  const cs = [-1, -0.5, 0, 0.5, 1].map((col) => { const x = n({ n_colour: col }).subarray(4096, 4096 + 8192); return [tilt(x), 20 * Math.log10(rms(x))]; });
  ok(cs.every((v, i) => !i || v[0] > cs[i - 1][0] * 1.5), 'NOISE COLOUR does not move from dark to bright: ' + cs.map((v) => v[0].toPrecision(2)).join(' '));
  const lv = cs.map((v) => v[1]); ok(Math.max(...lv) - Math.min(...lv) < 3, 'NOISE COLOUR changes the level by ' + (Math.max(...lv) - Math.min(...lv)).toFixed(1) + ' dB');
  const tail = (d) => rms(voice({ a_level: 0, n_level: 1, hold: 0, decay: 0.45, n_decay: d }, 0.4), 0.06 * fs, 0.1 * fs);
  ok(tail(1) > 4 * tail(0.5), `NOISE DECAY: x2 is not longer than x0.5 (${tail(1).toFixed(4)} vs ${tail(0.5).toFixed(4)})`); }
// CLICK: only as long as LENGTH; TONE moves it up; every SHAPE sounds; it plays the same every time
{ const c = (p) => voice({ a_level: 0, c_level: 1, hold: 0.5, decay: 0.8, ...p }, 0.1);
  for (const sh of [0, 0.25, 0.5, 0.75, 1]) {
    const x = c({ c_shape: sh, c_len: 0.5 }), len = Math.round(0.2 * Math.pow(150, 0.5) / 1000 * fs);
    ok(rms(x, 0, len) > 0.01 && rms(x, len + 300, len + 2000) < 1e-3 && x.every(Number.isFinite), `CLICK shape ${sh}: not there, or longer than its length (${rms(x, 0, len).toFixed(4)}, ${rms(x, len + 300, len + 2000).toFixed(5)})`);
  }
  for (const sh of [0.5, 1]) { const lo = centroid(c({ c_shape: sh, c_len: 1, c_tone: 0.5 }).subarray(0, 4096)), hi = centroid(c({ c_shape: sh, c_len: 1, c_tone: 0.85 }).subarray(0, 4096));
    ok(hi > lo * 1.5, `CLICK TONE at shape ${sh} doesn't move it up: ${Math.round(lo)} to ${Math.round(hi)} Hz`); }
  const a = c({ c_shape: 1 }), b = c({ c_shape: 1 }); ok(a.every((v, i) => v === b[i]), 'CLICK: a burst differs each time'); }
// FM: A > B puts sidebands on B; cross-FM at full, at any pitch and ratio, stays finite and bounded
{ const b0 = voice({ a_level: 0, b_level: 1, hold: 0.5, decay: 0.8, b_ratio: 0.5 }, 0.2), b1 = voice({ a_level: 0, b_level: 1, hold: 0.5, decay: 0.8, b_ratio: 0.5, fm_ab: 0.5 }, 0.2);
  ok(centroid(b1.subarray(2048, 2048 + 4096)) > centroid(b0.subarray(2048, 2048 + 4096)) * 1.3, 'A > B adds no sidebands to B');
  let worst = 0, finite = true;
  for (const tune of [-1, -0.4, 0, 0.5, 1]) for (const ratio of [0, 0.33, 0.5, 0.71, 1]) {
    const x = voice({ a_level: 1, b_level: 1, fm_ab: 1, fm_ba: 1, a_tune: tune, b_ratio: ratio, a_pos: 0.5, b_pos: 0.75, hold: 0.5, decay: 0.8 }, 0.3);
    finite = finite && x.every(Number.isFinite); worst = Math.max(worst, peak(x));
  }
  ok(finite && worst < 2.5, `cross-FM at full: finite ${finite}, peak ${worst.toFixed(2)}`); }
// DRIVE: at 0 clean; turned up, the tone changes more than the loudness (peak kept, RMS within 6 dB); and it doesn't
// alias much: a 3.1 kHz sine at full drive, everything off its harmonics under -40 dB
{ const s0 = voice({ a_tune: 0.1, hold: 0.5, decay: 0.9 }, 0.2), s1 = voice({ a_tune: 0.1, hold: 0.5, decay: 0.9, drive: 1 }, 0.2);
  const w = (x) => x.subarray(2048, 2048 + 4096);
  // (a full-scale input keeps its peak; this sine peaks at 0.8 of it, so it comes up to full: about 2 dB)
  ok(Math.abs(20 * Math.log10(peak(w(s1)) / peak(w(s0)))) < 3 && 20 * Math.log10(rms(w(s1)) / rms(w(s0))) < 6, `DRIVE changes the level: peak ${(20 * Math.log10(peak(w(s1)) / peak(w(s0)))).toFixed(1)} dB, rms ${(20 * Math.log10(rms(w(s1)) / rms(w(s0)))).toFixed(1)} dB`);
  const f0 = 261.6255653 * Math.pow(2, 0.1 * 48 / 12), o0 = overtones(w(s0), f0), o1 = overtones(w(s1), f0);
  ok(o0 < 1e-4 && o1 > 0.05, `DRIVE does not change the tone: overtones ${o0.toExponential(1)} to ${o1.toFixed(3)} of the energy`);
  const hz = 3100, x = voice({ a_tune: 12 * Math.log2(hz / 261.6255653) / 48, hold: 0.5, decay: 0.9, drive: 1 }, 0.5).subarray(4096, 4096 + 16384);
  const sp = spectrum(x), bin = fs / x.length; let all = 0, off = 0;
  for (let k = 1; k < sp.length; k++) { all += sp[k]; const h = k * bin / hz; if (Math.abs(h - Math.round(h)) * hz > 8 * bin) off += sp[k]; }
  const al = 10 * Math.log10(off / all); console.log(`  DRIVE at full on a ${hz} Hz sine: aliasing ${al.toFixed(1)} dB`);
  ok(al < -40, `DRIVE aliases: ${al.toFixed(1)} dB`); }
// speed: four engines with every part on, a second of sound
{ const p = { ...free(seeded(9)), fm_ab: 0.5, fm_ba: 0.3, n_level: 0.5, c_level: 0.5, drive: 0.5, a_level: 1, b_level: 1, decay: 0.9, hold: 0.5 };
  const I = new Instrument(fs); for (let e = 0; e < 4; e++) I.play(e, p, OUT_DEFAULT, 100);
  const t = performance.now(); render(I, fs); const ms = performance.now() - t;
  console.log(`  four engines, every part on, one second: ${ms.toFixed(1)} ms`); ok(ms < 250, `four engines with every part on take ${ms.toFixed(0)} ms a second`); }
// ---- FILTER 1 and FILTER 2 (build step 5) ----
const FSTAMP = (/from '\.\/filters\.js(\?v=\w+)?'/.exec(readFileSync(new URL('../engine/voice.js', import.meta.url), 'utf8')) || [])[1] || '';
const FL = await import('../engine/filters.js' + FSTAMP);
// pink noise (by its spectrum: every bin 1/sqrt(f), random phases), and K-weighted loudness (the BS.1770 biquads at 48 kHz)
const pink = (n, seed = 5) => { const r = seeded(seed), re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 1; k < n / 2; k++) { const a = 1 / Math.sqrt(k), ph = 2 * Math.PI * r(); re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph); re[n - k] = re[k]; im[n - k] = -im[k]; }
  fft(re, im, 1); let e = 0; for (let i = 0; i < n; i++) e += re[i] * re[i]; const g = 0.25 / Math.sqrt(e / n); return Float64Array.from(re, (v) => v * g); };
const KQ = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585], [1, -2, 1, -1.99004745483398, 0.99007225036621]];
const loud = (x, from = 4096) => { let y = Float64Array.from(x);
  for (const [b0, b1, b2, a1, a2] of KQ) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; } }
  let e = 0; for (let i = from; i < y.length; i++) e += y[i] * y[i]; return 10 * Math.log10(e / (y.length - from)); };
const PN = pink(1 << 16);
// FILTER 1: matched level. Pink noise at every cutoff from 100 Hz to 8 kHz and resonance up to 0.7: every MORPH
// position within 1.5 dB of the LP end (K-weighted)
{ let worst = 0, where = '';
  for (const fc of [100, 200, 500, 1000, 2000, 4000, 8000]) for (const res of [0, 0.35, 0.7]) {
    const at = (m) => { const F = new FL.MorphFilter(fs); return loud(Float64Array.from(PN, (v) => F.process(v, fc, res, m))); };
    const ref = at(0);
    for (let m = 0.125; m <= 1; m += 0.125) { const d = Math.abs(at(m) - ref); if (d > worst) { worst = d; where = `${fc} Hz, resonance ${res}, morph ${m}`; } }
  }
  console.log(`  FILTER 1 across the morph: worst ${worst.toFixed(2)} dB from the LP end (${where})`);
  ok(worst < 1.5, `FILTER 1 level across the morph: ${worst.toFixed(2)} dB at ${where}`); }
// the BP point is normalised: its peak at unity, whatever the resonance
ok([0, 0.5, 1].every((res) => Math.abs(FL.morphPower(1000, 1000, FL.damping(res), [0, 1, 0], fs) - 1) < 1e-9), 'the band-pass is not normalised');
// no clicks: MORPH, CUTOFF and RESONANCE swept end to end in 5 ms during a note
{ const steady = { ...BASE, a_tune: -0.3, p_amt: 0, decay: 1, curve: -1, hold: 1, a_pos: 0.5 }, own = (p) => maxStep(voice({ ...steady, ...p }, 0.3), fs / 10);
  for (const [id, lo, hi, extra] of [['f_morph', 0, 1, { cutoff: 0.6, reso: 0.5 }], ['cutoff', 0, 1, { reso: 0.5 }], ['reso', 0, 1, { cutoff: 0.6 }], ['f2_blend', 0, 1, { f2_mix: 1 }], ['f2_vowel', 0, 1, { f2_mix: 1, f2_blend: 1 }], ['f2_res', -1, 1, { f2_mix: 1 }]]) {
    const I = new Instrument(fs), at = fs / 10, len = fs / 200; I.play(0, { ...steady, ...extra, [id]: lo }, OUT_DEFAULT, 100);
    const pre = (inst, n, f) => { const L = new Float32Array(n); for (let i = 0; i < n; i += B) { f(i); inst.render(new Float32Array(B), new Float32Array(B)); L.set(inst.EL[0].subarray(0, Math.min(B, n - i)), i); } return L; };
    const L = pre(I, fs / 4, (i) => { if (i >= at && i <= at + len) I.update(0, { [id]: lo + (hi - lo) * (i - at) / len }); });
    const ref = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((x) => own({ ...extra, [id]: lo + (hi - lo) * x })));
    // (the engine's own output, before the master; a 5 ms sweep of a resonant filter rings, but never steps)
    ok(L.every(Number.isFinite) && maxStep(L, at - 200, fs / 4) <= ref * 1.6 + 0.02, `${id} swept in 5 ms: step ${maxStep(L, at - 200, fs / 4).toFixed(3)} vs ${ref.toFixed(3)}`);
  } }
// stable: resonance at its top, cutoff at 20 kHz at 96 kHz, after full drive, and cutoff swept fast at full resonance
{ for (const rate of [44100, 48000, 96000]) {
    const x = renderSound({ ...BASE, a_pos: 0.75, drive: 1, reso: 1, cutoff: 1, f_track: 1, p_amt: 0.6, n_level: 1, hold: 0.5, decay: 0.8 }, OUT_DEFAULT, 127, 1, rate).L;
    ok(x.every(Number.isFinite) && peak(x) < 8, `FILTER 1 at full resonance, 20 kHz, ${rate}: peak ${peak(x)}`); }
  const F = new FL.MorphFilter(fs); let pk = 0, fin = true;
  for (let i = 0; i < fs; i++) { const y = F.process(PN[i & 65535], 20 * Math.pow(1000, 0.5 + 0.5 * Math.sin(i / 300)), 1, (i / fs) % 1); fin = fin && Number.isFinite(y); pk = Math.max(pk, Math.abs(y)); }
  ok(fin && pk < 50, `FILTER 1 swept fast at full resonance: peak ${pk.toFixed(1)}`); }
// FILTER 2, the comb: tuned to PITCH (with DAMP's delay taken out); negative RESONANCE: odd harmonics of half the pitch
{ const peakHz = (fb, damp, pitch) => { const F = new FL.Filter2(fs), n = 1 << 15, y = new Float64Array(n); for (let i = 0; i < n; i++) y[i] = F.process(PN[i], pitch, fb, damp, 0, 0);
    const sp = spectrum(y.subarray(n - 16384)); let best = 0, k0 = 0; for (let k = Math.round(150 * 16384 / fs); k < 2000 * 16384 / fs; k++) if (sp[k] > best) { best = sp[k]; k0 = k; } return k0 * fs / 16384; };
  for (const damp of [0, 0.5, 1]) { const f = peakHz(0.95, damp, 220); ok(Math.abs(f / 220 - Math.round(f / 220)) < 0.03 && f > 200, `the comb at 220 Hz, damp ${damp}: strongest above 150 Hz at ${f.toFixed(1)} Hz`); }
  const fn = peakHz(-0.95, 0, 220); ok(Math.abs(fn - 110 * Math.round(fn / 110)) < fn * 0.01 && Math.round(fn / 110) % 2 === 1, `the comb with negative resonance: strongest at ${fn.toFixed(1)} Hz, not an odd harmonic of 110`); }
// FILTER 2's levels: the comb across RESONANCE (no jump crossing 0), VOWEL across the vowels, and COMB > VOWEL
const f2loud = (res, damp, vowel, blend, pitch = 300) => { const F = new FL.Filter2(fs); return loud(Float64Array.from(PN, (v) => F.process(v, pitch, res, damp, vowel, blend))); };
{ const L0 = loud(PN), comb = [-0.95, -0.6, -0.2, -0.01, 0.01, 0.2, 0.6, 0.95].map((r) => f2loud(r, 0.3, 0, 0) - L0);
  ok(Math.max(...comb.map(Math.abs)) < 3, 'the comb across RESONANCE: ' + comb.map((d) => d.toFixed(1)).join(' ') + ' dB');
  ok(Math.abs(comb[3] - comb[4]) < 0.2, 'the comb jumps crossing 0');
  const vow = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((v) => f2loud(0.5, 0.3, v, 1, 500));
  ok(Math.max(...vow) - Math.min(...vow) < 4, 'VOWEL across the vowels: ' + vow.map((d) => (d - L0).toFixed(1)).join(' ') + ' dB');
  const bl = [0, 0.25, 0.5, 0.75, 1].map((b) => f2loud(0.6, 0.3, 0.3, b, 500));
  ok(Math.max(...bl) - Math.min(...bl) < 4, 'COMB > VOWEL: ' + bl.map((d) => (d - L0).toFixed(1)).join(' ') + ' dB');
  console.log(`  FILTER 2 levels against its input: comb ${comb.map((d) => d.toFixed(1)).join(' ')}; vowels ${vow.map((d) => (d - L0).toFixed(1)).join(' ')}; blend ${bl.map((d) => (d - L0).toFixed(1)).join(' ')} dB`); }
// CLICK DIRECT: the click skips the filters (a bright burst through a 100 Hz low-pass comes out bright only when direct)
{ const c = (d) => voice({ a_level: 0, c_level: 1, c_shape: 1, c_tone: 0.95, c_len: 0.6, c_direct: d, cutoff: Math.log(5) / Math.log(1000), hold: 0.5, decay: 0.8 }, 0.05);
  const hi = (x) => { let e = 0; for (let i = 1; i < x.length; i++) e += (x[i] - x[i - 1]) ** 2; return e; };
  ok(hi(c(1)) > 100 * hi(c(0)), `CLICK DIRECT doesn't skip the filters: ${hi(c(1)).toExponential(1)} vs ${hi(c(0)).toExponential(1)}`); }

// ---- MODULATION and REPEAT (build step 6) ----
{ // no route, an empty route list and a route at 0 all render the same, sample for sample; VELOCITY at 100 moves nothing
  const p = { ...BASE, a_pos: 0.5, cutoff: 0.5, reso: 0.3, fm_ab: 0.2, b_level: 0.5 }, a = hit(p).L;
  for (const m of [{}, { 'env>cutoff': 0 }, { 'vel>cutoff': 1, 'vel>fm_ab': -1 }]) { const b = hit({ ...p, $m: m }).L; ok(a.every((v, i) => v === b[i]), 'a route that moves nothing changes the sound: ' + JSON.stringify(m)); }
  const quiet = hit({ ...p, $m: { 'vel>cutoff': 1 } }, OUT_DEFAULT, fs, 127).L, loud = hit(p, OUT_DEFAULT, fs, 127).L;
  ok(tilt(quiet.subarray(0, 8192)) > 2 * tilt(loud.subarray(0, 8192)), 'VELOCITY > CUTOFF at 127 does not brighten'); }
{ // MOD ENV > CUTOFF: bright at the start, back to the knob's own once the envelope is done
  const p = { a_pos: 0.5, cutoff: 0.4, decay: 0.8, hold: 0.6, me_decay: Math.log(30) / Math.log(4000) }, on = voice({ ...p, $m: { 'env>cutoff': 1 } }), off = voice(p);
  ok(tilt(on.subarray(0, 1024)) > 4 * tilt(off.subarray(0, 1024)), `MOD ENV > CUTOFF not bright at the start: ${tilt(on.subarray(0, 1024))} vs ${tilt(off.subarray(0, 1024))}`);
  const late = (x) => x.subarray(fs / 5, fs / 5 + 8192); ok(Math.abs(rms(late(on)) / rms(late(off)) - 1) < 0.01, 'MOD ENV still there after its decay'); }
{ // LFO > LEVEL at 4 Hz: the level rises and falls 4 times a second
  const x = voice({ hold: 1, decay: 1, curve: -1, lfo_rate: Math.log(80) / Math.log(40000), $m: { 'lfo>a_level': -0.5 } }, 1);
  const w = 1200, env = []; for (let i = fs / 10; i + w <= fs; i += w) env.push(rms(x, i, i + w));
  let turns = 0; for (let i = 2; i < env.length; i++) if ((env[i] - env[i - 1]) * (env[i - 1] - env[i - 2]) < 0) turns++;
  ok(turns >= 6 && turns <= 8 && Math.min(...env) < 0.7 * Math.max(...env), `LFO > LEVEL: ${turns} turns in 0.9 s, ${Math.min(...env).toFixed(3)}..${Math.max(...env).toFixed(3)}`); }
{ // the LFO's shapes at their points, and in range between
  const v = new Voice(fs), at = (sh, p) => { v.lph = p; return v.lfo(sh); }; v.lrA = -0.5; v.lrB = 0.5;
  ok(Math.abs(at(0, 0.25) - 1) < 1e-9 && Math.abs(at(0.25, 0.25) - 1) < 1e-9 && Math.abs(at(0.25, 0.5)) < 1e-9 && Math.abs(at(0.5, 0) - 1) < 1e-9 && at(0.75, 0.2) === 1 && at(0.75, 0.7) === -1, 'LFO shapes');
  ok(Math.abs(at(1, 0) + 0.5) < 1e-9 && Math.abs(at(1, 0.5)) < 1e-9 && Math.abs(at(1, 0.999) - 0.5) < 1e-4, 'LFO smooth random');
  let bad = 0; for (let sh = 0; sh <= 1; sh += 0.05) for (let p = 0; p < 1; p += 0.01) { const y = at(sh, p); if (!(Math.abs(y) <= 1)) bad++; } ok(!bad, 'LFO out of range'); }
{ // a route added, moved and taken away during a note: no step bigger than the note's own (it glides)
  const steady = { ...BASE, a_tune: -0.3, p_amt: 0, decay: 1, curve: -1, hold: 1, cutoff: 0.6 }, ref = hit(steady, OUT_DEFAULT, fs / 2).L, refStep = maxStep(ref, fs / 10, fs / 2);
  for (const key of ['env>cutoff', 'lfo>cutoff', 'lfo>a_level', 'vel>fm_ab', 'vel>decay']) { // (not pitch or the table's position: they change the tone's own steps)
    const I = new Instrument(fs); I.play(0, steady, OUT_DEFAULT, 120);
    const { L } = render(I, fs / 2, (i) => { if (i === 128 * 40) I.update(0, { $m: { [key]: 1 } }); if (i === 128 * 100) I.update(0, { $m: { [key]: -0.5 } }); if (i === 128 * 150) I.update(0, { $m: {} }); });
    ok(maxStep(L, 128 * 39, fs / 2) < refStep * 3 + 0.01, `${key} clicks when it changes: ${maxStep(L, 128 * 39, fs / 2).toFixed(4)} vs ${refStep.toFixed(4)}`); } }
{ // REPEAT 3 at 60 ms: four hits, 60 ms apart, all at the same level; REPEAT 2.5: the third at half; then the voice ends
  const p = { p_amt: 0, decay: 0.25, a_tune: 0.4, spacing: Math.log(60) / Math.log(80) }; // (a high tone: its peak doesn't hang on where its cycle is)
  const pk = (x) => [0, 1, 2, 3, 4].map((h) => peak(x, h * 2880 + 10, h * 2880 + 2800));
  const r3 = pk(voice({ ...p, repeat: 3 / 8 })), r25 = pk(voice({ ...p, repeat: 2.5 / 8 }));
  ok(r3.slice(0, 4).every((v) => Math.abs(v / r3[1] - 1) < 0.12) && r3[4] < 0.05 * r3[1], // (within 12%: where the cycle is at each start moves its peak a little)
     'REPEAT 3: ' + r3.map((v) => v.toFixed(3)));
  ok(Math.abs(r25[1] / r3[1] - 1) < 0.01 && Math.abs(r25[3] / r3[3] - 0.5) < 0.02 && r25[4] < 0.05 * r3[1], 'REPEAT 2.5: ' + r25.map((v) => v.toFixed(3)));
  const I = new Instrument(fs); I.play(0, { ...BASE, ...p, repeat: 3 / 8 }, OUT_DEFAULT, 100); render(I, fs / 2); ok(!I.eng[0].voice.on, 'a repeating voice never ends'); }
{ // a voice with routes costs a little more, and none costs nothing
  const p = { ...BASE, b_level: 0.6, fm_ab: 0.3, cutoff: 0.6 }, m = { 'env>cutoff': 0.5, 'lfo>a_pos': 0.3, 'vel>fm_ab': 0.4, 'env>fm_ba': 0.2 };
  const time = (q) => { const t0 = performance.now(); for (let r = 0; r < 4; r++) hit(q, OUT_DEFAULT, fs); return (performance.now() - t0) / 4; };
  time(p); const a = time(p), b = time({ ...p, $m: m }); console.log(`  one voice, one second: ${a.toFixed(1)} ms; with four routes ${b.toFixed(1)} ms`); ok(b < a * 2 + 5, 'routes too slow'); }
console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
