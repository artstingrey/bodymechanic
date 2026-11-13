/**
 * Gate port per worktree (lead + Visual Producer, 2026-11-07): app, app-hifi, app-lp, app-nav… share the machine, and a
 * fixed port with reuseExistingServer made one gate silently test ANOTHER worktree's out/ (260 false failures).
 * Default port = 4300 + hash(this worktree's path) % 600 — stable per folder, different between worktrees.
 * GATE_PORT overrides it. `node scripts/gate-port.cjs` prints the port (for `npm run serve` in another terminal).
 * CommonJS on purpose: used by Playwright's config (loaded as CJS) and by the ESM scripts.
 */
const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-require-imports -- CommonJS on purpose (see above)

const APP_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(APP_DIR, 'out');

/** FNV-1a of the lower-cased path (Windows paths are case-insensitive) */
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of s.toLowerCase()) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

const gatePort = () => Number(process.env.GATE_PORT || 4300 + (hash(APP_DIR) % 600));

module.exports = { APP_DIR, OUT_DIR, gatePort };
if (require.main === module) console.log(gatePort());
