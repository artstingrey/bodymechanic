import fs from 'node:fs';
import path from 'node:path';
import { gatePort } from '../scripts/gate-port.cjs';

export default async function globalSetup() {
  const remote = process.env.GATE_BASE_URL;
  if (remote) { console.log(`gate: against ${remote} (no local server)`); return; }
  const port = gatePort();
  const buildId = fs.readFileSync(path.join(__dirname, '..', '.next', 'BUILD_ID'), 'utf8').trim();
  const origin = `http://127.0.0.1:${port}`;
  const res = await fetch(`${origin}/`);
  const html = await res.text();
  if (!res.ok || (!html.includes(`"${buildId}"`) && !html.includes(`\\"${buildId}\\"`))) {
    throw new Error(`gate: the process on :${port} did not serve this worktree's production build`);
  }
  console.log(`gate: Next.js build ${buildId} at ${origin}`);
}
