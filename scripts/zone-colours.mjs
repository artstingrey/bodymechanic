/**
 * Records the 4-colouring of the zones (highlight dividers, N-05) for every model URL in src/lib/body3d/assets.json, so the
 * runtime reads a table instead of computing it after each load (≈ 1 s of main thread on a phone — R-FINAL, /booking TBT).
 * The colouring is deterministic (seeded); a model without an entry still works — it computes in idle.
 * Rerun when the models change (same rule as poster-anchors):
 *   npm run build && node scripts/serve-out.mjs 4173  (other terminal)  →  node scripts/zone-colours.mjs [baseURL]
 * Writes src/lib/body3d/zone-colours.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const assets = JSON.parse(fs.readFileSync(path.join(APP, 'src', 'lib', 'body3d', 'assets.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', args: process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu'] : [] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'script' })));
await page.goto(`${BASE}/en/booking/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__bm3d?.zoneColours, null, { timeout: 60_000 });

const out = {}; // data only: the file is bundled into the public build (how it is made: the header above)
for (const gender of ['male', 'female']) {
  for (const lod of ['lod0', 'lod1']) {
    const url = assets.models[gender][lod];
    out[url.split('/').pop()] = await page.evaluate(([g, u]) => window.__bm3d.zoneColours(g, u), [gender, url]);
    console.log(gender, lod, url);
  }
}
fs.writeFileSync(path.join(APP, 'src', 'lib', 'body3d', 'zone-colours.json'), JSON.stringify(out, null, 0).replace(/\],/g, '],\n'));
console.log('zone-colours.json written');
await browser.close();
