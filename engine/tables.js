// Wavetables: a table is a run of frames, each one cycle of FRAME samples, and POSITION reads between neighbouring
// frames. Each frame is kept in LEVELS band-limited copies, one per octave: copy l holds the harmonics up to
// 1024 >> l (made with an inverse FFT from the frame's spectrum), so a note reads a copy with nothing above Nyquist.
// A note between two octaves crossfades the two copies, so a pitch sweep never steps.
//
// Build step 2 has BASIC only (sine > triangle > saw > square > narrow pulse), made from the textbook Fourier series
// of each shape. The other built-in tables and WAV loading come in build step 3. Pure JS: it runs in the AudioWorklet,
// a Worker and node.

export const FRAME = 2048, LEVELS = 11, MAX_H = FRAME / 2;

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
 * (index 1..MAX_H; index 0, the DC, is ignored). Every frame is scaled so its full-band copy peaks at 1, and every
 * copy of a frame takes the same scale, so a sweep across octaves doesn't change the level.
 * Returns { name, frames, data }: data[l] is one Float32Array of frames * (FRAME + 1) samples (a guard sample at each
 * frame's end repeats its start, so reading needs no wrap).
 */
export function buildTable(name, spectra) {
  const F = spectra.length, W = FRAME + 1, data = Array.from({ length: LEVELS }, () => new Float32Array(F * W));
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let f = 0; f < F; f++) {
    const { a, b } = spectra[f]; let scale = 1;
    for (let l = 0; l < LEVELS; l++) {
      const top = Math.min(MAX_H >> l, a.length - 1);
      re.fill(0); im.fill(0);
      for (let k = 1; k <= top; k++) { re[k] = a[k] / 2; im[k] = -b[k] / 2; if (k < FRAME / 2) { re[FRAME - k] = a[k] / 2; im[FRAME - k] = b[k] / 2; } }
      fft(re, im, 1);
      if (l === 0) { let m = 0; for (let i = 0; i < FRAME; i++) m = Math.max(m, Math.abs(re[i])); scale = m > 1e-9 ? 1 / m : 1; }
      const d = data[l], o = f * W;
      for (let i = 0; i < FRAME; i++) d[o + i] = re[i] * scale;
      d[o + FRAME] = d[o];
    }
  }
  return { name, frames: F, data };
}

// ---- the shapes of BASIC, as Fourier series (cosine a_k, sine b_k) ----
const spec = (fa, fb) => { const a = new Float64Array(MAX_H + 1), b = new Float64Array(MAX_H + 1); for (let k = 1; k <= MAX_H; k++) { a[k] = fa(k); b[k] = fb(k); } return { a, b }; };
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

/**
 * Read table t at position pos (0..1), phase (0..1), for a note of hz at sample rate fs: frames interpolated by
 * position, samples by phase, octave copies crossfaded by pitch.
 */
export function read(t, pos, phase, hz, fs) {
  // the copy whose top harmonic sits at Nyquist would be level n = log2(FRAME * hz / fs); read the two above it, so
  // nothing passes Nyquist, crossfaded by n's fraction
  const n = Math.log2(FRAME * hz / fs);
  let l0, w;
  if (n < -1) { l0 = 0; w = 0; } else { const fl = Math.floor(n); l0 = fl + 1; w = n - fl; }
  if (l0 >= LEVELS - 1) { l0 = LEVELS - 1; w = 0; }
  const F = t.frames, fp = Math.min(Math.max(pos, 0), 1) * (F - 1), f0 = Math.min(fp | 0, F - 2 < 0 ? 0 : F - 2), ff = F > 1 ? fp - f0 : 0;
  const x = phase * FRAME, i0 = x | 0, fr = x - i0, W = FRAME + 1, o0 = f0 * W + i0, o1 = o0 + (F > 1 ? W : 0);
  const at = (d) => { const s0 = d[o0] + (d[o0 + 1] - d[o0]) * fr, s1 = d[o1] + (d[o1 + 1] - d[o1]) * fr; return s0 + (s1 - s0) * ff; };
  const y = at(t.data[l0]);
  return w > 0 ? y + (at(t.data[l0 + 1]) - y) * w : y;
}
