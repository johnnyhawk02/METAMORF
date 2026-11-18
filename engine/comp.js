// The master compressor: feed-forward, soft knee, both sides detected together (the louder of the two), in the
// textbook form: the level in dB, a static curve with a quadratic knee, then the gain reduction smoothed with separate
// attack and release (branching, in dB), then the gain applied smoothly. THRESHOLD 0 is off: the reduction then
// releases to nothing and MAKEUP glides away, so switching it on or off never clicks.
//
// Settings (as stored, whole numbers): thresh 0..40 (dB below 0; 0 off), ratio 10..200 (tenths: 1:1 .. 20:1),
// attack 1..100 ms, release 10..1000 ms, knee 0..24 dB, makeup 0..24 dB.
export const COMP_DEFAULTS = { thresh: 0, ratio: 40, attack: 10, release: 150, knee: 6, makeup: 0 };

/** the static curve: gain reduction (dB, >= 0) for a level x (dB) */
export function reduction(x, T, R, W) {
  const over = x - T;
  if (W > 0 && 2 * Math.abs(over) <= W) return (1 - 1 / R) * (over + W / 2) * (over + W / 2) / (2 * W);
  return over > 0 ? over * (1 - 1 / R) : 0;
}

export class Comp {
  constructor(fs) { this.fs = fs; this.s = { ...COMP_DEFAULTS }; this.gr = 0; this.make = 0; this.gain = 1; this.meter = 0; this.gG = 1 - Math.exp(-1 / (0.002 * fs)); this.gM = 1 - Math.exp(-1 / (0.05 * fs)); }
  set(s) { Object.assign(this.s, s); }
  get on() { return this.s.thresh > 0; }
  process(L, R, n) {
    const s = this.s, fs = this.fs, on = this.on;
    if (!on && this.gr < 1e-4 && this.make < 1e-4) { this.gr = 0; this.make = 0; this.gain = 1; return; } // (off and settled: nothing to do)
    const T = -Math.max(0, Math.min(40, s.thresh)), Rt = Math.max(1, Math.min(20, s.ratio / 10)), W = Math.max(0, Math.min(24, s.knee));
    const aA = Math.exp(-1 / (Math.max(1, s.attack) / 1000 * fs)), aR = Math.exp(-1 / (Math.max(10, s.release) / 1000 * fs));
    const mT = on ? Math.max(0, Math.min(24, s.makeup)) : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i])), x = a > 1e-6 ? 20 * Math.log10(a) : -120;
      const want = on ? reduction(x, T, Rt, W) : 0;
      this.gr = want > this.gr ? aA * this.gr + (1 - aA) * want : aR * this.gr + (1 - aR) * want;
      this.make += (mT - this.make) * this.gM;
      const g = Math.pow(10, (this.make - this.gr) / 20);
      this.gain += (g - this.gain) * this.gG; // (a last short glide: no zipper on the fastest attack)
      L[i] *= this.gain; R[i] *= this.gain;
      if (this.gr > this.meter) this.meter = this.gr;
    }
  }
  /** the most gain reduction since the last call, in dB */
  readGr() { const m = this.meter; this.meter = 0; return m; }
}
