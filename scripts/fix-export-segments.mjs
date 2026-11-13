/**
 * Workaround for a Windows-only bug in Next 16.4 static export (next/dist/export/index.js, collectSegmentPaths):
 * segment prefetch files are collected with path.relative() → backslashes on Windows, and
 * convertSegmentPathToStaticExportFilename() only replaces "/" with ".". Result on Windows:
 *   out/en/team/__next.$d$locale/team/__PAGE__.txt          (nested dirs)
 * while the client router requests (and Linux builds produce):
 *   out/en/team/__next.$d$locale.team.__PAGE__.txt          (flat file)
 * This script flattens the Windows output to the Linux layout. On Linux/macOS (e.g. the Render build) it is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
if (process.platform !== 'win32') process.exit(0);
if (!fs.existsSync(OUT)) { console.error('fix-export-segments: out/ not found'); process.exit(1); }

let moved = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('__next.')) { flatten(p, dir, e.name); continue; }
    if (e.name !== '_next') walk(p);
  }
}
function flatten(segDir, parent, prefix) {
  const files = [];
  const collect = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}.${e.name}` : e.name; if (e.isDirectory()) collect(path.join(d, e.name), r); else files.push([path.join(d, e.name), r]); } };
  collect(segDir, '');
  for (const [src, rel] of files) { fs.copyFileSync(src, path.join(parent, `${prefix}.${rel}`)); moved++; }
  fs.rmSync(segDir, { recursive: true, force: true });
}
walk(OUT);
console.log(`fix-export-segments: flattened ${moved} segment files (Windows build)`);
