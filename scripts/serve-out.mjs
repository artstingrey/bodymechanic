/**
 * Local static server for out/ that mirrors the Render static-site rules (docs/CONFIG-DEPLOY.md):
 *  - directory URLs serve index.html (trailingSlash export) — with or without the trailing slash;
 *  - rewrite /{ru|en}/account/record/<anything> → /{locale}/account/record/index.html (record-by-link page, PG-13);
 *  - unknown paths → 404 status with out/404.html (Render serves /404.html for missing paths);
 *  - Cache-Control: immutable only for hashed assets (/_next/static/*, /models/*), no-cache for HTML.
 *  - every response says WHICH out/ it serves (X-Served-Out): the gate refuses another worktree's server (e2e/global-setup).
 * Usage: node scripts/serve-out.mjs [port]   (default: this worktree's gate port, scripts/gate-port.cjs)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gp from './gate-port.cjs';
const { gatePort } = gp;

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const PORT = Number(process.argv[2] || process.env.PORT || gatePort());
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };

function cacheHeader(urlPath, file) {
  if (urlPath.startsWith('/_next/static/') || urlPath.startsWith('/models/')) return 'public, max-age=31536000, immutable';
  if (file.endsWith('.html') || file.endsWith('.txt')) return 'no-cache';
  return 'public, max-age=86400';
}

function resolve(urlPath) {
  // security review Ж-6: a malformed escape («/%») is a 404, not a crash of the server; and the file must be INSIDE out/ —
  // a plain prefix check also let a sibling folder through («out-old» starts with «out»)
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const safe = path.normalize(decoded).replace(/^([/\\])+/, '');
  let f = path.join(OUT, safe);
  if (f !== OUT && !f.startsWith(OUT + path.sep)) return null;
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  const rec = urlPath.match(/^\/(ru|en)\/account\/record\/.+/); // Render rewrite rule
  if (rec) return path.join(OUT, rec[1], 'account', 'record', 'index.html');
  return null;
}

http.createServer((req, res) => {
  // «//…» is not a path new URL() can resolve against a base — it throws; answer 400 instead of dying (security review Ж-6)
  let urlPath;
  try { urlPath = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Bad request'); }
  const file = resolve(urlPath);
  const send = (status, f) => {
    res.writeHead(status, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Content-Length': fs.statSync(f).size, 'Cache-Control': cacheHeader(urlPath, f), 'X-Served-Out': encodeURIComponent(OUT) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  };
  if (file) return send(200, file);
  return send(404, path.join(OUT, '404.html'));
}).listen(PORT, () => console.log(`serving ${OUT} on http://localhost:${PORT}`));
