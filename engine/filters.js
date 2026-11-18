// The voice's filters. Pure JS, no DOM, no Web Audio.
//
// FILTER 1, the morph filter: one zero-delay-feedback state-variable filter (the topology-preserving form: trapezoidal
// integrators, cutoff prewarped), its low-pass, normalised band-pass (peak at unity) and high-pass outputs taken at once
// and MORPH crossfading LP > BP > HP along an equal-power path. Its level is matched across the morph by a gain worked
// out from the filter's own response: the K-weighted loudness (ITU-R BS.1770) of pink noise through every MORPH,
// RESONANCE and CUTOFF, against the LP end at the same RESONANCE and CUTOFF, kept as a table and read by interpolation.
//
// FILTER 2: a comb (a tuned feedback delay with a one-pole low-pass in its loop: DAMP) and a vowel filter (three
// formant band-passes, frequencies from published average formant data, VOWEL moving through A E I O U), run in
// parallel and crossfaded by COMB > VOWEL along an equal-power path. Each side's level is matched to its input's (the
// comb's from the average of its loop gain over frequency; the vowel's from its response), so the blend, the vowel
// and the comb's feedback never jump in loudness.

// ---- K-weighting (ITU-R BS.1770: a high shelf, then a high-pass), its power at f, from the published 48 kHz biquads
const KB = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585], [1, -2, 1, -1.99004745483398, 0.99007225036621]];
export function kPower(f) {
  const w = 2 * Math.PI * Math.min(f, 23900) / 48000, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let p = 1;
  for (const [b0, b1, b2, a1, a2] of KB) {
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    p *= (nr * nr + ni * ni) / (dr * dr + di * di);
  }
  return p;
}
// pink noise has the same power in every octave: over frequencies spaced evenly in log, each point weighs the same.
// (n: 1% apart for FILTER 1, so its sharpest peak, Q 50, is never missed between points)
const FREQS = (fs, n = 160) => { const top = Math.min(20000, 0.49 * fs); return Array.from({ length: n }, (_, i) => 20 * Math.pow(top / 20, (i + 0.5) / n)); };

// ---- FILTER 1 ----
/** RESONANCE 0..1 -> the state-variable filter's damping k: 1.414 (no peak) down to 0.02 (Q 50, near self-oscillation) */
export const damping = (res) => 1.4142 * Math.pow(0.02 / 1.4142, res);
/** MORPH 0..1 -> the weights of LP, BP, HP (equal power: at 0.25 LP and BP each at 0.71) */
export function morphWeights(m) {
  if (m <= 0.5) { const a = Math.PI * m; return [Math.cos(a), Math.sin(a), 0]; }
  const a = Math.PI * (m - 0.5); return [0, Math.cos(a), Math.sin(a)];
}
/** the morph filter's power response at f (Hz), cutoff fc, damping k, weights w, sample rate fs */
export function morphPower(f, fc, k, w, fs) {
  const g = Math.tan(Math.PI * fc / fs), W = Math.tan(Math.PI * Math.min(f, 0.499 * fs) / fs) / g;
  const dr = 1 - W * W, di = k * W, d = dr * dr + di * di;
  // LP 1/D, BP (normalised) j k W / D, HP -W^2 / D: the weighted sum's numerator, over D
  const nr = w[0] - w[2] * W * W, ni = w[1] * k * W;
  return (nr * nr + ni * ni) / d;
}
const F1_CUTS = 31, F1_MORPHS = 17, F1_RESES = 11; // (cutoff in thirds of an octave, 20 Hz to 20 kHz)
const cutIndex = (fc) => Math.log2(fc / 20) * 3; // (0..about 30)
const tables1 = new Map();
/** the gain table for FILTER 1 at fs: gain[(c * F1_RESES + r) * F1_MORPHS + m] */
export function filter1Gains(fs) {
  let t = tables1.get(fs); if (t) return t;
  const F = FREQS(fs, 720), K = F.map(kPower), gains = new Float32Array(F1_CUTS * F1_RESES * F1_MORPHS);
  for (let c = 0; c < F1_CUTS; c++) {
    const fc = Math.min(20 * Math.pow(2, c / 3), 0.48 * fs);
    for (let r = 0; r < F1_RESES; r++) {
      const k = damping(r / (F1_RESES - 1));
      let ref = 0;
      for (let m = 0; m < F1_MORPHS; m++) {
        const w = morphWeights(m / (F1_MORPHS - 1));
        let p = 0; for (let i = 0; i < F.length; i++) p += K[i] * morphPower(F[i], fc, k, w, fs);
        if (m === 0) ref = p;
        gains[(c * F1_RESES + r) * F1_MORPHS + m] = Math.min(24, Math.sqrt(ref / Math.max(p, 1e-12))); // (at most +28 dB: a sharp band-pass at RESONANCE 0.7 needs about +24)
      }
    }
  }
  tables1.set(fs, gains); return gains;
}
/** FILTER 1's level gain at cutoff fc, resonance res, morph m (trilinear in the table) */
export function filter1Gain(T, fc, res, m) {
  const x = Math.min(Math.max(cutIndex(fc), 0), F1_CUTS - 1.0001), y = Math.min(Math.max(res, 0), 1) * (F1_RESES - 1) * 0.99999, z = Math.min(Math.max(m, 0), 1) * (F1_MORPHS - 1) * 0.99999;
  const c = x | 0, r = y | 0, q = z | 0, fx = x - c, fy = y - r, fz = z - q;
  const at = (cc, rr, mm) => T[(cc * F1_RESES + rr) * F1_MORPHS + mm];
  const l0 = (cc) => (at(cc, r, q) * (1 - fz) + at(cc, r, q + 1) * fz) * (1 - fy) + (at(cc, r + 1, q) * (1 - fz) + at(cc, r + 1, q + 1) * fz) * fy;
  return l0(c) * (1 - fx) + l0(c + 1) * fx;
}

/** the morph filter: process(x, fc, res, morph) per sample, coefficients per sample (no clicks when they move) */
export class MorphFilter {
  constructor(fs) { this.fs = fs; this.T = filter1Gains(fs); this.ic1 = 0; this.ic2 = 0; this.key = [-1, -1, -1]; }
  reset() { this.ic1 = 0; this.ic2 = 0; }
  process(x, fc, res, m) {
    const fs = this.fs; fc = Math.min(Math.max(fc, 10), 0.48 * fs);
    const K = this.key;
    if (fc !== K[0] || res !== K[1] || m !== K[2]) { // (the coefficients again only when a setting moved)
      K[0] = fc; K[1] = res; K[2] = m;
      const g = Math.tan(Math.PI * fc / fs), k = damping(res), a1 = 1 / (1 + g * (g + k));
      this.k = k; this.a1 = a1; this.a2 = g * a1; this.a3 = g * g * a1; this.gain = m > 0 ? filter1Gain(this.T, fc, res, m) : 1;
      if (m <= 0.5) { this.w0 = Math.cos(Math.PI * m); this.w1 = Math.sin(Math.PI * m); this.w2 = 0; } else { this.w0 = 0; this.w1 = Math.cos(Math.PI * (m - 0.5)); this.w2 = Math.sin(Math.PI * (m - 0.5)); }
    }
    const k = this.k, a1 = this.a1, a2 = this.a2, a3 = this.a3;
    const v3 = x - this.ic2, v1 = a1 * this.ic1 + a2 * v3, v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return ((this.w0 ? this.w0 * v2 : 0) + this.w1 * k * v1 + (this.w2 ? this.w2 * (x - k * v1 - v2) : 0)) * this.gain;
  }
}

// ---- FILTER 2: the vowel side ----
// average formant frequencies (Hz) of adult male speakers, F1 F2 F3, for A (father), E (bet), I (beet), O (bought),
// U (boot), from the published measurements (Peterson and Barney, 1952), and the levels of F2 and F3 below F1 (dB)
export const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const VOWEL_DB = [[0, -5, -28], [0, -7, -19], [0, -20, -24], [0, -1, -26], [0, -16, -36]].map((v) => v.map((d) => d * 0.6)); // (softened: a filter, not a voice)
const VOWEL_BW = [90, 110, 160]; // the formants' widths at RESONANCE 0.5 (Hz)
/** VOWEL 0..1 -> [frequencies, linear levels] between the neighbouring vowels */
export function vowelAt(v) {
  const x = Math.min(Math.max(v, 0), 1) * 4, i = Math.min(3, Math.floor(x)), t = x - i;
  const f = [0, 1, 2].map((j) => VOWELS[i][j] * Math.pow(VOWELS[i + 1][j] / VOWELS[i][j], t)), a = [0, 1, 2].map((j) => Math.pow(10, (VOWEL_DB[i][j] * (1 - t) + VOWEL_DB[i + 1][j] * t) / 20));
  return [f, a];
}
/** how sharp: RESONANCE's size 0..1 -> the widths' scale, 2 (soft) to 1/4 (sharp) */
export const vowelWidth = (res) => Math.pow(2, 1 - 3 * Math.min(1, Math.abs(res)));
// DAMP: the upper formants softened, F2 by up to 8 dB and F3 by up to 16 dB
const dampLevels = (d) => [1, Math.pow(10, -8 * d / 20), Math.pow(10, -16 * d / 20)];
/** the vowel filter's power response at f: the three normalised band-passes summed */
export function vowelPower(f, freqs, amps, width, fs) {
  let re = 0, im = 0;
  for (let j = 0; j < 3; j++) {
    const fc = Math.min(freqs[j], 0.45 * fs), k = Math.min(2, VOWEL_BW[j] * width / fc), g = Math.tan(Math.PI * fc / fs), W = Math.tan(Math.PI * Math.min(f, 0.499 * fs) / fs) / g;
    const dr = 1 - W * W, di = k * W, d = dr * dr + di * di; // (k W j / (dr + j di))
    re += amps[j] * (k * W * di) / d; im += amps[j] * (k * W * dr) / d;
  }
  return re * re + im * im;
}
const VOWEL_POS = 41, VOWEL_RES = 11, VOWEL_DAMP = 5, tables2 = new Map();
/** the vowel side's gain tables at fs (its loudness made the input's), one for each of five DAMP settings:
 * gains[d][p * VOWEL_RES + r] */
export function vowelGains(fs) {
  let t = tables2.get(fs); if (t) return t;
  const F = FREQS(fs), K = F.map(kPower), pin = K.reduce((a, b) => a + b, 0);
  t = [];
  for (let d = 0; d < VOWEL_DAMP; d++) {
    const dl = dampLevels(d / (VOWEL_DAMP - 1)), gains = new Float32Array(VOWEL_POS * VOWEL_RES);
    for (let p = 0; p < VOWEL_POS; p++) {
      const [freqs, a0] = vowelAt(p / (VOWEL_POS - 1)), amps = a0.map((a, j) => a * dl[j]);
      for (let r = 0; r < VOWEL_RES; r++) {
        const w = vowelWidth(r / (VOWEL_RES - 1)); let pw = 0;
        for (let i = 0; i < F.length; i++) pw += K[i] * vowelPower(F[i], freqs, amps, w, fs);
        gains[p * VOWEL_RES + r] = Math.min(16, Math.sqrt(pin / pw));
      }
    }
    t.push(gains);
  }
  tables2.set(fs, t); return t;
}
const lerp2 = (T, nx, ny, x, y) => { const X = Math.min(Math.max(x, 0), 1) * (nx - 1) * 0.99999, Y = Math.min(Math.max(y, 0), 1) * (ny - 1) * 0.99999, i = X | 0, j = Y | 0, fx = X - i, fy = Y - j;
  return (T[i * ny + j] * (1 - fy) + T[i * ny + j + 1] * fy) * (1 - fx) + (T[(i + 1) * ny + j] * (1 - fy) + T[(i + 1) * ny + j + 1] * fy) * fx; };

// ---- FILTER 2: the comb side ----
/** DAMP 0..1 -> the loop's one-pole coefficient: 1 (no damping) down to a corner at 400 Hz */
export const combDamp = (d, fs) => Math.pow(1 - Math.exp(-2 * Math.PI * 400 / fs), Math.min(Math.max(d, 0), 1));
const COMB_FB = 49, COMB_D = 11, tables3 = new Map();
/** the comb's gain table at fs: its loudness made the input's. The comb's power, averaged over its fast phase, is the
 * input's over (1 - fb^2 |L|^2) at each frequency (L: the loop's low-pass): gain[f * COMB_D + d] */
export function combGains(fs) {
  let t = tables3.get(fs); if (t) return t;
  const F = FREQS(fs), K = F.map(kPower), pin = K.reduce((a, b) => a + b, 0), gains = new Float32Array(COMB_FB * COMB_D);
  for (let i = 0; i < COMB_FB; i++) {
    const fb = -0.98 + 1.96 * i / (COMB_FB - 1);
    for (let j = 0; j < COMB_D; j++) {
      const a = combDamp(j / (COMB_D - 1), fs); let p = 0;
      for (let n = 0; n < F.length; n++) { const w = 2 * Math.PI * F[n] / fs, L2 = a * a / (1 - 2 * (1 - a) * Math.cos(w) + (1 - a) * (1 - a)); p += K[n] / (1 - fb * fb * L2); }
      gains[i * COMB_D + j] = Math.sqrt(pin / p);
    }
  }
  tables3.set(fs, gains); return gains;
}

const COMB_LEN = 8192; // (the delay line: 20 Hz at up to 96 kHz, with room)
/** FILTER 2: process(x, pitch, res, damp, vowel, blend) per sample, returning the wet signal (MIX is the voice's) */
export class Filter2 {
  constructor(fs) {
    this.fs = fs; this.TV = vowelGains(fs); this.TC = combGains(fs);
    this.buf = new Float64Array(COMB_LEN); this.w = 0; this.lp = 0;
    this.s = new Float64Array(6); // (the three formant filters' states)
    this.c = new Float64Array(12); this.n = 0; // (their coefficients: k, a1, a2, a3, by formant; new every 16 samples)
  }
  reset() { this.buf.fill(0); this.w = 0; this.lp = 0; this.s.fill(0); this.n = 0; }
  process(x, pitch, res, damp, vowel, blend) {
    const fs = this.fs; let comb = 0, vow = 0;
    const wc = blend < 1 ? Math.cos(Math.PI / 2 * blend) : 0, wv = blend > 0 ? Math.sin(Math.PI / 2 * blend) : 0;
    { // the comb: y = x + fb * L(y, D samples ago), D tuned to PITCH (less the loop low-pass's delay), read with
      // 4-point interpolation. Always runs, so a blend coming back from VOWEL finds it ringing true
      const fb = Math.min(0.98, Math.max(-0.98, res)), a = combDamp(damp, fs);
      const D = Math.min(COMB_LEN - 4, Math.max(2, fs / Math.min(Math.max(pitch, 20), 0.45 * fs) - (1 - a) / a));
      const p = this.w - D + COMB_LEN, i = Math.floor(p), f = p - i, B = this.buf, M = COMB_LEN - 1;
      const y0 = B[(i - 1) & M], y1 = B[i & M], y2 = B[(i + 1) & M], y3 = B[(i + 2) & M];
      const d = y1 + f * (0.5 * (y2 - y0) + f * (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3 + f * (1.5 * (y1 - y2) + 0.5 * (y3 - y0))));
      this.lp += a * (d - this.lp);
      const y = x + fb * this.lp;
      this.w = (this.w + 1) & M; B[this.w] = y;
      comb = y * lerp2(this.TC, COMB_FB, COMB_D, (fb + 0.98) / 1.96, damp);
    }
    if (wv > 0) { // the vowel: three normalised band-passes (state-variable), moved by PITCH from 500 Hz (within an octave)
      const s = this.s, C = this.c;
      if (this.n-- <= 0) { // (the formants' coefficients and the level, every 16 samples: the formants glide with the settings)
        this.n = 15;
        const [freqs, amps] = vowelAt(vowel), width = vowelWidth(res), dl = dampLevels(damp);
        const shift = Math.pow(2, Math.min(1, Math.max(-1, Math.log2(Math.max(pitch, 1) / 500))));
        const dd = Math.min(Math.max(damp, 0), 1) * (VOWEL_DAMP - 1) * 0.99999, di = dd | 0, df = dd - di;
        const lv = lerp2(this.TV[di], VOWEL_POS, VOWEL_RES, vowel, Math.abs(res)) * (1 - df) + lerp2(this.TV[di + 1], VOWEL_POS, VOWEL_RES, vowel, Math.abs(res)) * df;
        for (let j = 0; j < 3; j++) {
          const fc = Math.min(freqs[j] * shift, 0.45 * fs), k = Math.min(2, VOWEL_BW[j] * width / fc), g = Math.tan(Math.PI * fc / fs), a1 = 1 / (1 + g * (g + k));
          C[4 * j] = k * amps[j] * dl[j] * lv; C[4 * j + 1] = a1; C[4 * j + 2] = g * a1; C[4 * j + 3] = g * g * a1;
        }
      }
      for (let j = 0; j < 3; j++) {
        const a1 = C[4 * j + 1], a2 = C[4 * j + 2], a3 = C[4 * j + 3], ic1 = s[2 * j], ic2 = s[2 * j + 1];
        const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        s[2 * j] = 2 * v1 - ic1; s[2 * j + 1] = 2 * v2 - ic2;
        vow += C[4 * j] * v1; // (k v1: the normalised band-pass, times its level)
      }
    } else { this.s.fill(0); this.n = 0; } // (the vowel side at rest: it starts from silence when the blend brings it in)
    return comb * wc + vow * wv;
  }
}
