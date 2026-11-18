// The instrument: 1 to 4 mono engines, then the master (the distortion, the output level and a safety limiter).
// Pure JS: render(L, R) fills float buffers at any rate, in the AudioWorklet, a Worker or node.
//
// Each engine plays one note at a time: a new note fades the old one out over 3 ms while it starts. A note coming back
// (RETURN: the zone going back to an earlier held key) starts on the next step of the BPM grid. The reverb send is
// collected per engine already; the reverb itself and the compressor come in build step 8.
import { Voice } from './voice.js?v=mwm79h1i';
import { Dirt, DIRT_DEFAULTS } from '../sound/dirt.js?v=mwm79h1i';

export const MASTER_DEFAULTS = { level: 80 };
export const TEMPO_DEFAULTS = { bpm: 120, ret: 2 };
export const FX_DEFAULTS = { dirt: { ...DIRT_DEFAULTS }, master: { ...MASTER_DEFAULTS }, tempo: { ...TEMPO_DEFAULTS } };
// RETURN's steps, in beats: NOW, 1/32, 1/16, 1/8, 1/4
export const RETURN_BEATS = [0, 0.125, 0.25, 0.5, 1];
export const masterGain = (v) => (v / 80) * (v / 80); // OUTPUT LEVEL 80% is unity
// the safety limiter: untouched below 0.9, then a smooth bend that never passes 1
const limit = (x) => { const a = x < 0 ? -x : x; if (a <= 0.9) return x; const y = 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1); return x < 0 ? -y : y; };

class Engine {
  constructor(fs) { this.v = [new Voice(fs), new Voice(fs)]; this.cur = 0; this.pending = null; this.gain = 1; this.peak = 0; }
  get voice() { return this.v[this.cur]; }
}

export class Instrument {
  constructor(fs, block = 128) {
    this.fs = fs; this.n = 4; this.clock = 0;
    this.eng = [0, 1, 2, 3].map(() => new Engine(fs));
    this.dirt = new Dirt(fs);
    this.fx = JSON.parse(JSON.stringify(FX_DEFAULTS)); // (structuredClone is not there on the audio thread)
    this.gain = masterGain(this.fx.master.level); this.glide = 1 - Math.exp(-1 / (0.01 * fs));
    this.alloc(block);
  }
  alloc(n) {
    this.size = n;
    this.EL = this.eng.map(() => new Float32Array(n)); this.ER = this.eng.map(() => new Float32Array(n));
    this.SL = new Float32Array(n); this.SR = new Float32Array(n);
  }
  setEngines(n) { this.n = Math.max(1, Math.min(4, n | 0)); for (let e = this.n; e < 4; e++) { for (const v of this.eng[e].v) v.fadeOut(this.fs * 0.003); this.eng[e].pending = null; } }
  setEngineGain(e, g) { this.eng[e].gain = g; }
  /** a note on engine e now: params (normalised, by id), out (level, pan, send, trim), velocity 1..127 */
  play(e, params, out, vel) {
    const E = this.eng[e]; if (!E || e >= this.n) return;
    E.pending = null;
    E.voice.fadeOut(Math.round(this.fs * 0.003));
    E.cur ^= 1; E.voice.start(params, out, vel, E.gain);
  }
  /** a note coming back to engine e: on the next step of the BPM grid (RETURN), or now */
  back(e, params, out, vel) {
    const beats = RETURN_BEATS[this.fx.tempo.ret] || 0;
    if (!beats) { this.play(e, params, out, vel); return; }
    const step = this.fs * 60 / this.fx.tempo.bpm * beats;
    this.eng[e].pending = { params, out, vel, at: Math.ceil((this.clock + 1) / step) * step };
  }
  /** every key of engine e let go: a note waiting to come back doesn't (the one ringing rings out) */
  release(e) { if (this.eng[e]) this.eng[e].pending = null; }
  /** the sound on engine e changed while it rings (a knob, a CC): glide to it */
  update(e, params, out) {
    const E = this.eng[e]; if (!E) return;
    if (E.voice.on) E.voice.set(params, out);
    if (E.pending) { if (params) E.pending.params = { ...E.pending.params, ...params }; if (out) E.pending.out = { ...E.pending.out, ...out }; }
  }
  setFx(fx) {
    for (const k in fx) if (this.fx[k] && fx[k]) Object.assign(this.fx[k], fx[k]);
    this.dirt.set(this.fx.dirt);
  }
  /** fill L and R (zeroed here) with the next block; returns nothing, peaks are in eng[e].peak */
  render(L, R) {
    const n = L.length; if (n > this.size) this.alloc(n);
    L.fill(0); R.fill(0); this.SL.fill(0, 0, n); this.SR.fill(0, 0, n);
    for (let e = 0; e < 4; e++) {
      const E = this.eng[e], EL = this.EL[e], ER = this.ER[e]; EL.fill(0, 0, n); ER.fill(0, 0, n);
      let from = 0, pk = 0;
      if (E.pending && E.pending.at < this.clock + n) { // a returning note starts inside this block
        from = Math.max(0, Math.floor(E.pending.at - this.clock));
        for (const v of E.v) pk = Math.max(pk, v.render(EL, ER, this.SL, this.SR, 0, from));
        const p = E.pending; this.play(e, p.params, p.out, p.vel);
      }
      for (const v of E.v) pk = Math.max(pk, v.render(EL, ER, this.SL, this.SR, from, n));
      E.peak = Math.max(E.peak, pk);
      for (let i = 0; i < n; i++) { L[i] += EL[i]; R[i] += ER[i]; }
    }
    // the master: the distortion (its sidechain hears the mix, or one engine), the output level, the limiter
    if (this.dirt.active) { const src = this.fx.dirt.src | 0; this.dirt.process(L.subarray(0, n), R.subarray(0, n), src > 0 ? this.EL[src - 1].subarray(0, n) : null); }
    const to = masterGain(this.fx.master.level), g = this.glide;
    for (let i = 0; i < n; i++) { this.gain += (to - this.gain) * g; L[i] = limit(L[i] * this.gain); R[i] = limit(R[i] * this.gain); }
    this.clock += n;
  }
  /** the engines' peaks since the last call */
  readPeaks() { return this.eng.map((E) => { const p = E.peak; E.peak = 0; return p; }); }
  readSc() { return this.dirt.readEnv(); }
}
