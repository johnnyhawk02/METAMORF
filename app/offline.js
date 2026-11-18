// The page's side of the Worker (sound/render-worker.js): render(params, out, vel, seconds) gives a promise of
// { L, R, peak, length }; builtTable(id) and userTable(id, name, frames) give a promise of the built table (for the
// audio thread). One Worker, started on first use; jobs queue in order.
let worker = null, next = 0;
const waiting = new Map();
function start() {
  worker = new Worker(new URL('../sound/render-worker.js?v=mwm930re', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.no(new Error(e.data.error)); else w.yes(e.data); };
  worker.onerror = (e) => { for (const w of waiting.values()) w.no(new Error(e.message || 'the renderer stopped')); waiting.clear(); worker = null; };
}
const ask = (m, transfer) => { if (!worker) start(); const id = ++next; return new Promise((yes, no) => { waiting.set(id, { yes, no }); worker.postMessage({ id, ...m }, transfer || []); }); };
export const render = (params, out, vel = 100, seconds = 2, fs = 48000) => ask({ type: 'render', params, out, vel, seconds, fs });
export const builtTable = (id) => ask({ type: 'table', table: id }).then((r) => r.table);
export const userTable = (id, name, frames) => ask({ type: 'user', table: id, name, frames }).then((r) => r.table);
