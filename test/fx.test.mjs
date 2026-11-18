// node test/fx.test.mjs: the send reverb and the master compressor (build step 8). The reverb: its tail falls 60 dB in
// about DECAY, both sides equally loud and unlike each other, WIDTH 0 is mono, nothing when nothing is sent, no click
// when SIZE or any knob moves. The compressor: its static curve, attack and release, off is untouched, and THRESHOLD
// crossing into and out of off doesn't click. The instrument: the sends reach the reverb, the limiter allows no overs.
import { Reverb, REVERB_DEFAULTS, decaySec } from '../engine/reverb.js';
import { Comp, COMP_DEFAULTS, reduction } from '../engine/comp.js';
import { Instrument } from '../engine/instrument.js';
import { BASE, OUT_DEFAULT } from '../sound/params.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const fs = 48000, B = 128;
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

// run a reverb on sends (sl, sr) for n samples, at(i) called at each block start
function verb(settings, n, sl, sr = sl, at) {
  const v = new Reverb(fs); v.set({ ...REVERB_DEFAULTS, ...settings });
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += B) { if (at) at(i, v); const m = Math.min(B, n - i); v.process(sl.subarray(i, i + m), sr.subarray(i, i + m), L.subarray(i, i + m), R.subarray(i, i + m), m); }
  return { L, R, v };
}
const energy = (x, a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return e; };
// the tail's fall: the energy in 50 ms windows, the slope fitted between -5 and -35 dB, extended to 60
function rt60(x) {
  const w = fs / 20, e = []; for (let i = 0; i + w <= x.length; i += w) e.push(10 * Math.log10(energy(x, i, i + w) + 1e-30));
  const top = Math.max(...e), i0 = e.findIndex((v) => v < top - 5), i1 = e.findIndex((v) => v < top - 35);
  if (i0 < 0 || i1 <= i0) return NaN;
  return (i1 - i0) * 0.05 * 60 / 30;
}
{ // DECAY: the tail falls 60 dB in about the time the knob says (the walls absorb the highs faster: TONE bright here)
  for (const d of [40, 80, 110]) {
    const n = Math.round(fs * Math.min(12, decaySec(d) * 1.6 + 0.5)), imp = new Float32Array(n); imp[0] = 1;
    const { L, R } = verb({ decay: d, tone: 127, early: 0, pre: 0 }, n, imp);
    const t = rt60(Float32Array.from(L, (v, i) => Math.hypot(v, R[i]))), want = decaySec(d);
    ok(Math.abs(t / want - 1) < 0.25, `DECAY ${d}: falls 60 dB in ${t.toFixed(2)} s, wanted ${want.toFixed(2)} s`);
  }
}
{ // both sides equally loud, unlike each other; WIDTH 0 makes them one; finite
  const n = fs * 2, imp = new Float32Array(n); imp[0] = 1;
  const { L, R } = verb({}, n, imp), a = fs / 10;
  const eL = energy(L, a, n), eR = energy(R, a, n); let c = 0; for (let i = a; i < n; i++) c += L[i] * R[i];
  const corr = c / Math.sqrt(eL * eR);
  ok(Math.abs(db(eL / eR) / 2) < 1, `the sides differ in level by ${(db(eL / eR) / 2).toFixed(2)} dB`);
  ok(Math.abs(corr) < 0.3, `the sides are too alike: correlation ${corr.toFixed(2)}`);
  ok(L.every(Number.isFinite) && R.every(Number.isFinite), 'the reverb is not finite');
  const m = verb({ width: 0 }, n, imp); let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(m.L[i] - m.R[i]));
  ok(d < 1e-6, `WIDTH 0 is not mono: ${d}`);
  console.log(`  reverb: sides ${(db(eL / eR) / 2).toFixed(2)} dB apart, correlation ${corr.toFixed(2)}`);
}
{ // PRE-DELAY: nothing comes out before it
  const n = fs / 4, imp = new Float32Array(n); imp[0] = 1;
  const { L } = verb({ pre: 50, early: 127 }, n, imp); let first = -1; for (let i = 0; i < n; i++) if (Math.abs(L[i]) > 1e-6) { first = i; break; }
  ok(first >= 0.05 * fs - 2 && first < 0.05 * fs + 0.03 * fs, `PRE-DELAY 50 ms: first sound at ${(first / fs * 1000).toFixed(1)} ms`);
}
{ // nothing sent, nothing returned (and asleep: no work)
  const n = fs, z = new Float32Array(n), { L, R, v } = verb({}, n, z);
  ok(L.every((x) => x === 0) && R.every((x) => x === 0) && v.idle, 'a reverb with nothing sent makes something');
}
{ // no click: a dark noise into it (little above a few hundred Hz) while SIZE, DECAY, TONE, EARLY, PRE and WIDTH sweep end
  // to end over 100 ms each. A click is a burst of highs: the output's highs (its second difference) in 10 ms windows
  // stay within those of the same noise with the knob held at either end. (A pure tone is no use here: an FDN's level
  // for a sine hangs on where it falls between the loops' resonances)
  const n = fs * 3; let r = 1, a = 0, b = 0;
  const dark = Float32Array.from({ length: n }, () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; a += (r / 2147483648 - 1 - a) * 0.04; b += (a - b) * 0.04; return b; });
  const highs = (x, from) => { let m = 0; for (let w = from; w + 480 <= x.length; w += 480) { let e = 0; for (let i = w; i < w + 480; i++) { const d = x[i] - 2 * x[i - 1] + x[i - 2]; e += d * d; } m = Math.max(m, e); } return m; };
  for (const [k, lo, hi] of [['size', 0, 127], ['decay', 0, 127], ['tone', 0, 127], ['early', 0, 127], ['pre', 0, 100], ['width', 0, 100]]) {
    const { L } = verb({ [k]: lo }, n, dark, dark, (i, v) => { if (i >= fs && i <= fs + fs / 10) v.set({ [k]: Math.round(lo + (hi - lo) * (i - fs) / (fs / 10)) }); });
    const own = Math.max(highs(verb({ [k]: lo }, n, dark).L, fs / 2), highs(verb({ [k]: hi }, n, dark).L, fs / 2)), got = highs(L, fs / 2);
    ok(got < own * 2, `reverb ${k.toUpperCase()} clicks as it moves: highs ${got.toExponential(2)} vs ${own.toExponential(2)} held`);
  }
}

// ---- the compressor ----
{ // the static curve: below the knee untouched, above it 1/RATIO, the knee smooth (continuous, and its slope too)
  ok(reduction(-30, -20, 4, 0) === 0 && Math.abs(reduction(-10, -20, 4, 0) - 7.5) < 1e-9, 'the curve above and below');
  let jump = 0; for (let x = -40; x < 0; x += 0.01) jump = Math.max(jump, Math.abs(reduction(x + 0.01, -20, 4, 12) - reduction(x, -20, 4, 12)));
  ok(jump < 0.01 * 0.76, `the knee jumps: ${jump}`);
  // a steady square wave 10 dB over the threshold at 4:1 (no knee) settles 7.5 dB down, with MAKEUP added back
  const c = new Comp(fs); c.set({ thresh: 20, ratio: 40, knee: 0, attack: 5, release: 50, makeup: 3 });
  const n = fs, L = Float32Array.from({ length: n }, (_, i) => Math.pow(10, -10 / 20) * (i % 48 < 24 ? 1 : -1)), R = Float32Array.from(L); // (a square wave: its level is steady)
  c.process(L, R, n); let pk = 0; for (let i = n - 4800; i < n; i++) pk = Math.max(pk, Math.abs(L[i]));
  ok(Math.abs(db(pk) - (-10 - 7.5 + 3)) < 0.5, `4:1 at -20 dB, a -10 dB square comes out at ${db(pk).toFixed(2)} dB (want -14.5)`);
}
{ // attack and release: the reduction reaches 63% of its way in about ATTACK, and goes back in about RELEASE
  const c = new Comp(fs); c.set({ thresh: 30, ratio: 200, knee: 0, attack: 20, release: 200, makeup: 0 });
  const n = fs, hi = fs / 2, x = Float32Array.from({ length: n }, (_, i) => (i < hi ? 0.5 : 0.01)), y = Float32Array.from(x);
  const gr = []; for (let i = 0; i < n; i += 48) { c.process(x.subarray(i, i + 48), y.subarray(i, i + 48), 48); gr.push(c.gr); }
  const full = gr[Math.floor(hi / 48) - 1], tA = gr.findIndex((g) => g > 0.632 * full) * 1, tR = gr.slice(hi / 48).findIndex((g) => g < 0.368 * full);
  ok(Math.abs(tA - 20) <= 3, `ATTACK 20 ms: ${tA} ms to 63%`); ok(Math.abs(tR - 200) <= 15, `RELEASE 200 ms: ${tR} ms to 37%`);
}
{ // off: untouched, sample for sample; on and off again mid-sound: no step
  const n = fs, sig = Float32Array.from({ length: n }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 200 * i / fs));
  const c = new Comp(fs), L = Float32Array.from(sig), R = Float32Array.from(sig); c.process(L, R, n);
  ok(L.every((v, i) => v === sig[i]), 'the compressor off changes the sound');
  const d = new Comp(fs), L2 = Float32Array.from(sig), R2 = Float32Array.from(sig);
  for (let i = 0; i < n; i += B) { if (i === fs / 4) d.set({ thresh: 40, ratio: 200, attack: 1, makeup: 12 }); if (i === fs / 2) d.set({ thresh: 0 }); d.process(L2.subarray(i, i + B), R2.subarray(i, i + B), B); }
  let worst = 0; for (let i = 1; i < n; i++) worst = Math.max(worst, Math.abs(L2[i] - L2[i - 1]));
  const own = 0.8 * 2 * Math.PI * 200 / fs * Math.pow(10, 12 / 20);
  ok(worst < own * 1.2, `THRESHOLD in and out of off clicks: step ${worst.toFixed(4)} vs the tone's own ${own.toFixed(4)}`);
}

// ---- the instrument: a key's send reaches the reverb; the master never goes over ----
{ const I = new Instrument(fs); I.play(0, { ...BASE, decay: 0.2 }, { ...OUT_DEFAULT, send: 1 }, 100);
  const n = fs, L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i += B) I.render(L.subarray(i, i + B), R.subarray(i, i + B));
  const J = new Instrument(fs); J.play(0, { ...BASE, decay: 0.2 }, OUT_DEFAULT, 100);
  const L2 = new Float32Array(n), R2 = new Float32Array(n); for (let i = 0; i < n; i += B) J.render(L2.subarray(i, i + B), R2.subarray(i, i + B));
  const late = (x) => energy(x, fs / 2, n);
  ok(late(L) > 1e3 * late(L2) + 1e-9, `the send doesn't reach the reverb: tail ${late(L).toExponential(1)} vs ${late(L2).toExponential(1)}`);
  const K = new Instrument(fs); K.setFx({ master: { level: 100 }, comp: { thresh: 40, ratio: 10, makeup: 24 } });
  for (let e = 0; e < 4; e++) K.play(e, { ...BASE, a_level: 1, decay: 0.8, drive: 1 }, { ...OUT_DEFAULT, level: 1, send: 1 }, 127);
  let pk = 0; const X = new Float32Array(B), Y = new Float32Array(B); for (let i = 0; i < fs; i += B) { K.render(X, Y); for (let j = 0; j < B; j++) pk = Math.max(pk, Math.abs(X[j]), Math.abs(Y[j])); }
  ok(pk <= 1, `the master goes over: ${pk}`); }
{ // the cost: the reverb running, one second
  const n = fs, s = Float32Array.from({ length: n }, () => Math.random() * 0.1);
  const t0 = performance.now(); verb({}, n, s); const ms = performance.now() - t0; console.log(`  reverb, one second: ${ms.toFixed(1)} ms`); ok(ms < 150, 'the reverb is too slow: ' + ms); }

console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
