/**
 * i18n gate: every static message key used in src/ exists in messages/en.json AND messages/ru.json as a LEAF
 * (t('a.b') on an object node is a runtime error; t.raw / t.has may point at a node), and both files have the same keys.
 * Visible strings must come only from messages (README §9–10).
 * Understands: const t = useTranslations('ns') | useTranslations() | await getTranslations({ locale, namespace: 'ns' }),
 * then t('key'), t.rich('key'), t.markup('key'), t.raw('key'), t.has('key'). Template-literal keys are only listed
 * (--dynamic); they are covered at runtime by the Playwright gate (next-intl reports missing messages as console errors).
 * Also: messages/* equal the copy deck site/copy (keys and texts, scripts/copy-drift.mjs).
 * Usage: node scripts/check-i18n.mjs [--dynamic]   (exit 1 on problems)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDrift } from './copy-drift.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8'));
const leaves = (o, p = '', out = new Set()) => {
  for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object') leaves(v, key, out); else out.add(key); }
  return out;
};
const keys = { en: leaves(load('en')), ru: leaves(load('ru')) };
const isNode = (l, k) => [...keys[l]].some((x) => x.startsWith(`${k}.`));

const problems = [];
for (const [a, b] of [['en', 'ru'], ['ru', 'en']]) for (const k of keys[a]) if (!keys[b].has(k)) problems.push(`only in ${a}.json: ${k}`);

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|mjs)$/.test(e.name)) files.push(p); } };
walk(path.join(ROOT, 'src'));

const DECL = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']*)'|"([^"]*)"|\{[^}]*namespace:\s*'([^']*)'[^}]*\}|\{[^}]*\}|)\s*\)/g;
const BT = '`';
let used = 0;
const dynamic = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  const ns = new Map(); // var → namespaces (a file may declare `t` more than once, e.g. generateMetadata + page)
  for (const m of src.matchAll(DECL)) ns.set(m[1], [...(ns.get(m[1]) ?? []), m[2] ?? m[3] ?? m[4] ?? '']);
  for (const [v, nss] of ns) {
    // groups: 1 = .method, 2 = 'key', 3 = "key", 4 = `template`
    const call = new RegExp(String.raw`\b${v}(\.(?:rich|markup|raw|has))?\(\s*(?:'([^']+)'|"([^"]+)"|(${BT}[^${BT}]*${BT}))`, 'g');
    for (const m of src.matchAll(call)) {
      if (m[4]) { dynamic.push(`${rel}: ${m[4]}`); continue; }
      const key = m[2] ?? m[3];
      const cands = [...new Set(nss)].map((n) => (n ? `${n}.${key}` : key));
      const nodeOk = m[1] === '.raw' || m[1] === '.has';
      used++;
      for (const l of ['en', 'ru']) {
        if (cands.some((k) => keys[l].has(k) || (nodeOk && isNode(l, k)))) continue;
        problems.push(cands.some((k) => isNode(l, k)) ? `${rel}: "${cands.join('" | "')}" is an object in ${l}.json (needs a leaf key)` : `${rel}: "${cands.join('" | "')}" missing in ${l}.json`);
      }
    }
  }
}
// messages = the copy deck (site/copy): a text update must be synced (`npm run sync`) and committed — Render builds the
// repository alone (R-LP-03). The committed tree is checked by `npm run gate:clean` before every merge into main.
const drift = copyDrift(path.join(ROOT, 'messages'), path.resolve(ROOT, '..', 'copy'));
if (drift === null) console.log('check-i18n: site/copy not found — messages ↔ deck check skipped');
// GATE_DECK_DRIFT=allow: only when the lead postponed a sync (e.g. a frozen main) — the drift is printed, not failed
else if (process.env.GATE_DECK_DRIFT === 'allow') for (const d of drift) console.log(`  ! deck drift ALLOWED (GATE_DECK_DRIFT): ${d}`);
else problems.push(...drift.map((d) => `${d} (run npm run sync)`));
console.log(`check-i18n: ${keys.en.size} keys (en), ${keys.ru.size} (ru); ${used} static uses in ${files.length} files; ${dynamic.length} dynamic (template) keys`);
if (process.argv.includes('--dynamic')) for (const d of dynamic) console.log('  dynamic', d);
for (const p of [...new Set(problems)]) console.log('  ✗', p);
process.exit(problems.length ? 1 : 0);
