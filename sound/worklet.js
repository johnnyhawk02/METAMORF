// The audio thread: the instrument (engine/instrument.js) in an AudioWorklet. The page sends it notes and settings
// as messages; it sends back the engines' peaks and the distortion's sidechain envelope for the meters.
import { Instrument } from '../engine/instrument.js?v=mwm5a0zk';

class Metamorf extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inst = new Instrument(sampleRate);
    this.tick = 0;
    this.port.onmessage = (e) => this.on(e.data);
  }
  on(m) {
    const I = this.inst;
    if (m.type === 'play') I.play(m.e, m.params, m.out, m.vel);
    else if (m.type === 'back') I.back(m.e, m.params, m.out, m.vel);
    else if (m.type === 'release') I.release(m.e);
    else if (m.type === 'update') I.update(m.e, m.params, m.out);
    else if (m.type === 'fx') I.setFx(m.fx);
    else if (m.type === 'engines') I.setEngines(m.n);
    else if (m.type === 'egain') m.gains.forEach((g, e) => I.setEngineGain(e, g));
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    this.inst.render(L, R);
    if (out.length > 2) for (let c = 2; c < out.length; c++) out[c].fill(0);
    if (++this.tick >= 12) { this.tick = 0; this.port.postMessage({ type: 'peaks', peaks: this.inst.readPeaks(), sc: this.inst.readSc() }); }
    return true;
  }
}
registerProcessor('metamorf', Metamorf);
