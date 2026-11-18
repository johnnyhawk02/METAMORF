// WAV files to wavetable frames. Pure JS (no DOM): the page and the tests both use it.
//
// decodeWav(bytes) reads 8, 16, 24 and 32-bit integer and 32-bit float WAV, any sample rate, mono or stereo (summed),
// and a frame-size marker if the file has one (a 'clm ' chunk reading "<!>2048 ...", as some wavetable editors write).
// framesFrom(samples, size) cuts the samples into frames of size (or one frame of the whole file), resamples each to
// FRAME, removes each frame's DC, joins each frame's end to its start with a short crossfade where they don't meet,
// and normalises the whole table. Up to MAX_FRAMES frames.
export const FRAME = 2048, MAX_FRAMES = 256, SIZES = [256, 512, 1024, 2048, 4096];

const fail = (why) => { throw new Error(why); };

/** bytes (ArrayBuffer or Uint8Array) -> { samples: Float32Array (mono), rate, marker: frame size or 0 } */
export function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') fail('not a WAV file');
  let fmt = null, data = null, marker = 0;
  for (let o = 12; o + 8 <= u8.length;) {
    const id = tag(o), len = v.getUint32(o + 4, true), body = o + 8;
    if (body + len > u8.length && id !== 'data') fail('the file is cut short');
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      const channels = v.getUint16(body + 2, true), rate = v.getUint32(body + 4, true), bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && len >= 26) format = v.getUint16(body + 24, true); // (WAVE_FORMAT_EXTENSIBLE: the sub-format)
      fmt = { format, channels, rate, bits };
    } else if (id === 'data') data = { o: body, len: Math.min(len, u8.length - body) };
    else if (id === 'clm ') { const t = String.fromCharCode(...u8.subarray(body, body + Math.min(len, 40))); const m = /<!>\s*(\d+)/.exec(t); if (m) marker = +m[1]; }
    o = body + len + (len & 1);
  }
  if (!fmt) fail('no format chunk');
  if (!data) fail('no sample data');
  const { format, channels, rate, bits } = fmt;
  if (channels < 1 || channels > 8) fail(`${channels} channels`);
  const okInt = format === 1 && [8, 16, 24, 32].includes(bits), okFloat = format === 3 && bits === 32;
  if (!okInt && !okFloat) fail(format === 3 ? `${bits}-bit float` : `format ${format}, ${bits} bits`);
  const step = bits / 8, n = Math.floor(data.len / (step * channels));
  if (n < 2) fail('no samples');
  const read = okFloat ? (o) => v.getFloat32(o, true)
    : bits === 8 ? (o) => (u8[o] - 128) / 128
    : bits === 16 ? (o) => v.getInt16(o, true) / 32768
    : bits === 24 ? (o) => ((u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16)) << 8 >> 8) / 8388608
    : (o) => v.getInt32(o, true) / 2147483648;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < channels; c++) s += read(data.o + (i * channels + c) * step); samples[i] = Number.isFinite(s) ? s / channels : 0; }
  return { samples, rate, marker: SIZES.includes(marker) ? marker : 0 };
}

/** the frame size to use without asking: the marker, else FRAME when the length divides by it, else 0 (ask) */
export const autoSize = ({ samples, marker }) => (marker && samples.length % marker === 0 ? marker : samples.length % FRAME === 0 ? FRAME : 0);

// one frame, of any length, resampled to FRAME: by its spectrum when its length is a power of two (exact for a
// periodic frame), else by periodic 6-point interpolation
function resample(x) {
  const n = x.length; if (n === FRAME) return Float64Array.from(x);
  const y = new Float64Array(FRAME);
  if ((n & (n - 1)) === 0) {
    // x's spectrum (length n) placed into a buffer of FRAME (harmonics past either's half dropped), then back
    const xr = Float64Array.from(x), xi = new Float64Array(n); fftc(xr, xi, -1);
    const H = Math.min(n, FRAME) / 2;
    const R = new Float64Array(FRAME), I = new Float64Array(FRAME);
    for (let k = 0; k < H; k++) { R[k] = xr[k] / n; I[k] = xi[k] / n; if (k) { R[FRAME - k] = xr[n - k] / n; I[FRAME - k] = xi[n - k] / n; } }
    fftc(R, I, 1); for (let i = 0; i < FRAME; i++) y[i] = R[i];
    return y;
  }
  for (let i = 0; i < FRAME; i++) {
    const p = i * n / FRAME, j = Math.floor(p), f = p - j, at = (k) => x[((j + k) % n + n) % n];
    const a = f + 2, b = f + 1, c = f, d = f - 1, e = f - 2, g = f - 3;
    y[i] = -b * c * d * e * g / 120 * at(-2) + a * c * d * e * g / 24 * at(-1) - a * b * d * e * g / 12 * at(0) + a * b * c * e * g / 12 * at(1) - a * b * c * d * g / 24 * at(2) + a * b * c * d * e / 120 * at(3);
  }
  return y;
}
function fftc(re, im, sign) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = sign * 2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}

/** samples -> frames (Float32Array of FRAME each); size: the frame size, or 0 for one frame of the whole file */
export function framesFrom(samples, size) {
  const len = size || samples.length, count = Math.min(MAX_FRAMES, Math.floor(samples.length / len));
  if (count < 1) fail('shorter than one frame');
  const frames = [];
  for (let f = 0; f < count; f++) {
    const y = resample(samples.subarray(f * len, (f + 1) * len));
    let dc = 0; for (let i = 0; i < FRAME; i++) dc += y[i]; dc /= FRAME; for (let i = 0; i < FRAME; i++) y[i] -= dc;
    // the end joins the start: where the jump from the last sample to the first is much bigger than the frame's
    // typical step, crossfade the last 32 samples into a line that leads to the first
    let typical = 0; for (let i = 1; i < FRAME; i++) typical += Math.abs(y[i] - y[i - 1]); typical /= FRAME - 1;
    if (Math.abs(y[0] - y[FRAME - 1]) > 4 * typical + 1e-4) {
      const L = 32, from = y[FRAME - L - 1], to = y[0];
      for (let i = 0; i < L; i++) { const w = (i + 1) / (L + 1), line = from + (to - from) * w, m = 0.5 - 0.5 * Math.cos(Math.PI * w); y[FRAME - L + i] = y[FRAME - L + i] * (1 - m) + line * m; }
    }
    frames.push(y);
  }
  let peak = 0; for (const y of frames) for (const s of y) peak = Math.max(peak, Math.abs(s));
  if (peak < 1e-6) fail('silent');
  return frames.map((y) => Float32Array.from(y, (s) => s / peak));
}

/** a short content hash of the frames (FNV-1a, 64 bits as hex), for the table's id: the same file gives the same id */
export function hashFrames(frames) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (const f of frames) { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 0x01000193); h2 = Math.imul(h2 ^ u[i], 0x5bd1e995); } }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
