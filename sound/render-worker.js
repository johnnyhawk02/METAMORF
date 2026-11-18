// The offline renderer in a Worker, off the page's thread: a message { id, params, out, vel, seconds, fs } comes back
// as { id, L, R, peak, length } (the buffers transferred, not copied).
import { renderSound } from '../engine/offline.js?v=mwm61gqf';

self.onmessage = (e) => {
  const { id, params, out, vel, seconds, fs } = e.data;
  try {
    const r = renderSound(params, out, vel, seconds, fs);
    self.postMessage({ id, ...r }, [r.L.buffer, r.R.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
