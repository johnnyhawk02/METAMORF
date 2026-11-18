// The page's side of the offline renderer (sound/render-worker.js): render(params, out, vel, seconds) gives a promise
// of { L, R, peak, length }. One Worker, started on first use; renders queue in order.
let worker = null, next = 0;
const waiting = new Map();
function start() {
  worker = new Worker(new URL('../sound/render-worker.js?v=mwm5a0zk', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.no(new Error(e.data.error)); else w.yes(e.data); };
  worker.onerror = (e) => { for (const w of waiting.values()) w.no(new Error(e.message || 'the renderer stopped')); waiting.clear(); worker = null; };
}
export function render(params, out, vel = 100, seconds = 2, fs = 48000) {
  if (!worker) start();
  const id = ++next;
  return new Promise((yes, no) => { waiting.set(id, { yes, no }); worker.postMessage({ id, params, out, vel, seconds, fs }); });
}
