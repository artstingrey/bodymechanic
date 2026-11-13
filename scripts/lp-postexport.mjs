/**
 * Ad landing (task 01a1b325 §6): the landing loads only its static Manrope instances, never the site's variable font.
 * Next 16.4 (Turbopack) collects next/font preloads by route path without route groups, so /(lp)/[locale]/lp/[variant]
 * also gets the preload of the site layout font (/[locale]/layout.tsx: Manrope-s.p.<hash>.woff2) — both as a
 * <link rel="preload"> in the HTML and as an :HL hint row in the RSC payload (inline in index.html and in the *.txt
 * segment files). The landing CSS never uses that file, so the browser would download 30 KB for nothing on a phone.
 * This script removes that one preload from the landing pages only (out/{locale}/lp/**).
 * The leak runs the other way too (RC-6, MO-15): with preload on the landing's static instances (Manrope_400…800) every
 * SITE page got those 4 preloads (~70 KB at high priority) next to its own font — LCP on /ru/ 1520 → 1928 ms, on
 * /ru/booking/ 1408 → 1888 ms; without them 1556 / 1440. So the script also removes the landing instances' preloads from
 * every page outside out/{locale}/lp/**.
 * Either direction: when Next stops leaking, the script finds nothing and says so; anything left after the clean-up fails
 * the build.
 * RC-7 (A): it also WRITES the landing's own font preloads — the 4 static faces with fetchpriority="low", which next/font
 * cannot emit (see LP_PRELOADS below).
 */
// TODO(arch): temporary workaround (lead, 2026-11-07). The proper fix — a landing root layout that Next does not merge with
// /[locale]/layout.tsx for font preloads (route group or otherwise) — is Frontend Builder's call when he takes the LP
// tracking; it must not touch the site. Remove this script (and its step in npm run build) then.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
if (!fs.existsSync(OUT)) { console.error('lp-postexport: out/ not found'); process.exit(1); }

// the site's variable font — «Manrope-s.p.<hash>» with next/font's adjusted fallback, «Manrope.p.<hash>» without it (RC-6:
// adjustFontFallback: false); the landing's static ones are Manrope_<weight>…
const SITE_FILE = String.raw`/_next/static/media/Manrope(?:-s)?\.p\.[A-Za-z0-9_-]+\.woff2`;
// the landing's static instances: «Manrope_<weight>.p.<hash>» (preloaded), «Manrope_<weight>-s…» / «Manrope_<weight>.<hash>»
const LP_FILE = String.raw`/_next/static/media/Manrope_[4-8]00[.-][A-Za-z0-9_.-]*\.woff2`;
// the preload of FILE as a <link> in the HTML and as an :HL hint row of the RSC payload (the hint rows have no row id, so
// dropping «:HL[…]\n» leaves the stream valid)
const preloadOf = (FILE) => [
  new RegExp(String.raw`<link rel="preload" href="${FILE}" as="font"[^>]*/>`, 'g'),
  new RegExp(String.raw`:HL\[\\"${FILE}\\",\\"font\\",\{[^}]*\}\]\\n`, 'g'), // inside self.__next_f.push([1,"…"])
  new RegExp(String.raw`:HL\["${FILE}","font",\{[^}]*\}\]\n`, 'g'), // RSC *.txt rows
];

// guard (lead, RC-6): after the clean-up NO landing file may still preload a Manrope file other than the landing's static
// instances — a renamed site font (next/font changed «Manrope-s.p.» to «Manrope.p.» once already) must fail the build, not
// slip through to the phones as 30 KB of an unused font
const LEFT = /\/_next\/static\/media\/Manrope(?!_[4-8]00[.-])[^"\\\s]*\.woff2/;
// …and (RC-6, mirror) NO site page may still reference a landing instance
const LEFT_SITE = /\/_next\/static\/media\/Manrope_[4-8]00[.-][^"\\\s]*\.woff2/;

// RC-7 (A), lead: the landing preloads its 4 static faces with fetchpriority="low". next/font's own preload (preload: true)
// is high priority and took the line from the hero photo (MO-15 390 /lp/a 680 → 936 ms). Without any preload the faces
// miss the first frame even from the HTTP cache, and optional keeps the fallback for the whole visit (Chromium 390 Android:
// revisits on Manrope 0–1 of 3). Low priority: queued behind the hero photo on a first visit, ready from the cache before
// the first frame on the next ones (3 of 3). next/font cannot set fetchpriority, so the layout keeps preload: false and
// this script writes the 4 <link>s into the landing pages. The files are the ones the landing CSS declares for «manropeLp».
const CHUNKS = path.join(OUT, '_next', 'static', 'chunks');
const LP_FACES = [...new Set(fs.readdirSync(CHUNKS).filter((n) => n.endsWith('.css'))
  .flatMap((n) => [...fs.readFileSync(path.join(CHUNKS, n), 'utf8').matchAll(/@font-face\{font-family:manropeLp;src:url\(\.\.\/media\/([^)]+\.woff2)\)/g)].map((m) => m[1])))].sort();
if (LP_FACES.length !== 4 || new Set(LP_FACES.map((n) => n.slice(0, 11))).size !== 4 || !LP_FACES.every((n) => /^Manrope_[4-8]00[.-]/.test(n))) {
  console.error(`lp-postexport: expected the 4 static «manropeLp» faces (400/600/700/800) in the CSS, found: ${LP_FACES.join(', ') || 'none'}`);
  process.exit(1);
}
const LP_PRELOADS = LP_FACES.map((n) => `<link rel="preload" href="/_next/static/media/${n}" as="font" crossorigin="" type="font/woff2" fetchPriority="low"/>`).join('');
const VIEWPORT = /<meta name="viewport"[^>]*\/>/;
const LP_FONT_LINK = /<link rel="preload" href="\/_next\/static\/media\/Manrope_[4-8]00[^"]*\.woff2"[^>]*\/>/g;
let injected = 0;
const badInject = [];

const isLp = (rel) => /^[^/\\]+[/\\]lp([/\\]|$)/.test(rel); // out/{locale}/lp/**
const tally = { lp: { files: 0, removed: 0, left: [] }, site: { files: 0, removed: 0, left: [] } };
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(OUT, p);
    if (e.isDirectory()) { if (rel !== '_next') walk(p); continue; }
    if (!/\.(html|txt)$/.test(e.name)) continue;
    const lp = isLp(rel), t = lp ? tally.lp : tally.site;
    const src = fs.readFileSync(p, 'utf8');
    let n = 0, out = src;
    for (const rx of preloadOf(lp ? SITE_FILE : LP_FILE)) out = out.replace(rx, () => (n++, ''));
    if (n) { t.files++; t.removed += n; }
    if (lp && e.name.endsWith('.html')) {
      // (A): exactly the 4 low-priority preloads, after the viewport meta (idempotent: a re-run replaces them)
      out = out.replace(LP_FONT_LINK, '');
      if (VIEWPORT.test(out)) { out = out.replace(VIEWPORT, (m) => m + LP_PRELOADS); injected++; } else badInject.push(`${rel}: no viewport meta`);
      const links = out.match(LP_FONT_LINK) || [];
      if (links.length !== 4 || !links.every((l) => l.includes('fetchPriority="low"'))) badInject.push(`${rel}: ${links.length} font preload(s)`);
    }
    if (out !== src) fs.writeFileSync(p, out);
    const m = out.match(lp ? LEFT : LEFT_SITE);
    if (m) t.left.push(`${rel}: ${m[0]}`);
  }
}
walk(OUT);
console.log(tally.lp.removed ? `lp-postexport: removed ${tally.lp.removed} preload(s) of the site variable font in ${tally.lp.files} landing file(s)` : 'lp-postexport: nothing to remove on the landing (Next no longer leaks the site font preload)');
console.log(tally.site.removed ? `lp-postexport: removed ${tally.site.removed} preload(s) of the landing's static fonts in ${tally.site.files} site file(s)` : "lp-postexport: nothing to remove on the site (Next no longer leaks the landing's font preloads)");
console.log(`lp-postexport: ${injected} landing page(s) preload the 4 static faces with fetchpriority="low" (${LP_FACES.join(', ')})`);
let fail = false;
if (!injected || badInject.length) {
  console.error(`lp-postexport: the landing font preloads are wrong:\n  ${badInject.slice(0, 10).join('\n  ') || 'no landing page found'}`);
  fail = true;
}
if (tally.lp.left.length) {
  console.error(`lp-postexport: ${tally.lp.left.length} landing file(s) still reference a Manrope file that is not a landing instance:\n  ${tally.lp.left.slice(0, 10).join('\n  ')}`);
  fail = true;
}
if (tally.site.left.length) {
  console.error(`lp-postexport: ${tally.site.left.length} site file(s) still reference a landing font instance:\n  ${tally.site.left.slice(0, 10).join('\n  ')}`);
  fail = true;
}
if (fail) process.exit(1);
