// IndexedDB for what is too big for localStorage: the user wavetables (build step 3), later the library and the bins.
// A user table is kept as { id, name, count, frames: Float32Array of count * FRAME }.
const DB = 'metamorf', VERSION = 1;
let opening = null;
function open() {
  return (opening ||= new Promise((yes, no) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('tables')) db.createObjectStore('tables', { keyPath: 'id' }); };
    r.onsuccess = () => yes(r.result); r.onerror = () => { opening = null; no(r.error); };
  }));
}
const tx = async (store, mode, fn) => { const db = await open(); return new Promise((yes, no) => { const t = db.transaction(store, mode), s = t.objectStore(store), r = fn(s); t.oncomplete = () => yes(r && r.result); t.onerror = () => no(t.error); }); };
export const allTables = () => tx('tables', 'readonly', (s) => s.getAll()).then((x) => x || []);
export const getTable = (id) => tx('tables', 'readonly', (s) => s.get(id));
export const putTable = (rec) => tx('tables', 'readwrite', (s) => s.put(rec));
export const deleteTable = (id) => tx('tables', 'readwrite', (s) => s.delete(id));
