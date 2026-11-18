// node tools/serve.mjs [port]: the page on http://localhost:8123/ for the page tests (no build step: the files as they are)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = new URL('..', import.meta.url).pathname, port = Number(process.argv[2]) || 8123;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav' };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const body = await readFile(join(root, path.endsWith('/') ? path + 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body); }
  catch (e) { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log(`serving on http://localhost:${port}/`));
