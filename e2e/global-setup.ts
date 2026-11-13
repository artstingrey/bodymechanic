/**
 * The gate tests THIS worktree's out/ (lead + Visual Producer, 2026-11-07): log what is served and stop at once if the
 * server on the port belongs to another worktree (reuseExistingServer would otherwise test someone else's build).
 */
import path from 'node:path';
import { gatePort, OUT_DIR } from '../scripts/gate-port.cjs';

export default async function globalSetup() {
  const remote = process.env.GATE_BASE_URL;
  if (remote) { console.log(`gate: against ${remote} (no local server)`); return; }
  const port = gatePort();
  const res = await fetch(`http://localhost:${port}/robots.txt`);
  const served = res.headers.get('x-served-out');
  const mine = path.resolve(OUT_DIR);
  if (!served) throw new Error(`gate: the server on :${port} is not scripts/serve-out.mjs of this repo (no X-Served-Out) — stop it or set GATE_PORT`);
  const theirs = path.resolve(decodeURIComponent(served));
  if (theirs.toLowerCase() !== mine.toLowerCase()) throw new Error(`gate: :${port} serves ${theirs}, not this worktree's ${mine} — stop that server or set GATE_PORT`);
  console.log(`gate: serving ${mine} on http://localhost:${port}`);
}
