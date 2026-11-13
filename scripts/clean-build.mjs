/**
 * Clean build — the way Render builds (R-LP-03, lead): the COMMITTED tree only, nothing from site/ next to it.
 *   1. git archive <ref> (default HEAD) → an empty folder outside site/ (OS temp);
 *   2. its messages/* must equal the copy deck (site/copy, sync check: keys AND texts) — a text update that was synced
 *      only in a working copy fails here, not on Render;
 *   3. npm ci → npm run build (Render: `npm ci && npm run build`, NODE_VERSION 22) → out/ has the key pages;
 *   4. the same tree without docs/ and README.md builds the same stylesheets, byte for byte (RC-10: a documents-only
 *      commit must not change the site's CSS).
 * Run before EVERY merge into main: `npm run gate:clean [-- <ref>]`. Exit 1 on any problem; the folder is kept on failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyDrift } from './copy-drift.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPY = path.resolve(APP, '..', 'copy');
const ref = process.argv[2] ?? 'HEAD';
const win = process.platform === 'win32';

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}${opts.cwd ? `   (in ${opts.cwd})` : ''}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win, ...opts });
  if (r.status !== 0) { console.error(`\nclean build: FAILED at «${cmd} ${args.join(' ')}» (exit ${r.status})`); process.exit(1); }
};
const out = (cmd, args) => spawnSync(cmd, args, { cwd: APP, encoding: 'utf8' }).stdout.trim();

const sha = out('git', ['rev-parse', '--short', ref]);
if (!sha) { console.error(`clean build: unknown ref ${ref}`); process.exit(1); }
// one folder per RUN (mkdtemp, random suffix): two worktrees may clean-build the same commit at once (EPERM on a shared folder)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bm-clean-build-${sha}-`));
console.log(`clean build of ${ref} (${sha}) in ${dir}`);

// 1) the committed tree only
// piped through stdin: no drive-letter paths for tar (GNU tar from Git for Windows reads «C:…» as a remote host)
console.log(`\n$ git archive --format=tar ${ref} | tar -xf -   (in ${dir})`);
if (spawnSync(`git -C "${APP}" archive --format=tar ${ref} | tar -xf -`, { cwd: dir, stdio: 'inherit', shell: true }).status !== 0
  || !fs.existsSync(path.join(dir, 'package.json'))) { console.error('clean build: git archive failed'); process.exit(1); }

// 2) committed messages = the copy deck
const drift = copyDrift(path.join(dir, 'messages'), COPY);
if (drift === null) console.warn('\nmessages ↔ site/copy: the deck is not available here — sync check SKIPPED');
else if (drift.length && process.env.GATE_DECK_DRIFT === 'allow') {
  // only when the lead postponed a sync (frozen main): the build still has to pass with the committed messages
  console.warn('\nmessages ↔ site/copy: drift ALLOWED by GATE_DECK_DRIFT=allow (sync postponed by the lead):');
  for (const p of drift) console.warn(`  - ${p}`);
} else if (drift.length) {
  console.error('\nclean build: the COMMITTED messages differ from site/copy (run `npm run sync`, commit messages/*):');
  for (const p of drift) console.error(`  - ${p}`);
  process.exit(1);
} else console.log('\nmessages ↔ site/copy: identical (keys and texts)');

// 3) Render's build
run('npm', ['ci', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: dir });
run('npm', ['run', 'build'], { cwd: dir, env: { ...process.env, NODE_ENV: 'production' } });
const must = ['index.html', '404.html', 'ru/index.html', 'en/index.html', 'ru/booking/index.html', 'en/booking/index.html', 'robots.txt', 'sitemap.xml'];
const missing = must.filter((f) => !fs.existsSync(path.join(dir, 'out', f)));
if (missing.length) { console.error(`\nclean build: out/ is missing ${missing.join(', ')}`); process.exit(1); }

// 4) Only src/ and messages/ may feed the site's CSS (RC-10). Left to itself Tailwind looks for class names in every file
//    git does not ignore; in RC-9 a word in docs/KNOWN-ISSUES.md became a utility and the deployed stylesheet was not the
//    one the gate had run on. globals.css names the sources explicitly — proved here: the same tree WITHOUT the
//    documents, and WITH class-like words in a test and in a new file of the root, must build the same stylesheets,
//    name for name and byte for byte.
const stylesheets = () => {
  const found = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.css')) found.set(path.relative(path.join(dir, 'out'), p), crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')); } };
  walk(path.join(dir, 'out', '_next', 'static'));
  return found;
};
const withDocs = stylesheets();
const hadDocs = fs.existsSync(path.join(dir, 'docs')) || fs.existsSync(path.join(dir, 'README.md'));
fs.rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
fs.rmSync(path.join(dir, 'README.md'), { force: true });
const PROBE = 'class="backdrop-filter line-through animate-bounce col-span-7"'; // real Tailwind utilities the site does not use
fs.writeFileSync(path.join(dir, 'e2e', 'zz-tailwind-probe.ts'), `// ${PROBE}\nexport {};\n`);
fs.writeFileSync(path.join(dir, 'ZZ-TAILWIND-PROBE.md'), `${PROBE}\n`);
run('npm', ['run', 'build'], { cwd: dir, env: { ...process.env, NODE_ENV: 'production' } });
const withoutDocs = stylesheets();
const differ = [...new Set([...withDocs.keys(), ...withoutDocs.keys()])].filter((f) => withDocs.get(f) !== withoutDocs.get(f));
if (!withDocs.size || differ.length) {
  console.error(`\nclean build: files outside src/ and messages/ change the site's CSS — ${differ.length} stylesheet(s) differ between the commit and the same tree without docs/ and README.md, with a class-like word in e2e/ and in a new root file:`);
  for (const f of differ) console.error(`  - ${f}: ${withDocs.get(f) ?? 'absent'} (the commit) / ${withoutDocs.get(f) ?? 'absent'} (the changed tree)`);
  console.error('Tailwind\'s sources are listed in src/app/globals.css (`source(none)` + `@source`): keep them to src/ and messages/.');
  process.exit(1);
}
console.log(`\ndocuments ↔ CSS: ${withDocs.size} stylesheet(s) identical — without docs/ and README.md${hadDocs ? '' : ' (the commit has neither)'}, with a class-like word in e2e/ and in a new root file`);
console.log(`\nclean build of ${sha}: OK (${must.length} key files in out/)`);
fs.rmSync(dir, { recursive: true, force: true });
