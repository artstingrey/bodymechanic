/**
 * Playwright gate (README §14, checklist DEL-02/03/04/05/08/09/10/12/13).
 * Runs against a production Next.js server. Build the same commit first for local and remote runs.
 *   npm run build && npm run gate
 *   GATE_SHOTS=0 npm run gate
 *   GATE_BASE_URL=https://… npx playwright test
 * Browser: the system Google Chrome (channel 'chrome'); on Windows it renders WebGL on the real GPU (ANGLE D3D11).
 */
import { defineConfig } from '@playwright/test';
import { IN_APP, LEVEL_A, LEVEL_B, isWebKit } from './e2e/devices';
import { gatePort } from './scripts/gate-port.cjs';

/** per worktree (hash of its path) unless GATE_PORT is set — parallel worktrees never share a server (scripts/gate-port.cjs) */
export const PORT = gatePort();
const REMOTE = process.env.GATE_BASE_URL?.replace(/\/$/, '');
/** Chrome projects: the system Google Chrome; WebKit projects (iPhone) use Playwright's WebKit build */
const CHROME = { channel: 'chrome', launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu'] : ['--enable-unsafe-swiftshader'] } };
export const WIDTHS = [
  { name: 'w390', width: 390, height: 844 },
  { name: 'w768', width: 768, height: 1024 },
  { name: 'w1280', width: 1280, height: 800 },
  { name: 'w1920', width: 1920, height: 1080 },
  { name: 'w2560', width: 2560, height: 1440 },
];

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // keep-failures: trace / screenshot / error of every failure copied to e2e/.failures/<run>/ (no run wipes it)
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }], ['./e2e/keep-failures.ts']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: REMOTE || `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
    screenshot: 'only-on-failure',
  },
  webServer: REMOTE ? undefined : {
    command: `npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    env: { ALTEGIO_LOCATION_ID: '', ALTEGIO_PARTNER_TOKEN: '', ALTEGIO_CURRENCY: '', BOOKING_QUICK_FORM_ENABLED: '' },
    url: `http://127.0.0.1:${PORT}/robots.txt`,
    reuseExistingServer: false,
  },
  projects: [
    ...WIDTHS.map((w) => ({ name: w.name, testMatch: /pages\.spec\.ts/, use: { ...CHROME, viewport: { width: w.width, height: w.height } } })),
    { name: 'flows', testMatch: /(flows|states|seo|lp-tracking)\.spec\.ts/, use: { ...CHROME, viewport: { width: 1280, height: 800 } } },
    // Level A (README-CONTEXT «ВСЕ iPhone И ВСЕ Android»): every functional phone scenario on 4 iPhones (WebKit) and
    // 4 Android phones (Chrome, mobile UA, touch) — visible areas, not screens (e2e/devices.ts). On every gate run.
    // lp.spec (ad landing) runs on the same devices: level A = all scenarios, level B / in-app = layout smoke.
    ...LEVEL_A.map((d) => ({ name: d.name, testMatch: /(mobile|lp|lp-tracking|hero|booking-compact)\.spec\.ts/, use: isWebKit(d.use) ? d.use : { ...CHROME, ...d.use } })),
    // Level B + in-app browsers: `npm run test:matrix` (GATE_MATRIX=1) — layout smoke on ~20 sizes, Instagram / Facebook
    ...(process.env.GATE_MATRIX ? [
      ...LEVEL_B.map((d) => ({ name: d.name, testMatch: /(layout-smoke|lp|hero|booking-compact)\.spec\.ts/, use: isWebKit(d.use) ? d.use : { ...CHROME, ...d.use } })),
      ...IN_APP.map((d) => ({ name: d.name, testMatch: /(inapp|lp|lp-tracking)\.spec\.ts/, use: isWebKit(d.use) ? d.use : { ...CHROME, ...d.use } })),
    ] : []),
  ],
});
