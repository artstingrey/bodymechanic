/**
 * Header lockups with their own light plate (R-FINAL-2 D-06, DEV-07). A browser that force-darkens the page (Samsung Internet,
 * Chromium auto dark) darkens the header but leaves an <img> as it is: the carbon mark vanished on the dark header, only the
 * copper accent stayed. Measured in Chromium (--enable-features=WebContentsForceDark): an inline SVG with currentColor or with
 * explicit fills stays dark too, and a CSS plate behind the image is darkened with the page. A plate inside the image keeps the
 * contrast whether the browser leaves the image alone or inverts it.
 *
 * Writes public/brand/<lockup>-plate.svg next to the brand-kit copies (sync-assets step 6 calls this; also runnable alone:
 * `node scripts/brand-plate.mjs`). The plate is the header background (tokens.css --bg), so it is invisible on the normal light
 * page; it adds P viewBox units on every side, and .site-logo (layout.css) takes the same amount back with a negative margin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATE = '#F7F4F0'; // tokens.css --bg
/** [lockup, padding P, corner radius R] in viewBox units; layout.css mirrors P / viewBox height in --logo-pad.
 *  Horizontal: P = 64/9, so at its 36 px height the plate adds exactly 4 px (whole pixels on 1x desktop screens). */
export const PLATES = [['bm-lockup-horizontal-color', +(64 / 9).toFixed(4), 12], ['bm-lockup-compact-nano-color', 6, 8]];

export function brandPlates(dir) {
  for (const [f, P, R] of PLATES) {
    const src = path.join(dir, `${f}.svg`);
    if (!fs.existsSync(src)) continue;
    const svg = fs.readFileSync(src, 'utf8');
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (!m) throw new Error(`brand-plate: ${f}.svg has no 0-based viewBox`);
    const [w, h] = [Number(m[1]) + 2 * P, Number(m[2]) + 2 * P].map((v) => +v.toFixed(2));
    const rect = `<rect x="${-P}" y="${-P}" width="${w}" height="${h}" rx="${R}" fill="${PLATE}"/>`;
    const at = svg.indexOf('</desc>') >= 0 ? svg.indexOf('</desc>') + '</desc>'.length : svg.indexOf('>', svg.indexOf('<svg')) + 1;
    const out = (svg.slice(0, at) + rect + svg.slice(at))
      .replace(m[0], `viewBox="${-P} ${-P} ${w} ${h}"`)
      .replace('</desc>', ' (header copy with a light plate for force-dark browsers)</desc>');
    fs.writeFileSync(path.join(dir, `${f}-plate.svg`), out);
    console.log(`   brand plate: ${f}-plate.svg (viewBox ${-P} ${-P} ${w} ${h})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  brandPlates(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand'));
}
