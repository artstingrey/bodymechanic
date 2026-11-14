/**
 * Measures the zone anchors on the hero POSTERS (front view) for the hero fallback (usePosterAnchors):
 * opens the live hero with the real 3D runtime, reads the front-view rest anchors (restX / restY / restVisible) and converts
 * them to fractions of the poster image placed with object-fit: contain in the same slot (the posters are the front view
 * of the same framing — spike: silhouette on the poster = first 3D frame within 1–2 px).
 * One set per LOD (lib/body3d/lod: LOD1's front-view anchors differ from LOD0's): «male», «female» = LOD0, «male@lod1»,
 * «female@lod1» = LOD1 (measured on the same 1280×800 window with navigator.deviceMemory = 2 — the fractions do not depend on
 * the window, RC-5 probe: 320–1280 within 0.1 % of the poster height).
 * Rerun when the posters, the models or the camera framing change:
 *   npm run build && npm run start -- --port 4173  (other terminal)  →  node scripts/poster-anchors.mjs [baseURL]
 * Writes src/lib/body3d/poster-anchors.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'chrome', args: process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu'] : [] });

const out = {}; // data only: the file is bundled into the public build (how it is made: the header above)
for (const lod of ['lod0', 'lod1']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'script' })));
  if (lod === 'lod1') await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2, configurable: true }));
  const page = await ctx.newPage();
  for (const model of ['male', 'female']) {
    const key = lod === 'lod0' ? model : `${model}@${lod}`;
    await page.goto(`${BASE}/en/`, { waitUntil: 'networkidle' });
    if (model === 'female') await page.locator('.b3d-switch button').nth(1).click();
    await page.waitForFunction((m) => window.__bm3d?.model() === m && document.querySelector('.b3d-slot')?.dataset.status === 'ready', model, { timeout: 60_000 });
    const url = await page.evaluate((m) => window.__bm3d.url(m), model);
    if (lod === 'lod1' !== url.includes('.lod1.')) throw new Error(`${key}: the page loaded ${url}`);
    await page.waitForFunction(() => !!window.__bm3d?.anchors);
    await page.evaluate(() => window.__bm3d.anchors.watch());
    // the runtime's OWN anchors (since RC-5 the poster publishes them while the model loads: source 'poster')
    await page.waitForFunction(() => { const a = window.__bm3d.anchors.get(); return a.source !== 'poster' && a.zones.length > 25; });
    await page.waitForTimeout(800); // a few frames after a model switch
    out[key] = await page.evaluate(() => {
      const slot = document.querySelector('.b3d-slot'), img = slot.querySelector('.b3d-poster img');
      const sr = slot.getBoundingClientRect(), ir = img.getBoundingClientRect();
      const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(ir.width / W, ir.height / H), w = W * k, h = H * k;
      const ox = ir.left - sr.left + (ir.width - w) / 2, oy = ir.top - sr.top + (ir.height - h) / 2;
      const zones = {};
      for (const a of window.__bm3d.anchors.get().zones) zones[a.zoneId] = { u: +((a.restX - ox) / w).toFixed(4), v: +((a.restY - oy) / h).toFixed(4), visible: a.restVisible };
      return { width: W, height: H, zones };
    });
    console.log(key, url.split('/').pop(), Object.keys(out[key].zones).length, 'zones');
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(APP, 'src', 'lib', 'body3d', 'poster-anchors.json'), JSON.stringify(out, null, 1));
console.log('poster-anchors.json written');
