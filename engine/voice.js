// One engine's voice: a one-shot percussion voice. Pure JS (no DOM, no Web Audio): it renders float buffers at any
// sample rate, so it runs in the AudioWorklet, in a Worker for offline renders, and in node for the tests.
//
// Two wavetable oscillators, each on its own TABLE (OSC A at the sound's pitch; OSC B at a RATIO of it, DETUNEd, following
// A's pitch envelope by TRACK), an amp envelope (ATTACK, HOLD, DECAY, CURVE) and a pitch envelope (AMOUNT, DECAY,
// CURVE). FM: A > B and B > A, phase modulation each way (both: cross-FM, which stays bounded since each oscillator's
// output is). NOISE: white noise from a generator seeded per note by SEED, tilted dark to bright by COLOUR (its level
// kept by a gain worked out from the filter), on its own decay (a share of the amp's). CLICK: generated at the start of
// the note, a pulse through a chirp to a noise burst (SHAPE), at TONE, over LENGTH; DIRECT is the share that will skip
// the filters (build step 5). DRIVE: tanh saturation with its level matched, with first-order antiderivative
// anti-aliasing. Every parameter glides (a one-pole of about 5 ms on its normalised value) so a knob turned while the
// note rings never clicks; a new note snaps straight to its own settings.
// Modulation: MOD ENV (1 down to 0 over its DECAY), the LFO (free running from the note's start, SHAPE sine > triangle
// > saw > square > smooth random) and VELOCITY (centred on 100) reach any parameter by an amount per source and
// destination ($m beside the parameters: { 'env>cutoff': amount, ... }), added to its normalised value before its curve
// and clamped. Only the destinations with an amount are touched, so an unmodulated sound costs nothing more. REPEAT
// retriggers the envelopes (and the click) SPACING apart: its whole part the number of repeats, its fraction the level
// of the last. Both phases start at zero on every note and
// the noise is seeded from the sound, so a sound renders the same every time.
import { PARAMS, MAPS, levelGain, modDepth, MOD_SOURCES } from '../sound/params.js?v=mwm8nfdt';
import { MorphFilter, Filter2 } from './filters.js?v=STAMP';
import { table, read, DEFAULT_TABLE } from './tables.js?v=mwm8nfdt';

// an oscillator's table: the sound names it by id ($a, $b beside the parameters); one this thread doesn't hold plays
// BASIC (missing: true). A table changed during a note crossfades over 10 ms from the old one, so it never clicks
class Tab {
  constructor() { this.t = table(DEFAULT_TABLE); this.old = null; this.x = 1; this.id = DEFAULT_TABLE; this.missing = false; }
  set(id, now) {
    id = id || DEFAULT_TABLE; if (id === this.id && !now && !this.missing) return; // (a note start looks again: a table may have arrived)
    const t = table(id); this.missing = !t; this.id = id;
    const nt = t || table(DEFAULT_TABLE);
    if (now) { this.t = nt; this.old = null; this.x = 1; } else if (nt !== this.t) { this.old = this.t; this.t = nt; this.x = 0; }
  }
  /** read at pos, phase, hz; step: the crossfade's step per sample */
  read(pos, phase, hz, fs, step) {
    const y = read(this.t, pos, phase, hz, fs);
    if (!this.old) return y;
    const o = read(this.old, pos, phase, hz, fs), x = this.x; this.x += step; if (this.x >= 1) { this.old = null; this.x = 1; }
    return o + (y - o) * x;
  }
}

const IDS = PARAMS.map((p) => p.id), N = IDS.length;
const IX = Object.fromEntries(IDS.map((id, i) => [id, i]));
const MAP = PARAMS.map((p) => MAPS[p.map]), LO = PARAMS.map((p) => p.lo), HI = PARAMS.map((p) => p.hi);
const LO_N = PARAMS.map((p) => (p.map === 'bip' ? -1 : 0)); // (the normalised range's bottom)
const BASE_HZ = 261.6255653; // a sound's pitch with TUNE at 0: C at MIDI 60 (keys don't transpose)
const SILENT = Math.pow(10, -90 / 20); // a voice ends after 50 ms below -90 dB
const FM_DEPTH = 0.8; // A > B and B > A at full: a phase swing of 0.8 of a cycle per unit of the modulator
const NOISE_LEVEL = 0.5; // (white noise at LEVEL 1: about as loud as an oscillator at full)
// the half-band filter for DRIVE's twice-the-rate: a windowed sinc (Kaiser, beta 8), its 12 odd taps each side (the
// even ones are zero but the centre, 1/2). Stopband about -80 dB; flat to about 19 kHz at 48 kHz
const HB_L = 12;
const HB = (() => {
  const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
  return Array.from({ length: HB_L }, (_, i) => { const k = 2 * i + 1, w = I0(8 * Math.sqrt(1 - (k / (2 * HB_L)) ** 2)) / I0(8); return 0.5 * Math.sin(Math.PI * k / 2) / (Math.PI * k / 2) * w; });
})();
export const DRIVE_DELAY = 2 * HB_L - 1; // (samples: the filters' delay, the same for every sound)
const MAX_ROUTES = 64, SRC_OF = Object.fromEntries(MOD_SOURCES.map((s, i) => [s, i]));
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const OUTS = ['level', 'pan', 'send', 'trim'];

// an envelope segment's shape over t = 0..1, from 1 down to 0. CURVE -1 is nearly linear, +1 a steep exponential
export const curveK = (c) => Math.pow(30, (c + 1) / 2);
// the noise generator: xorshift32, -1..1
const xs = (s) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
// ln(cosh(x)) without overflow: the antiderivative of tanh
const logcosh = (x) => { const a = x < 0 ? -x : x; return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2; };
export const shape = (t, k) => { const e = Math.exp(-k); return (Math.exp(-k * t) - e) / (1 - e); };

export class Voice {
  constructor(fs) {
    this.fs = fs; this.on = false;
    this.cur = new Float64Array(N); this.tgt = new Float64Array(N); this.real = new Float64Array(N);
    this.out = { level: 0, pan: 0, send: 0, trim: 0 }; this.outT = { level: 0, pan: 0, send: 0, trim: 0 };
    this.glide = 1 - Math.exp(-1 / (0.005 * fs));
    this.minAttack = 0.0003; // ATTACK at 0 is still a ramp of 0.3 ms (a dozen or so samples): no click
    this.tabA = new Tab(); this.tabB = new Tab(); this.xfStep = 1 / (0.01 * fs);
    this.dcR = 1 - 2 * Math.PI * 5 / fs;
    this.dX = new Float64Array(64); this.dV = new Float64Array(128); this.dd = new Float64Array(DRIVE_DELAY);
    this.f1 = new MorphFilter(fs); this.f2 = new Filter2(fs);
    // the routes: destination, source, depth (normalised units at amount 1), amount now and where it's going
    this.rD = new Int16Array(MAX_ROUTES); this.rS = new Int8Array(MAX_ROUTES); this.rK = new Float64Array(MAX_ROUTES);
    this.rA = new Float64Array(MAX_ROUTES); this.rT = new Float64Array(MAX_ROUTES); this.nR = 0;
    this.mSum = new Float64Array(N); this.mDst = []; this.src = new Float64Array(3);
  }
  /** the routes from $m: kept ones glide to their new amount, new ones glide in from 0, missing ones glide out */
  routes(m, now) {
    for (let i = 0; i < this.nR; i++) this.rT[i] = 0;
    if (m && typeof m === 'object') for (const key in m) {
      const at = key.indexOf('>'), s = SRC_OF[key.slice(0, at)], d = IX[key.slice(at + 1)], v = +m[key];
      if (s === undefined || d === undefined || !Number.isFinite(v) || !v) continue;
      let i = 0; while (i < this.nR && !(this.rD[i] === d && this.rS[i] === s)) i++;
      if (i === this.nR) { if (i >= MAX_ROUTES) continue; this.nR++; this.rD[i] = d; this.rS[i] = s; this.rK[i] = modDepth(s, IDS[d]); this.rA[i] = 0; }
      this.rT[i] = Math.max(-1, Math.min(1, v));
    }
    if (now) { for (let i = 0; i < this.nR; i++) this.rA[i] = this.rT[i]; this.dropRoutes(); }
    this.mDst = [...new Set(Array.from(this.rD.subarray(0, this.nR)))];
  }
  dropRoutes() { // (routes at zero and going nowhere: gone)
    let j = 0;
    for (let i = 0; i < this.nR; i++) if (this.rA[i] || this.rT[i]) { this.rD[j] = this.rD[i]; this.rS[j] = this.rS[i]; this.rK[j] = this.rK[i]; this.rA[j] = this.rA[i]; this.rT[j] = this.rT[i]; j++; }
    if (j !== this.nR) { this.nR = j; this.mDst = [...new Set(Array.from(this.rD.subarray(0, j)))]; this.mapAll(); }
  }
  /** a new note, at once, with its own settings (normalised params by id, out: the key's level, pan, send, trim) */
  start(params, out, vel, gain = 1) {
    this.tabA.set(params.$a, true); this.tabB.set(params.$b, true);
    for (let i = 0; i < N; i++) this.cur[i] = this.tgt[i] = params[IDS[i]];
    this.nR = 0; this.routes(params.$m, true);
    // VELOCITY: 0 at 100, +1 at 127, -1 at 1; read once
    this.src[2] = vel >= 100 ? (vel - 100) / 27 : (vel - 100) / 99;
    this.src[0] = 1; this.src[1] = 0; this.mt = 0; this.lph = 0; this.lrA = 0; this.lrB = 0; this.lrng = 0x2545f491;
    this.rep = 0; this.rt = 0; this.lvl = 1; this.from = 0; // (REPEAT: how many so far, samples since the last, this one's level, the attack's start)
    for (const k of OUTS) this.out[k] = this.outT[k] = out[k];
    this.mapAll();
    this.vel = vel / 127; this.gain = gain;
    this.phase = 0; this.phaseB = 0; this.stage = 0; this.t = 0; this.pt = 0; this.env = 0;
    this.yA = 0; this.yB = 0; // (the oscillators' last samples, for FM)
    this.tn = 0; this.envN = 0; this.nzLp = 0; this.nzHp = 0; // (the noise: its decay's time, its envelope, the colour filter)
    let seed = clamp01(params.n_seed); for (let i = 0; i < this.nR; i++) if (IDS[this.rD[i]] === 'n_seed') seed = clamp01(seed + this.rA[i] * this.rK[i] * this.src[this.rS[i]]); // (velocity may move the seed)
    this.rng = 1 + Math.floor(seed * 65535) * 7919; this.crng = 0x9e3779b9; // (the noise seeded by SEED; the click's burst fixed)
    this.ct = 0; this.cph = 0; this.cb1 = 0; this.cb2 = 0; // (the click: its time, its chirp's phase, its band-pass)
    this.dcX = 0; this.dcY = 0; // (the DC blocker)
    this.f1.reset(); this.f2.reset(); this.f2on = false; this.dd.fill(0); this.ddN = 0; // (the filters, the click's direct path)
    this.dx = 0; this.dF = 0; this.dX.fill(0); this.dV.fill(0); this.dN = 0; this.dE = 0; // (the drive: its filters, its curve's last input and antiderivative)
    this.quiet = 0; this.fade = 1; this.fadeStep = 0; this.moving = false; this.on = true;
  }
  /** settings changed while the note sounds: glide to them */
  set(params, out) {
    if (params) { for (let i = 0; i < N; i++) { const v = params[IDS[i]]; if (v !== undefined) this.tgt[i] = v; } if ('$m' in params) this.routes(params.$m, false); if ('$a' in params) this.tabA.set(params.$a, false); if ('$b' in params) this.tabB.set(params.$b, false); }
    if (out) for (const k of OUTS) if (out[k] !== undefined) this.outT[k] = out[k];
    this.moving = true;
  }
  /** one sample through DRIVE at twice the rate (see render) */
  drive2x(x, on) {
    const X = this.dX, V = this.dV, n = (this.dN = (this.dN + 1) & 63); X[n] = x;
    // up: the sample L back as it is, and the point halfway to the next, from the half-band's odd taps
    let mid = 0; for (let m = 1; m <= HB_L; m++) mid += HB[m - 1] * (X[(n - HB_L - m + 1) & 63] + X[(n - HB_L + m) & 63]);
    const e = (this.dE = (this.dE + 2) & 127);
    V[e] = on ? this.curve(X[(n - HB_L) & 63]) : X[(n - HB_L) & 63]; V[(e + 1) & 127] = on ? this.curve(2 * mid) : 2 * mid;
    // down: the half-band again, centred L - 1 pairs back
    const c = (e - 2 * HB_L + 2) & 127; let y = 0.5 * V[c];
    for (let m = 1; m <= HB_L; m++) y += HB[m - 1] * (V[(c - 2 * m + 1) & 127] + V[(c + 2 * m - 1) & 127]);
    return y;
  }
  curve(v) {
    const g = this.dg, x = v * g, F = logcosh(x), d = x - this.dx;
    const t = d > 1e-5 || d < -1e-5 ? (F - this.dF) / d : Math.tanh((x + this.dx) / 2);
    this.dx = x; this.dF = F; return t * this.dNorm;
  }
  /** the LFO at its phase: SHAPE 0 sine, .25 triangle, .5 saw, .75 square, 1 smooth random; between, neighbours mix */
  lfo(sh) {
    const p = this.lph, f = sh * 4, i = Math.min(3, Math.floor(f)), t = f - i;
    const one = (k) => (k === 0 ? Math.sin(2 * Math.PI * p) : k === 1 ? (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4) : k === 2 ? 1 - 2 * p
      : k === 3 ? (p < 0.5 ? 1 : -1) : this.lrA + (this.lrB - this.lrA) * (0.5 - 0.5 * Math.cos(Math.PI * p)));
    return t > 0 ? one(i) * (1 - t) + one(i + 1) * t : one(i);
  }
  /** let the note go over n samples (a new note on the engine takes over: no click) */
  fadeOut(n) { if (this.on) this.fadeStep = 1 / Math.max(1, n); }
  mapAll() {
    const r = this.real;
    for (let i = 0; i < N; i++) r[i] = MAP[i](this.cur[i], LO[i], HI[i]);
    this.derive();
  }
  /** the modulated destinations' real values, from their own and the routes' (per sample) */
  modulate() {
    const S = this.mSum, r = this.real, cur = this.cur, src = this.src;
    for (const d of this.mDst) S[d] = 0;
    for (let i = 0; i < this.nR; i++) S[this.rD[i]] += this.rA[i] * this.rK[i] * src[this.rS[i]];
    for (const d of this.mDst) { const lo = LO_N[d], v = cur[d] + S[d]; r[d] = MAP[d](v < lo ? lo : v > 1 ? 1 : v, LO[d], HI[d]); }
  }
  /** what follows from the parameters: the curves' constants, the noise's colour filter, the drive's gain */
  derive() {
    const r = this.real, fs = this.fs;
    this.kMe = curveK(r[IX.me_curve]);
    this.kAmp = curveK(r[IX.curve]); this.kPitch = curveK(r[IX.p_curve]);
    // NOISE COLOUR: below 0 a one-pole low-pass, its coefficient from 1 (white) down to a corner at 250 Hz; above 0 a
    // one-pole high-pass with its corner from 5 Hz (white, near enough) up to 6 kHz (by the square root of COLOUR, so the bright half moves as much as the dark). Both always run, so crossing 0
    // never jumps. The gain keeps white noise's level: its power through the filter, from the coefficient
    const c = r[IX.n_colour], aMin = 1 - Math.exp(-2 * Math.PI * 250 / fs);
    const aL = c < 0 ? Math.pow(aMin, -c) : 1, aH = 1 - Math.exp(-2 * Math.PI * Math.min(5 * Math.pow(1200, c > 0 ? Math.sqrt(c) : 0), 0.45 * fs) / fs);
    this.nAL = aL; this.nAH = aH; this.nHi = c > 0;
    const pow = c > 0 ? 1 - 2 * aH + aH / (2 - aH) : aL / (2 - aL); this.nGain = Math.min(8, 1 / Math.sqrt(Math.max(pow, 1e-6)));
    // DRIVE: tanh(g x) / tanh(g), g from 0.05 (clean: unity, near enough) to 24 (squared: fine control at the gentle end)
    const d = r[IX.drive]; this.dg = 0.05 + 24 * d * d; this.dNorm = 1 / Math.tanh(this.dg);
  }
  /** add this voice into L, R (and its reverb send into SL, SR) from sample i0 to i1; returns its peak */
  render(L, R, SL, SR, i0, i1) {
    if (!this.on) return 0;
    const fs = this.fs, cur = this.cur, tgt = this.tgt, r = this.real, g = this.glide, o = this.out, oT = this.outT;
    let peak = 0;
    for (let i = i0; i < i1; i++) {
      if (this.moving) { // glide every setting towards where it is set
        let still = true;
        for (let j = 0; j < N; j++) { const d = tgt[j] - cur[j]; if (d > 1e-7 || d < -1e-7) { cur[j] += d * g; still = false; } else cur[j] = tgt[j]; }
        for (const k of OUTS) { const d = oT[k] - o[k]; if (d > 1e-7 || d < -1e-7) { o[k] += d * g; still = false; } else o[k] = oT[k]; }
        for (let j = 0; j < this.nR; j++) { const d = this.rT[j] - this.rA[j]; if (d > 1e-7 || d < -1e-7) { this.rA[j] += d * g; still = false; } else this.rA[j] = this.rT[j]; }
        this.mapAll(); this.moving = !still; if (still) this.dropRoutes();
      }
      // REPEAT: the envelopes (and the click) start again SPACING after the last start, from where the amp is; the last
      // repeat at the fraction's level
      { const R = r[IX.repeat], n = Math.ceil(R - 1e-9);
        if (this.rep < n && ++this.rt >= r[IX.spacing] / 1000 * fs) {
          this.rep++; this.rt = 0; const fr = R - Math.floor(R); this.lvl = this.rep === n && fr > 1e-9 ? fr : 1;
          this.from = this.env; this.stage = 0; this.t = 0; this.pt = 0; this.tn = 0; this.mt = 0; this.ct = 0; this.cph = 0;
        } }
      // the sources: MOD ENV, the LFO (VELOCITY is set at the note's start), then the routes they drive
      if (this.nR) {
        if (this.mt < 1) { this.mt += 1 / (r[IX.me_decay] / 1000 * fs); this.src[0] = this.mt < 1 ? shape(this.mt, this.kMe) : 0; }
        this.src[1] = this.lfo(r[IX.lfo_shape]); this.lph += r[IX.lfo_rate] / fs; if (this.lph >= 1) { this.lph -= Math.floor(this.lph); this.lrA = this.lrB; this.lrng = xs(this.lrng); this.lrB = this.lrng / 2147483648 - 1; }
        this.modulate();
        if ((i & 15) === 0) this.derive(); // (the curves, the noise's colour and the drive's gain follow every 16 samples)
      }
      // the amp envelope: attack (a linear ramp), hold, decay (CURVE: linear-ish to steep)
      if (this.stage === 0) { this.t += 1 / (Math.max(r[IX.attack] / 1000, this.minAttack) * fs); this.env = this.from + (this.lvl - this.from) * Math.min(1, this.t); if (this.t >= 1) { this.stage = 1; this.t = 0; } }
      else if (this.stage === 1) { this.env = this.lvl; const h = r[IX.hold] / 1000; this.t += h > 0 ? 1 / (h * fs) : 1; if (this.t >= 1) { this.stage = 2; this.t = 0; } }
      else if (this.stage === 2) { this.t += 1 / (r[IX.decay] / 1000 * fs); if (this.t >= 1) { this.stage = 3; this.env = 0; } else this.env = this.lvl * shape(this.t, this.kAmp); }
      else this.env = 0;
      // the pitch envelope, from the note's start
      let pe = 0;
      if (this.pt < 1) { this.pt += 1 / (r[IX.p_decay] / 1000 * fs); pe = this.pt < 1 ? shape(this.pt, this.kPitch) : 0; }
      // OSC A at the sound's pitch; OSC B at RATIO times it, DETUNEd, with TRACK of A's pitch envelope (0: B holds still)
      const base = r[IX.a_tune] + r[IX.a_fine] / 100, sweep = r[IX.p_amt] * pe, top = fs * 0.45;
      const hz = Math.min(BASE_HZ * Math.pow(2, (base + sweep) / 12), top);
      let y = 0, yd = 0; // (yd: the click's DIRECT share, which skips DRIVE and the filters)
      const la = r[IX.a_level], lb = r[IX.b_level], ab = r[IX.fm_ab] * FM_DEPTH, ba = r[IX.fm_ba] * FM_DEPTH;
      // FM: B > A moves A's phase by B's last sample; A > B moves B's by A's this sample (so cross-FM is a loop of one
      // sample, and bounded: each oscillator's output is)
      if (la > 0 || ab > 0) { let ph = this.phase + ba * this.yB; ph -= Math.floor(ph); this.yA = this.tabA.read(r[IX.a_pos], ph, hz, fs, this.xfStep); } else this.yA = 0;
      if (la > 0) y += this.yA * la;
      this.phase += hz / fs; if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      { // (B's phase always runs, so its level turned up mid-note starts in step)
        const hzB = Math.min(BASE_HZ * Math.pow(2, (base + sweep * r[IX.b_track] + r[IX.b_det] / 100) / 12) * r[IX.b_ratio], top);
        if (lb > 0 || ba > 0) { let ph = this.phaseB + ab * this.yA; ph -= Math.floor(ph); this.yB = this.tabB.read(r[IX.b_pos], ph, hzB, fs, this.xfStep); } else this.yB = 0;
        if (lb > 0) y += this.yB * lb;
        this.phaseB += hzB / fs; if (this.phaseB >= 1) this.phaseB -= Math.floor(this.phaseB);
      }
      // CLICK: SHAPE 0 a pulse (decaying at TONE), .5 a chirp falling from TONE three octaves, 1 a noise burst around
      // TONE; between, the neighbours crossfade. Over LENGTH, with a fade to zero at its end
      const cl = r[IX.c_level];
      if (cl > 0 && this.ct < 1) {
        const len = r[IX.c_len] / 1000, tone = Math.min(r[IX.c_tone], 0.45 * fs), sec = this.ct * len, sh = r[IX.c_shape];
        let c = 0;
        if (sh < 0.5) c += Math.exp(-2 * Math.PI * tone * sec) * (1 - 2 * sh);
        if (sh > 0 && sh < 1) { const f = tone * Math.pow(0.125, this.ct); this.cph += f / fs; c += Math.sin(2 * Math.PI * this.cph) * (sh < 0.5 ? 2 * sh : 2 - 2 * sh); }
        if (sh > 0.5) { // (a band-pass, two poles, Q 1.5, on its own noise: the state-variable form, stable to TONE at 0.45 of the rate)
          this.crng = xs(this.crng); const w = this.crng / 2147483648 - 1, g = Math.tan(Math.PI * tone / fs), k = 1 / 1.5;
          const hp = (w - (k + g) * this.cb1 - this.cb2) / (1 + k * g + g * g), bp = g * hp + this.cb1, lp = g * bp + this.cb2;
          this.cb1 = g * hp + bp; this.cb2 = g * bp + lp; c += bp * 2.2 * (2 * sh - 1);
        }
        const fade = 1 - this.ct, cc = c * cl * fade * fade, dr = r[IX.c_direct]; y += cc * (1 - dr); yd = cc * dr;
        this.ct += 1 / (len * fs);
      }
      y *= this.env; yd *= this.env;
      // NOISE: its own envelope (the amp's attack and hold, then its decay: DECAY times the amp's)
      const nl = r[IX.n_level];
      if (this.stage < 2) this.envN = this.env;
      else if (this.tn < 1) { this.tn += 1 / (r[IX.decay] / 1000 * r[IX.n_decay] * fs); this.envN = this.tn < 1 ? this.lvl * shape(this.tn, this.kAmp) : 0; }
      else this.envN = 0;
      { this.rng = xs(this.rng); const w = this.rng / 2147483648 - 1; this.nzLp += this.nAL * (w - this.nzLp); this.nzHp += this.nAH * (w - this.nzHp); // (the generator always runs: the noise turned up mid-note continues the sequence)
        if (nl > 0 && this.envN > 0) y += (this.nHi ? w - this.nzHp : this.nzLp) * this.nGain * nl * NOISE_LEVEL * this.envN; }
      // DRIVE: y -> tanh(g y) / tanh(g) at twice the rate (a half-band filter up and down), anti-aliased again at that
      // rate (the change of tanh's antiderivative over the change of its input). The filters always run, so the
      // sound's delay (DRIVE_DELAY samples) never changes; at DRIVE 0 the curve is left out
      y = this.drive2x(y, r[IX.drive] > 0);
      // (FM can put energy at 0 Hz, where its sidebands fold over, and DRIVE on a lopsided wave makes some: a DC blocker,
      // its corner at 5 Hz)
      { const x = y; y = x - this.dcX + this.dcR * this.dcY; this.dcX = x; this.dcY = y; }
      // FILTER 1 (the morph filter; TRACK: the cutoff follows the sound's pitch, its envelope too), then FILTER 2 (MIX
      // of the comb and vowel blend; PITCH follows the sound's by its TRACK), then the click's DIRECT share, delayed as
      // DRIVE delays the rest
      const up = hz / BASE_HZ;
      y = this.f1.process(y, r[IX.cutoff] * Math.pow(up, r[IX.f_track]), r[IX.reso], r[IX.f_morph]);
      const mx = r[IX.f2_mix];
      if (mx > 0) { const w = this.f2.process(y, r[IX.f2_pitch] * Math.pow(up, r[IX.f2_track]), r[IX.f2_res], r[IX.f2_damp], r[IX.f2_vowel], r[IX.f2_blend]); y += (w - y) * mx; this.f2on = true; }
      else if (this.f2on) { this.f2.reset(); this.f2on = false; }
      { const n = (this.ddN = (this.ddN + 1) % DRIVE_DELAY); y += this.dd[n]; this.dd[n] = yd; }
      // the key's output: velocity, LEVEL, TRIM, the engine's level and the fade, then an equal-power PAN
      if (this.fadeStep) { this.fade -= this.fadeStep; if (this.fade <= 0) { this.fade = 0; this.on = false; } }
      const amp = y * this.vel * levelGain(o.level) * Math.pow(10, o.trim / 20) * this.gain * this.fade;
      const a = (o.pan + 1) * Math.PI / 4, l = amp * Math.cos(a), rr = amp * Math.sin(a);
      L[i] += l; R[i] += rr; SL[i] += l * o.send; SR[i] += rr * o.send;
      const m = amp < 0 ? -amp : amp; if (m > peak) peak = m;
      if (m < SILENT) { if (++this.quiet > 0.05 * fs && this.stage >= 2 && (this.envN === 0 || r[IX.n_level] === 0) && this.rep >= Math.ceil(r[IX.repeat] - 1e-9)) { this.on = false; break; } } else this.quiet = 0;
      if (!this.on) break;
    }
    return peak;
  }
}
