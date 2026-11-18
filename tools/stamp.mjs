// node tools/stamp.mjs: a new version stamp (?v=...) on every app module and stylesheet URL, so a browser holding older
// files in its cache (GitHub Pages caches for 10 minutes) loads the whole new set together, never a mix of old and new.
// Run it before each commit that changes the page. It stamps index.html and every module the page loads (app/,
// sound/, engine/).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const v = Date.now().toString(36);
const files = ['index.html', ...['app', 'sound', 'engine'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`))];
for (const f of files) {
  const s = readFileSync(f, 'utf8'), t = s.replace(/\?v=[0-9a-z]+/g, '?v=' + v);
  if (t !== s) writeFileSync(f, t);
}
console.log('stamped', v);
