/**
 * Level B of the device matrix + in-app browsers (README-CONTEXT «ВСЕ iPhone И ВСЕ Android»): layout smoke on ~18 sizes
 * and Instagram / Facebook in-app profiles. Separate from the per-commit gate (Level A runs there).
 *   npm run build && npm run test:matrix        (extra args go to Playwright, e.g. --project=B-320)
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const projects = args.some((a) => a.startsWith('--project')) ? [] : ['--project=B-*', '--project=inapp-*'];
const r = spawnSync('npx', ['playwright', 'test', ...projects, ...args], { stdio: 'inherit', shell: true, env: { ...process.env, GATE_MATRIX: '1' } });
process.exit(r.status ?? 1);
