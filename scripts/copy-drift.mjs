/**
 * Drift between the app's messages and the copy deck (site/copy/messages.{ru,en}.json — Market Analyst's single source of
 * visible strings, copied by `npm run sync`). Render builds the repository ALONE (no site/ next to it), so a text update
 * that was never synced and committed would ship stale strings or break the build on a missing key (R-LP-03).
 * Returns problems (empty = in sync); `null` when the deck is not available (a checkout without site/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { lpWorkingConfig } from './lp-config-pick.mjs';

const leaves = (o, p = '', out = new Map()) => {
  for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object') leaves(v, key, out); else out.set(key, v); }
  return out;
};

/** @param {string} messagesDir app messages (…/messages) @param {string} copyDir the deck (…/site/copy) */
export function copyDrift(messagesDir, copyDir) {
  if (!fs.existsSync(path.join(copyDir, 'messages.ru.json'))) return null;
  const problems = [];
  for (const l of ['ru', 'en']) {
    const app = leaves(JSON.parse(fs.readFileSync(path.join(messagesDir, `${l}.json`), 'utf8')));
    const deck = leaves(JSON.parse(fs.readFileSync(path.join(copyDir, `messages.${l}.json`), 'utf8')));
    const onlyDeck = [...deck.keys()].filter((k) => !app.has(k));
    const onlyApp = [...app.keys()].filter((k) => !deck.has(k));
    const changed = [...deck.keys()].filter((k) => app.has(k) && app.get(k) !== deck.get(k));
    const list = (a) => `${a.slice(0, 8).join(', ')}${a.length > 8 ? ', …' : ''}`;
    if (onlyDeck.length) problems.push(`messages/${l}.json: ${onlyDeck.length} key(s) of the deck missing — ${list(onlyDeck)}`);
    if (onlyApp.length) problems.push(`messages/${l}.json: ${onlyApp.length} key(s) not in the deck — ${list(onlyApp)}`);
    if (changed.length) problems.push(`messages/${l}.json: ${changed.length} text(s) differ from the deck — ${list(changed)}`);
  }
  // the ad landing's config (versions, offer, form, notifications, tracking rules) — also copied by npm run sync
  const appCfg = path.join(messagesDir, '..', 'src', 'lib', 'lp', 'config.json');
  const deckCfg = path.join(copyDir, 'lp-config.json');
  if (fs.existsSync(appCfg) && fs.existsSync(deckCfg)) {
    // the app keeps only the working fields of the deck file (scripts/lp-config-pick.mjs, В-5)
    const a = leaves(JSON.parse(fs.readFileSync(appCfg, 'utf8'))), d = leaves(lpWorkingConfig(JSON.parse(fs.readFileSync(deckCfg, 'utf8'))));
    const diff = [...new Set([...a.keys(), ...d.keys()])].filter((k) => a.get(k) !== d.get(k));
    if (diff.length) problems.push(`src/lib/lp/config.json: ${diff.length} value(s) differ from the working fields of site/copy/lp-config.json — ${diff.slice(0, 8).join(', ')}${diff.length > 8 ? ', …' : ''}`);
  }
  // the denylist the gate checks the landing against (RC-9, T-1) — a copy of the deck's, also made by npm run sync
  const appLex = path.join(messagesDir, '..', 'e2e', 'fixtures', 'lexicon-denylist.json');
  const deckLex = path.join(copyDir, 'lexicon-denylist.json');
  if (fs.existsSync(deckLex)) {
    const same = fs.existsSync(appLex) && JSON.stringify(JSON.parse(fs.readFileSync(appLex, 'utf8'))) === JSON.stringify(JSON.parse(fs.readFileSync(deckLex, 'utf8')));
    if (!same) problems.push(`e2e/fixtures/lexicon-denylist.json ${fs.existsSync(appLex) ? 'differs from' : 'is missing: copy of'} site/copy/lexicon-denylist.json`);
  }
  return problems;
}
