// The send reverb: a stereo room-to-hall reverb fed by every key's REVERB send and returned at unity.
//
// Built from the textbook feedback delay network: eight delay lines of mutually prime-ish lengths, mixed through a
// normalised 8 x 8 Hadamard matrix (lossless), each line losing exactly enough per pass to fall 60 dB in DECAY seconds,
// with a one-pole low-pass in each loop for TONE (dark to bright). Each line's length moves slowly (a sine of under
// 1.2 Hz, a few samples deep) so the tail never rings metallic. Before it: a PRE-DELAY and a set of early reflections
// (taps on the pre-delayed input, their times scaled by SIZE), different on each side. The two outputs take the lines
// with two orthogonal sign patterns, so they are equally loud and unlike each other; WIDTH narrows them towards mono.
// SIZE glides slowly (the lines' lengths move smoothly: a short pitch bend, never a click), a new PRE-DELAY crossfades
// in over 20 ms, and every other knob is
// glided too.
//
// Settings (as stored, whole numbers): size, decay, tone, early 0..127; pre 0..100 ms; width 0..100 %.
export const REVERB_DEFAULTS = { size: 64, decay: 60, tone: 64, early: 40, pre: 10, width: 100 };
export const sizeScale = (v) => 0.3 * Math.pow(1.6 / 0.3, v / 127); // the lines' lengths x this
export const decaySec = (v) => 0.2 * Math.pow(50, v / 127); // 0.2 s .. 10 s to fall 60 dB
export const toneHz = (v) => 1000 * Math.pow(16, v / 127); // the loops' low-pass: 1 kHz .. 16 kHz

const LINES_MS = [29.7, 37.1, 41.1, 43.7, 53.0, 59.9, 67.7, 79.3];
const MOD_HZ = [0.31, 0.43, 0.57, 0.68, 0.79, 0.91, 1.03, 1.17];
// the inputs and the outputs onto the lines by four mutually orthogonal sign patterns (none of them the matrix's
// all-ones row): the two outputs equally loud and unlike each other, and neither aligned with an input
const IN_L = [1, 1, -1, -1, 1, 1, -1, -1], IN_R = [1, -1, -1, 1, -1, 1, 1, -1];
const OUT_L = [1, 1, 1, 1, -1, -1, -1, -1], OUT_R = [1, -1, 1, -1, 1, -1, 1, -1];
// early reflections: [ms at size 1, gain] per side
const EARLY_L = [[7.1, 0.82], [11.3, -0.66], [17.9, 0.58], [23.7, -0.47], [31.1, 0.4], [41.9, -0.31], [53.3, 0.24], [67.1, 0.17]];
const EARLY_R = [[8.3, 0.8], [13.1, -0.68], [16.7, 0.55], [26.3, -0.49], [34.7, 0.38], [39.1, -0.33], [57.7, 0.22], [71.9, 0.18]];

export class Reverb {
  constructor(fs) {
    this.fs = fs;
    const maxLine = Math.ceil(fs * (79.3 / 1000) * 1.6) + 64;
    this.N = 1 << Math.ceil(Math.log2(maxLine + 4)); this.M = this.N - 1;
    this.buf = LINES_MS.map(() => new Float32Array(this.N)); this.w = 0;
    this.lp = new Float64Array(8); this.ph = Float64Array.from(MOD_HZ, (_, i) => i / 8);
    const preMax = Math.ceil(fs * (0.1 + 72 / 1000 * 1.6)) + 8; // (the pre-delay and the furthest early tap)
    this.PN = 1 << Math.ceil(Math.log2(preMax)); this.PM = this.PN - 1;
    this.pl = new Float32Array(this.PN); this.pr = new Float32Array(this.PN); this.pw = 0;
    this.s = { ...REVERB_DEFAULTS }; this.g = 1 - Math.exp(-1 / (0.02 * fs)); this.gSize = 1 - Math.exp(-1 / (0.6 * fs));
    this.size = sizeScale(this.s.size); this.cur = this.targets(); this.x = new Float64Array(8); this.y = new Float64Array(8);
    this.quiet = 0; this.idle = true; this.preA = this.preB = this.cur.pre; this.xf = 1;
  }
  set(s) { Object.assign(this.s, s); }
  targets() {
    const s = this.s, fs = this.fs;
    return { decay: decaySec(s.decay), lpA: 1 - Math.exp(-2 * Math.PI * Math.min(toneHz(s.tone), 0.45 * fs) / fs), early: (s.early / 127) * 0.8,
      pre: Math.max(0, Math.min(100, s.pre)) / 1000 * fs, width: Math.max(0, Math.min(100, s.width)) / 100 };
  }
  /** add the reverb of the sends (SL, SR) into L and R, samples 0..n */
  process(SL, SR, L, R, n) {
    // asleep while nothing comes in and the tail has gone (an empty send costs nothing)
    let any = false; for (let i = 0; i < n; i++) if (SL[i] !== 0 || SR[i] !== 0) { any = true; break; }
    if (!any && this.idle) return;
    if (any) { this.quiet = 0; if (this.idle) { this.cur = this.targets(); this.size = sizeScale(this.s.size); this.preA = this.preB = this.cur.pre; this.xf = 1; } this.idle = false; } // (waking: no glide from settings it never played)
    const fs = this.fs, T = this.targets(), c = this.cur, g = this.g, buf = this.buf, M = this.M, PM = this.PM, x = this.x, y = this.y;
    const sizeT = sizeScale(this.s.size), depth = 0.00025 * fs; // (the lines' wobble: a quarter of a millisecond)
    let peak = 0;
    const loss = this.loss || (this.loss = new Float64Array(8)), pl = this.pl, pr = this.pr;
    for (let k = 0; k < 8; k++) loss[k] = Math.pow(10, -3 * (LINES_MS[k] / 1000 * this.size) / c.decay); // (60 dB down in DECAY: per pass, by the line's length; per block)
    const xfStep = 1 / (0.02 * fs);
    const rd = (a, d) => { const p = this.pw - d, j = Math.floor(p), f = p - j; return a[j & PM] * (1 - f) + a[(j + 1) & PM] * f; };
    for (let i = 0; i < n; i++) {
      this.size += (sizeT - this.size) * this.gSize;
      c.decay += (T.decay - c.decay) * g; c.lpA += (T.lpA - c.lpA) * g; c.early += (T.early - c.early) * g; c.width += (T.width - c.width) * g;
      // the pre-delay and the early reflections, read from the input's own line
      const pw = this.pw = (this.pw + 1) & PM; pl[pw] = SL[i]; pr[pw] = SR[i];
      // PRE-DELAY: a new time crossfades in over 20 ms (no glide, so no pitch bend)
      if (this.xf >= 1) { if (Math.abs(T.pre - this.preB) > 0.5) { this.preA = this.preB; this.preB = T.pre; this.xf = 0; } } else this.xf = Math.min(1, this.xf + xfStep);
      const xf = this.xf, pA = this.preA, pB = this.preB, pd = xf >= 1 ? (a, o) => rd(a, pB + o) : (a, o) => rd(a, pA + o) * (1 - xf) + rd(a, pB + o) * xf;
      const inL = pd(pl, 0), inR = pd(pr, 0);
      let eL = 0, eR = 0;
      if (c.early > 1e-4) { const ms = fs * this.size / 1000; for (let k = 0; k < 8; k++) { eL += EARLY_L[k][1] * pd(pl, EARLY_L[k][0] * ms); eR += EARLY_R[k][1] * pd(pr, EARLY_R[k][0] * ms); } }
      // the lines: read (moving slowly), damp, lose, mix, write back with the input
      const w = this.w = (this.w + 1) & M;
      for (let k = 0; k < 8; k++) {
        this.ph[k] += MOD_HZ[k] / fs; if (this.ph[k] >= 1) this.ph[k] -= 1;
        const len = LINES_MS[k] / 1000 * fs * this.size, d = len + depth * Math.sin(2 * Math.PI * this.ph[k]);
        const p = w - d, j = Math.floor(p), f = p - j, b = buf[k];
        // (4-point Hermite: smooth as the length moves)
        const y0 = b[(j - 1) & M], y1 = b[j & M], y2 = b[(j + 1) & M], y3 = b[(j + 2) & M];
        const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        const v = ((c3 * f + c2) * f + c1) * f + y1;
        this.lp[k] += (v - this.lp[k]) * c.lpA;
        x[k] = this.lp[k] * loss[k];
        y[k] = v;
      }
      // Hadamard 8 (fast, normalised): lossless mixing
      for (let h = 1; h < 8; h <<= 1) for (let a = 0; a < 8; a += h << 1) for (let k = a; k < a + h; k++) { const u = x[k], t = x[k + h]; x[k] = u + t; x[k + h] = u - t; }
      const nrm = 1 / Math.sqrt(8);
      for (let k = 0; k < 8; k++) buf[k][w] = x[k] * nrm + (IN_L[k] * inL + IN_R[k] * inR) * 0.35;
      let oL = 0, oR = 0; for (let k = 0; k < 8; k++) { oL += OUT_L[k] * y[k]; oR += OUT_R[k] * y[k]; }
      oL = oL * 0.35 + eL * c.early; oR = oR * 0.35 + eR * c.early;
      const mid = (oL + oR) * 0.5, side = (oL - oR) * 0.5 * c.width;
      L[i] += mid + side; R[i] += mid - side;
      const a = Math.abs(oL) + Math.abs(oR); if (a > peak) peak = a;
    }
    // asleep again once it has been silent for a while
    if (!any && peak < 1e-6) { if ((this.quiet += n) > 0.2 * fs) { this.idle = true; this.clear(); } } else this.quiet = 0;
  }
  clear() { for (const b of this.buf) b.fill(0); this.lp.fill(0); this.pl.fill(0); this.pr.fill(0); }
}
