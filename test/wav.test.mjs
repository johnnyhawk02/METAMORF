// WAV files to wavetable frames (app/wav.js): every bit depth, float, stereo, the frame-size marker, the frame-size
// cases, the edge join, and bad files.
import { decodeWav, autoSize, framesFrom, hashFrames, FRAME, MAX_FRAMES } from '../app/wav.js';
import { fromFrames } from '../engine/tables.js';

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const throws = (f, why) => { try { f(); return false; } catch (e) { return !why || e.message.includes(why); } };

// a WAV file: samples (-1..1) per channel, the format (1 int, 3 float, 0xfffe extensible), bits, extra chunks
function wav(chans, { format = 1, bits = 16, rate = 48000, marker = null, extra = [], cut = 0 } = {}) {
  const n = chans[0].length, C = chans.length, step = bits / 8, body = new Uint8Array(n * C * step), v = new DataView(body.buffer);
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) {
    const x = Math.max(-1, Math.min(1, chans[c][i])), o = (i * C + c) * step;
    if (format === 3 || (format === 0xfffe && bits === 32)) v.setFloat32(o, x, true);
    else if (bits === 8) body[o] = Math.round(x * 127 + 128);
    else if (bits === 16) v.setInt16(o, Math.round(x * 32767), true);
    else if (bits === 24) { const s = Math.round(x * 8388607); body[o] = s & 255; body[o + 1] = (s >> 8) & 255; body[o + 2] = (s >> 16) & 255; }
    else v.setInt32(o, Math.round(x * 2147483647), true);
  }
  const chunks = [];
  const chunk = (id, data) => { const h = new Uint8Array(8 + data.length + (data.length & 1)); h.set([...id].map((c) => c.charCodeAt(0))); new DataView(h.buffer).setUint32(4, data.length, true); h.set(data, 8); chunks.push(h); };
  const fmt = new Uint8Array(format === 0xfffe ? 40 : 16), f = new DataView(fmt.buffer);
  f.setUint16(0, format, true); f.setUint16(2, C, true); f.setUint32(4, rate, true); f.setUint32(8, rate * C * step, true); f.setUint16(12, C * step, true); f.setUint16(14, bits, true);
  if (format === 0xfffe) { f.setUint16(16, 22, true); f.setUint16(24, 3, true); } // (the sub-format: float)
  chunk('fmt ', fmt);
  if (marker) chunk('clm ', new TextEncoder().encode(marker));
  for (const [id, d] of extra) chunk(id, d);
  chunk('data', body);
  const all = chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(12 + all);
  out.set([...'RIFF'].map((c) => c.charCodeAt(0))); new DataView(out.buffer).setUint32(4, 4 + all, true); out.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
  let o = 12; for (const c of chunks) { out.set(c, o); o += c.length; }
  return cut ? out.subarray(0, out.length - cut) : out;
}
const saw = (n, frames = 1) => Float32Array.from({ length: n * frames }, (_, i) => ((i % n) / n) * 1.6 - 0.8);
const sine = (n, frames = 1, k = 1) => Float32Array.from({ length: n * frames }, (_, i) => 0.7 * Math.sin(2 * Math.PI * k * (i % n) / n));

// ---- every bit depth and float, mono and stereo: the samples come back ----
for (const [bits, format, tol] of [[8, 1, 1 / 100], [16, 1, 1e-4], [24, 1, 1e-6], [32, 1, 1e-8], [32, 3, 1e-7], [32, 0xfffe, 1e-7]]) {
  const x = sine(256, 2), w = decodeWav(wav([x], { bits, format }));
  ok(w.samples.length === 512 && w.rate === 48000, `${bits}-bit ${format}: length or rate`);
  let worst = 0; for (let i = 0; i < 512; i++) worst = Math.max(worst, Math.abs(w.samples[i] - x[i]));
  ok(worst < tol, `${bits}-bit format ${format}: off by ${worst}`);
}
{ const L = sine(256), R = sine(256, 1, 2), w = decodeWav(wav([L, R], { bits: 24 }));
  ok(w.samples.length === 256 && Math.abs(w.samples[10] - (L[10] + R[10]) / 2) < 1e-5, 'stereo is not summed to mono'); }
{ const w = decodeWav(wav([sine(64)], { rate: 44100, extra: [['LIST', new Uint8Array(13)]] }));
  ok(w.rate === 44100 && w.samples.length === 64, 'a file with another chunk (odd length) before the data'); }

// ---- the frame size: the marker, else 2048 when it divides, else ask (0) ----
ok(autoSize(decodeWav(wav([saw(2048, 4)]))) === 2048, 'four frames of 2048 without a marker');
ok(autoSize(decodeWav(wav([saw(256, 8)], { marker: '<!>256 10000000000000000000000000000000' }))) === 256, 'the marker <!>256');
ok(autoSize(decodeWav(wav([saw(1024, 3)]))) === 0, '3 x 1024 samples, no marker: must ask');
ok(autoSize(decodeWav(wav([saw(1000)]))) === 0, '1000 samples: must ask');
ok(autoSize(decodeWav(wav([saw(2048, 2)], { marker: '<!>777' }))) === 2048, 'a marker of no listed size is ignored');
{ const fr = framesFrom(decodeWav(wav([saw(1024, 3)])).samples, 1024); ok(fr.length === 3 && fr.every((f) => f.length === FRAME), '3 frames of 1024 to 3 of 2048'); }
{ const fr = framesFrom(decodeWav(wav([saw(4096, 2)])).samples, 4096); ok(fr.length === 2, '2 frames of 4096'); }
{ const fr = framesFrom(saw(1000), 0); ok(fr.length === 1 && fr[0].length === FRAME, 'the whole file as one cycle (1000 samples)'); }
{ const fr = framesFrom(saw(256, 300), 256); ok(fr.length === MAX_FRAMES, `up to ${MAX_FRAMES} frames: ${fr.length}`); }
// a frame resampled keeps its shape: a sine of 256 samples becomes a sine of 2048
{ const fr = framesFrom(sine(256), 256)[0]; let worst = 0; for (let i = 0; i < FRAME; i++) worst = Math.max(worst, Math.abs(fr[i] - Math.sin(2 * Math.PI * i / FRAME)));
  ok(worst < 1e-4, `a resampled sine is off by ${worst}`); }
{ const fr = framesFrom(sine(1000), 0)[0]; let worst = 0; for (let i = 0; i < FRAME; i++) worst = Math.max(worst, Math.abs(fr[i] - Math.sin(2 * Math.PI * i / FRAME)));
  ok(worst < 2e-3, `a sine of 1000 samples resampled is off by ${worst}`); }
// DC removed, the table normalised as a whole (the loudest frame peaks at 1, a quieter one stays quieter)
{ const x = Float32Array.from({ length: 4096 }, (_, i) => 0.3 + (i < 2048 ? 0.5 : 0.25) * Math.sin(2 * Math.PI * i / 2048)), fr = framesFrom(x, 2048);
  const mean = (f) => f.reduce((a, v) => a + v, 0) / f.length, pk = (f) => Math.max(...f.map(Math.abs));
  ok(Math.abs(mean(fr[0])) < 1e-6 && Math.abs(mean(fr[1])) < 1e-6, 'the DC is not removed');
  ok(Math.abs(pk(fr[0]) - 1) < 1e-6 && Math.abs(pk(fr[1]) - 0.5) < 1e-3, `not normalised as a whole: ${pk(fr[0])}, ${pk(fr[1])}`); }
// a frame whose end doesn't meet its start is joined: the jump from the last sample to the first gets small
{ const x = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(Math.PI * i / 2048)), f = framesFrom(x, 2048)[0]; // (half a sine: 0 rising to 1 and back, minus its DC)
  const ramp = Float32Array.from({ length: 2048 }, (_, i) => i / 2048), g = framesFrom(ramp, 2048)[0]; // a ramp: a jump of the whole height at the end
  let typical = 0; for (let i = 1; i < FRAME; i++) typical += Math.abs(g[i] - g[i - 1]); typical /= FRAME - 1;
  ok(Math.abs(g[0] - g[FRAME - 1]) < 0.1, `a ramp's end is not joined to its start: jump ${Math.abs(g[0] - g[FRAME - 1]).toFixed(3)}`);
  ok(Math.abs(f[0] - f[FRAME - 1]) < 0.01, 'a frame that already joins was changed'); }

// ---- the id: the same frames give the same hash; different ones a different hash ----
{ const a = framesFrom(saw(2048, 2), 2048), b = framesFrom(saw(2048, 2), 2048), c = framesFrom(sine(2048, 2), 2048);
  ok(hashFrames(a) === hashFrames(b) && /^[0-9a-f]{16}$/.test(hashFrames(a)), 'the same frames, a different hash');
  ok(hashFrames(a) !== hashFrames(c), 'different frames, the same hash');
  const T = fromFrames('user:' + hashFrames(a), 'SAW', a); ok(T.frames === 2 && T.data.every((d) => d.every(Number.isFinite)), 'a table from WAV frames'); }

// ---- bad files: said, not crashed ----
ok(throws(() => decodeWav(new Uint8Array(40)), 'not a WAV'), 'zeros are not a WAV file');
ok(throws(() => decodeWav(new TextEncoder().encode('RIFF....WAVEjunk')), ''), 'a WAV with no chunks');
{ const b = wav([sine(64)]); new DataView(b.buffer).setUint16(34, 12, true); /* (the fmt chunk says 12 bits) */ ok(throws(() => decodeWav(b), 'format 1, 12 bits'), 'a 12-bit file'); }
ok(throws(() => decodeWav(wav([sine(64)], { format: 3, bits: 64 })), '64-bit float'), 'a 64-bit float file');
{ const b = wav([sine(64)]); const n = new Uint8Array(b.length - 8 - 128); n.set(b.subarray(0, 36)); /* (no data chunk) */ ok(throws(() => decodeWav(n.subarray(0, 36)), 'no sample data'), 'a file with no data'); }
ok(throws(() => decodeWav(wav([sine(64)], { marker: 'x', cut: 0 }).subarray(0, 20)), ''), 'a file cut in its header');
{ const w = decodeWav(wav([sine(256, 2)], { cut: 100 })); ok(w.samples.length === 462, `a file cut short in its data keeps what is there: ${w.samples.length}`); }
ok(throws(() => framesFrom(new Float32Array(4096), 2048), 'silent'), 'a silent file');
ok(throws(() => framesFrom(saw(100), 256), 'shorter than one frame'), 'shorter than one frame');

console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
