// One engine's voice: a one-shot percussion voice. Pure JS (no DOM, no Web Audio): it renders float buffers at any
// sample rate, so it runs in the AudioWorklet, in a Worker for offline renders, and in node for the tests.
//
// Build step 2: two wavetable oscillators on BASIC (OSC A at the sound's pitch; OSC B at a RATIO of it, DETUNEd, following
// A's pitch envelope by TRACK), an amp envelope (ATTACK, HOLD, DECAY, CURVE) and a pitch envelope (AMOUNT, DECAY,
// CURVE). Every parameter glides (a one-pole of about 5 ms on its normalised value) so a knob turned while the note
// rings never clicks; a new note snaps straight to its own settings. Both phases start at zero on every note and
// nothing is random, so a sound renders the same every time.
import { PARAMS, MAPS, levelGain } from '../sound/params.js?v=mwm5nxnv';
import { tables, read } from './tables.js?v=mwm5nxnv';

const IDS = PARAMS.map((p) => p.id), N = IDS.length;
const IX = Object.fromEntries(IDS.map((id, i) => [id, i]));
const MAP = PARAMS.map((p) => MAPS[p.map]), LO = PARAMS.map((p) => p.lo), HI = PARAMS.map((p) => p.hi);
const BASE_HZ = 261.6255653; // a sound's pitch with TUNE at 0: C at MIDI 60 (keys don't transpose)
const SILENT = Math.pow(10, -90 / 20); // a voice ends after 50 ms below -90 dB
const OUTS = ['level', 'pan', 'send', 'trim'];

// an envelope segment's shape over t = 0..1, from 1 down to 0. CURVE -1 is nearly linear, +1 a steep exponential
export const curveK = (c) => Math.pow(30, (c + 1) / 2);
export const shape = (t, k) => { const e = Math.exp(-k); return (Math.exp(-k * t) - e) / (1 - e); };

export class Voice {
  constructor(fs) {
    this.fs = fs; this.on = false;
    this.cur = new Float64Array(N); this.tgt = new Float64Array(N); this.real = new Float64Array(N);
    this.out = { level: 0, pan: 0, send: 0, trim: 0 }; this.outT = { level: 0, pan: 0, send: 0, trim: 0 };
    this.glide = 1 - Math.exp(-1 / (0.005 * fs));
    this.minAttack = 0.0003; // ATTACK at 0 is still a ramp of 0.3 ms (a dozen or so samples): no click
    this.table = tables(); // (BASIC until TABLE comes in build step 3)
  }
  /** a new note, at once, with its own settings (normalised params by id, out: the key's level, pan, send, trim) */
  start(params, out, vel, gain = 1) {
    for (let i = 0; i < N; i++) this.cur[i] = this.tgt[i] = params[IDS[i]];
    for (const k of OUTS) this.out[k] = this.outT[k] = out[k];
    this.mapAll();
    this.vel = vel / 127; this.gain = gain;
    this.phase = 0; this.phaseB = 0; this.stage = 0; this.t = 0; this.pt = 0; this.env = 0;
    this.quiet = 0; this.fade = 1; this.fadeStep = 0; this.moving = false; this.on = true;
  }
  /** settings changed while the note sounds: glide to them */
  set(params, out) {
    if (params) for (let i = 0; i < N; i++) { const v = params[IDS[i]]; if (v !== undefined) this.tgt[i] = v; }
    if (out) for (const k of OUTS) if (out[k] !== undefined) this.outT[k] = out[k];
    this.moving = true;
  }
  /** let the note go over n samples (a new note on the engine takes over: no click) */
  fadeOut(n) { if (this.on) this.fadeStep = 1 / Math.max(1, n); }
  mapAll() { for (let i = 0; i < N; i++) this.real[i] = MAP[i](this.cur[i], LO[i], HI[i]); this.kAmp = curveK(this.real[IX.curve]); this.kPitch = curveK(this.real[IX.p_curve]); }
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
        this.mapAll(); this.moving = !still;
      }
      // the amp envelope: attack (a linear ramp), hold, decay (CURVE: linear-ish to steep)
      if (this.stage === 0) { this.t += 1 / (Math.max(r[IX.attack] / 1000, this.minAttack) * fs); this.env = Math.min(1, this.t); if (this.t >= 1) { this.stage = 1; this.t = 0; } }
      else if (this.stage === 1) { this.env = 1; const h = r[IX.hold] / 1000; this.t += h > 0 ? 1 / (h * fs) : 1; if (this.t >= 1) { this.stage = 2; this.t = 0; } }
      else if (this.stage === 2) { this.t += 1 / (r[IX.decay] / 1000 * fs); if (this.t >= 1) { this.stage = 3; this.env = 0; } else this.env = shape(this.t, this.kAmp); }
      else this.env = 0;
      // the pitch envelope, from the note's start
      let pe = 0;
      if (this.pt < 1) { this.pt += 1 / (r[IX.p_decay] / 1000 * fs); pe = this.pt < 1 ? shape(this.pt, this.kPitch) : 0; }
      // OSC A at the sound's pitch; OSC B at RATIO times it, DETUNEd, with TRACK of A's pitch envelope (0: B holds still)
      const base = r[IX.a_tune] + r[IX.a_fine] / 100, sweep = r[IX.p_amt] * pe, top = fs * 0.45;
      const hz = Math.min(BASE_HZ * Math.pow(2, (base + sweep) / 12), top);
      let y = 0;
      const la = r[IX.a_level], lb = r[IX.b_level];
      if (la > 0) y += read(this.table, r[IX.a_pos], this.phase, hz, fs) * la;
      this.phase += hz / fs; if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      { // (B's phase always runs, so its level turned up mid-note starts in step)
        const hzB = Math.min(BASE_HZ * Math.pow(2, (base + sweep * r[IX.b_track] + r[IX.b_det] / 100) / 12) * r[IX.b_ratio], top);
        if (lb > 0) y += read(this.table, r[IX.b_pos], this.phaseB, hzB, fs) * lb;
        this.phaseB += hzB / fs; if (this.phaseB >= 1) this.phaseB -= Math.floor(this.phaseB);
      }
      y *= this.env;
      // the key's output: velocity, LEVEL, TRIM, the engine's level and the fade, then an equal-power PAN
      if (this.fadeStep) { this.fade -= this.fadeStep; if (this.fade <= 0) { this.fade = 0; this.on = false; } }
      const amp = y * this.vel * levelGain(o.level) * Math.pow(10, o.trim / 20) * this.gain * this.fade;
      const a = (o.pan + 1) * Math.PI / 4, l = amp * Math.cos(a), rr = amp * Math.sin(a);
      L[i] += l; R[i] += rr; SL[i] += l * o.send; SR[i] += rr * o.send;
      const m = amp < 0 ? -amp : amp; if (m > peak) peak = m;
      if (m < SILENT) { if (++this.quiet > 0.05 * fs && this.stage >= 2) { this.on = false; break; } } else this.quiet = 0;
      if (!this.on) break;
    }
    return peak;
  }
}
