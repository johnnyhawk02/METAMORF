// node test/names-clean.test.mjs: METAMORF is a new work, so none of the old product's or its sources' names may appear
// anywhere in the repo (code, comments, captions, storage keys, file names), except in docs/SPEC.md, which tells the
// story. The same search as: grep -riE 'l.r|a.x|eli.ir|eri.a' (the pattern is built from pieces so this file passes).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const BAD = new RegExp(['l' + 'xr', 'a' + 'fx', 'eli' + 'xir', 'er' + 'ica'].join('|'), 'i');
const SKIP = new Set(['.git', 'node_modules', 'shots']), ALLOW = new Set(['docs/SPEC.md']);
const found = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name), rel = relative(root, path);
    if (BAD.test(name)) found.push(`${rel}: the file's name`);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (ALLOW.has(rel)) continue;
    const text = readFileSync(path, 'latin1');
    text.split('\n').forEach((line, i) => { if (BAD.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
})(root);
for (const f of found) console.log('FAIL', f);
console.log(found.length ? `${found.length} old names found` : 'ok: no old names anywhere');
process.exit(found.length ? 1 : 0);
