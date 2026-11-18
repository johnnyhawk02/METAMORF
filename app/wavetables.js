// The page's wavetables: the built-in list, the user's own (kept in IndexedDB, app/store.js), and getting the tables
// the sounds name to the audio thread. A table is built in the Worker beside the page (app/offline.js), never on the
// page's thread or the audio thread, and sent on once; until it arrives a note plays BASIC.
import { BUILTINS, BUILTIN_IDS, DEFAULT_TABLE } from '../engine/tables.js?v=mwm889or';
import { builtTable, userTable } from './offline.js?v=mwm889or';
import { allTables, putTable, deleteTable } from './store.js?v=mwm889or';
import { FRAME, framesFrom, hashFrames } from './wav.js?v=mwm889or';

export { DEFAULT_TABLE, BUILTIN_IDS };
const NAMES = new Map(BUILTINS.map((b) => [b[0], b[1]]));
const users = new Map(); // id -> { id, name, count, frames: Float32Array (count * FRAME) }
let storeOk = true;

/** the user tables kept in this browser, read once at start-up */
export async function loadUsers() {
  try { for (const r of await allTables()) if (r && /^user:[0-9a-f]{16}$/.test(r.id) && r.frames instanceof Float32Array) users.set(r.id, r); } catch (e) { storeOk = false; }
  return users.size;
}
export const userList = () => [...users.values()];
export const user = (id) => users.get(id);
/** every table a knob can pick, built-ins first */
export const tableIds = () => [...BUILTIN_IDS, ...users.keys()];
export const known = (id) => NAMES.has(id) || users.has(id);
export const tableName = (id) => NAMES.get(id) || users.get(id)?.name || 'MISSING';
export const isUser = (id) => typeof id === 'string' && id.startsWith('user:');
export const validId = (id) => typeof id === 'string' && (NAMES.has(id) || /^user:[0-9a-f]{16}$/.test(id));

// ---- the audio thread: each table sent once (BASIC it builds itself) ----
let post = null, sent = new Set(), onArrive = () => {};
/** a new audio thread: nothing sent to it yet */
export function attach(postFn, arrived) { post = postFn; sent = new Set([DEFAULT_TABLE]); if (arrived) onArrive = arrived; }
/** the tables named get to the audio thread (and the Worker, for renders); missing ones are skipped */
export function ensure(ids) {
  if (!post) return; // (no audio yet: startAudio sends them all)
  for (const id of new Set(ids)) {
    if (!id || sent.has(id) || !known(id)) continue;
    sent.add(id);
    const u = users.get(id);
    const job = u ? userTable(id, u.name, split(u)) : builtTable(id);
    job.then((t) => { if (post && sent.has(id)) { post({ type: 'table', table: t }); onArrive(id); } }).catch(() => sent.delete(id));
  }
}
/** the user tables named, to the Worker (for an offline render); built-ins it builds itself */
export const forRender = (ids) => Promise.all([...new Set(ids)].filter((id) => users.has(id)).map((id) => { const u = users.get(id); return userTable(id, u.name, split(u)); }));
const split = (u) => Array.from({ length: u.count }, (_, f) => u.frames.slice(f * FRAME, (f + 1) * FRAME));

// ---- a WAV file in: decoded, cut into frames, kept ----
/** frames from decoded samples at a frame size (0: the whole file is one cycle), named, kept; -> { rec, isNew } */
export async function keepWav(w, size, fileName) {
  const frames = framesFrom(w.samples, size);
  const id = 'user:' + hashFrames(frames);
  if (users.has(id)) return { rec: users.get(id), isNew: false };
  const flat = new Float32Array(frames.length * FRAME); frames.forEach((f, i) => flat.set(f, i * FRAME));
  const rec = { id, name: tableNameFrom(fileName), count: frames.length, frames: flat };
  users.set(id, rec);
  try { await putTable(rec); } catch (e) { storeOk = false; }
  return { rec, isNew: true, kept: storeOk };
}
export const tableNameFrom = (file) => String(file || '').replace(/\.[^.]*$/, '').toUpperCase().replace(/[^A-Z0-9 .+#-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 18) || 'MY TABLE';
export async function removeUser(id) {
  users.delete(id); sent.delete(id);
  if (post) post({ type: 'drop', id });
  try { await deleteTable(id); } catch (e) { /* gone already */ }
}

// ---- in a preset file: { id: { name, count, data: base64 of the float frames } } ----
export function embed(ids) {
  const o = {};
  for (const id of new Set(ids)) { const u = users.get(id); if (u) o[id] = { name: u.name, count: u.count, data: b64(u.frames) }; }
  return o;
}
/** tables from a file, kept here if new; -> how many were new */
export async function adopt(tables) {
  let added = 0;
  if (!tables || typeof tables !== 'object') return 0;
  for (const [id, t] of Object.entries(tables)) {
    if (!/^user:[0-9a-f]{16}$/.test(id) || users.has(id) || !t || typeof t.data !== 'string') continue;
    const count = Math.min(256, t.count | 0);
    let frames; try { frames = unb64(t.data); } catch (e) { continue; }
    if (count < 1 || frames.length !== count * FRAME || !frames.every(Number.isFinite)) continue;
    const rec = { id, name: tableNameFrom(t.name), count, frames };
    users.set(id, rec); added++;
    try { await putTable(rec); } catch (e) { storeOk = false; }
  }
  return added;
}
function b64(f) {
  const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); if (u.length % 4) throw new Error('bad'); return new Float32Array(u.buffer); }
export const kept = () => storeOk;
