// The Worker beside the page: off the page's thread and off the audio thread.
// - { id, type: 'render', params, out, vel, seconds, fs } -> { id, L, R, peak, length }: a sound rendered offline
//   (the buffers transferred, not copied). The tables it names must be held here (built-ins are built as needed).
// - { id, type: 'table', table } -> { id, table }: a built-in table built (or already held) here, a copy sent back
//   for the audio thread.
// - { id, type: 'user', table, name, frames } -> { id, table }: a user table built from its frames, held here.
import { renderSound } from '../engine/offline.js?v=mwma0hzc';
import { need, holds, hold, table, fromFrames, BUILTIN_IDS } from '../engine/tables.js?v=mwma0hzc';

self.onmessage = (e) => {
  const m = e.data, id = m.id;
  try {
    if (m.type === 'table') { const t = BUILTIN_IDS.includes(m.table) ? need(m.table) : table(m.table); if (!t || t.id !== m.table) throw new Error('no table ' + m.table); self.postMessage({ id, table: t }); return; }
    if (m.type === 'user') { if (!holds(m.table)) hold(fromFrames(m.table, m.name, m.frames)); self.postMessage({ id, table: table(m.table) }); return; }
    for (const k of ['$a', '$b']) if (m.params && BUILTIN_IDS.includes(m.params[k])) need(m.params[k]);
    const r = renderSound(m.params, m.out, m.vel, m.seconds, m.fs);
    self.postMessage({ id, ...r }, [r.L.buffer, r.R.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
