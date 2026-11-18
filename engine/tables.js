// Wavetables: a table is a run of frames, each one cycle, and POSITION reads between neighbouring frames. Each frame
// is kept in band-limited copies, one per octave: copy l holds the harmonics up to TOP_H >> l (made with an inverse
// FFT from the frame's spectrum), so a note reads a copy with nothing above Nyquist. A note between two octaves
// crossfades the two copies, so a pitch sweep never steps.
//
// The copies are sized for their harmonics, not one size for all: the full-band copy has 4096 harmonics (a note at
// 4 Hz still reaches 16 kHz, so low notes keep their highs). Every copy holds 8 samples per harmonic and is read with
// 6-point Lagrange interpolation: its images (which would alias) stay under -75 dB, its droop under 0.1 dB.
//
// Build step 2 has BASIC only (sine > triangle > saw > square > narrow pulse), made from the textbook Fourier series
// of each shape. The other built-in tables and WAV loading come in build step 3. Pure JS: it runs in the AudioWorklet,
// a Worker and node.

export const TOP_H = 4096, LEVELS = 13; // copies hold 4096, 2048, ... 1 harmonics
const G = 5; // (guard samples per frame)
const XF = 0.15; // (a sixth of an octave, two semitones)
export const FRAME = 2048; // (a WAV frame's length, build step 3)
export const copyHarmonics = (l) => TOP_H >> l;
export const copySize = (l) => Math.max(64, 8 * (TOP_H >> l));

// ---- an in-place radix-2 FFT (complex, re and im arrays); sign +1 is the inverse (without the 1/N) ----
function fft(re, im, sign) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = sign * 2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export { fft };

/**
 * A table from spectra. Each frame's spectrum is { a, b }: Float64Arrays of cosine and sine amounts by harmonic
 * (index 1..TOP_H; index 0, the DC, is ignored). Every frame is scaled so its full-band copy peaks at 1, and every
 * copy of a frame takes the same scale, so a sweep across octaves doesn't change the level.
 * Returns { name, frames, data, size }: data[l] is one Float32Array of frames * (size[l] + G) samples: each frame
 * with two guard samples before it (its last two) and three after (its first three), so reading needs no wrap.
 */
export function buildTable(name, spectra) {
  const F = spectra.length, size = Array.from({ length: LEVELS }, (_, l) => copySize(l));
  const data = size.map((N) => new Float32Array(F * (N + G)));
  for (let f = 0; f < F; f++) {
    const { a, b } = spectra[f]; let scale = 1;
    for (let l = 0; l < LEVELS; l++) {
      const N = size[l], re = new Float64Array(N), im = new Float64Array(N), top = Math.min(TOP_H >> l, a.length - 1, N / 2 - 1);
      for (let k = 1; k <= top; k++) { re[k] = a[k] / 2; im[k] = -b[k] / 2; re[N - k] = a[k] / 2; im[N - k] = b[k] / 2; }
      fft(re, im, 1);
      if (l === 0) { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(re[i])); scale = m > 1e-9 ? 1 / m : 1; }
      const d = data[l], o = f * (N + G) + 2;
      for (let i = 0; i < N; i++) d[o + i] = re[i] * scale;
      d[o - 2] = d[o + N - 2]; d[o - 1] = d[o + N - 1]; d[o + N] = d[o]; d[o + N + 1] = d[o + 1]; d[o + N + 2] = d[o + 2];
    }
  }
  return { name, frames: F, data, size };
}

// ---- the shapes of BASIC, as Fourier series (cosine a_k, sine b_k) ----
const spec = (fa, fb) => { const a = new Float64Array(TOP_H + 1), b = new Float64Array(TOP_H + 1); for (let k = 1; k <= TOP_H; k++) { a[k] = fa(k); b[k] = fb(k); } return { a, b }; };
const zero = () => 0;
const SHAPES = {
  sine: () => spec(zero, (k) => (k === 1 ? 1 : 0)),
  triangle: () => spec(zero, (k) => (k % 2 ? 8 / (Math.PI * Math.PI) * (((k - 1) / 2) % 2 ? -1 : 1) / (k * k) : 0)),
  saw: () => spec(zero, (k) => 2 / Math.PI * (k % 2 ? 1 : -1) / k),
  // a pulse of width w (0.5 is the square), high for w of the cycle, without its DC
  pulse: (w) => spec((k) => 2 * Math.sin(Math.PI * k * w) / (Math.PI * k) * Math.cos(Math.PI * k * w), (k) => 2 * Math.sin(Math.PI * k * w) / (Math.PI * k) * Math.sin(Math.PI * k * w)),
};
const mix = (p, q, t) => ({ a: p.a.map((v, k) => v + (q.a[k] - v) * t), b: p.b.map((v, k) => v + (q.b[k] - v) * t) });

/** BASIC: sine > triangle > saw > square > narrow pulse, in 41 frames (10 between each pair of shapes) */
export function basic() {
  const keys = [SHAPES.sine(), SHAPES.triangle(), SHAPES.saw(), SHAPES.pulse(0.5)], frames = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < 10; i++) frames.push(mix(keys[s], keys[s + 1], i / 10));
  for (let i = 0; i <= 10; i++) frames.push(SHAPES.pulse(0.5 - 0.45 * i / 10)); // the square narrowing to a 5% pulse
  return buildTable('BASIC', frames);
}

let BASIC = null;
/** the built-in tables, made once per thread */
export const tables = () => (BASIC ||= basic());

// 6-point Lagrange interpolation between d[o] and d[o + 1] (the samples at -2..3 around o), at fraction f: the
// weights for f first (weights(f)), then the sum (lagrange(d, o))
const W = new Float64Array(6);
function weights(f) {
  const a = f + 2, b = f + 1, c = f, d = f - 1, e = f - 2, g = f - 3, cd = c * d, ab = a * b, eg = e * g;
  W[0] = -b * cd * eg / 120; W[1] = a * cd * eg / 24; W[2] = -ab * d * eg / 12; W[3] = ab * c * eg / 12; W[4] = -ab * cd * g / 24; W[5] = ab * cd * e / 120;
}
const lagrange = (d, o) => W[0] * d[o - 2] + W[1] * d[o - 1] + W[2] * d[o] + W[3] * d[o + 1] + W[4] * d[o + 2] + W[5] * d[o + 3];

/**
 * Read table t at position pos (0..1), phase (0..1), for a note of hz at sample rate fs: frames interpolated by
 * position, samples by phase, octave copies crossfaded by pitch.
 */
export function read(t, pos, phase, hz, fs) {
  // copy n (n = log2(TOP_H * hz / (fs / 2))) would put its top harmonic at Nyquist; read the one above it (its top
  // harmonic between a quarter of the sample rate and Nyquist, so nothing passes Nyquist). Over the last XF of each
  // octave it crossfades to the next copy, so the change of copy never steps; until then the note keeps every harmonic
  // the copy has
  const n = Math.log2(TOP_H * 2 * hz / fs);
  let l0, w;
  if (n < -1) { l0 = 0; w = 0; } else { const fl = Math.floor(n), fr = n - fl; l0 = fl + 1; w = fr > 1 - XF ? (fr - 1 + XF) / XF : 0; }
  if (l0 >= LEVELS - 1) { l0 = LEVELS - 1; w = 0; }
  const F = t.frames, fp = Math.min(Math.max(pos, 0), 1) * (F - 1), f0 = F > 1 ? Math.min(fp | 0, F - 2) : 0, ff = F > 1 ? fp - f0 : 0;
  const at = (l) => {
    const N = t.size[l], d = t.data[l], x = phase * N, i0 = x | 0, o0 = f0 * (N + G) + 2 + i0, o1 = o0 + (F > 1 ? N + G : 0);
    weights(x - i0);
    const s0 = lagrange(d, o0), s1 = lagrange(d, o1); return s0 + (s1 - s0) * ff;
  };
  const y = at(l0);
  return w > 0 ? y + (at(l0 + 1) - y) * w : y;
}
