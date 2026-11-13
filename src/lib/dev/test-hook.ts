/**
 * The gate's only door into the stubs (RC-9, security review: no debug globals with visitor data — В-2, no `?mock=` for
 * visitors — Ж-1, no container id from a global — Ж-3).
 *
 * The gate runs against the same static build that is deployed, so nothing that touches a visitor's data or the stubs'
 * behaviour may be switched by a visitor. For those a test installs `window.__bmTest` BEFORE the page's scripts run (Playwright `page.addInitScript`, e2e/helpers.ts
 * `testHook`), and the app reads it exactly once — when this module is evaluated together with the page's own scripts:
 *   - `mock: true`  → `?mock=<mode>` of lib/api/mock-flags is honoured (a visitor's address never switches the stubs);
 *   - `gtmId`       → the GTM loader uses this container id when the build has none (lib/analytics/gtm);
 *   - `sink(channel, data)` → receives what the stubs built (the lead request, the demo BFF's artefacts, the record comment).
 * Without the hook nothing is built for inspection, nothing is kept on `window`, nothing is printed to the console.
 * Read once on purpose: an object that appears on `window` later (a tag loaded through GTM, an extension, the console) is not
 * the gate and gets nothing. This module is imported statically by code of the first chunks (components/dev/MockFlags and
 * lib/analytics/gtm on the site, lib/lp/lead on the landing), i.e. it is evaluated before any third-party script can exist
 * on the page.
 *
 * NOT behind this hook — still in the build for any visitor (security review, noted in docs/KNOWN-ISSUES.md): the 3D
 * probes the gate reads (window.__bm3d with the model, quality and zone anchors, window.__bmAnchors, __bmTextures,
 * __bmHeroReveal) and the 3D check modes `?debug=nowebgl|reduced|lowfps|nointro`. They expose nothing a script on the
 * page cannot already read from the DOM and the draft in sessionStorage, and they only change how the model is drawn.
 */
export type TestChannel =
  /** the body of POST /api/lp/lead as the BFF would receive it (lib/lp/lead) */
  | 'lp-request'
  /** what the demo BFF built for one accepted lead: { request, telegram, capi?, ads?, comment } (lib/lp/bff-mock) */
  | 'lp-bff'
  /** the record comment the BFF would send to Altegio (lib/api postRecord) */
  | 'booking-comment';

export interface TestHook {
  mock?: boolean;
  gtmId?: string;
  sink?: (channel: TestChannel, data: unknown) => void;
}

declare global {
  interface Window { __bmTest?: TestHook }
}

const hook: TestHook | null = typeof window !== 'undefined' && window.__bmTest && typeof window.__bmTest === 'object' ? window.__bmTest : null;
const allowMock = hook?.mock === true;
const gtmId = typeof hook?.gtmId === 'string' ? hook.gtmId : '';
const sink = typeof hook?.sink === 'function' ? hook.sink : null;

/** `?mock=<mode>` is honoured only for the gate. */
export const mockAllowed = (): boolean => allowMock;

/** The gate's test container id («» for a visitor): used only when the build has no NEXT_PUBLIC_GTM_ID. */
export const testGtmId = (): string => gtmId;

/** A test listens: only then do the stubs build their demo artefacts (comment, admin message, CAPI event, upload record). */
export const hasTestSink = (): boolean => sink !== null;

/** Hands `data` to the test's sink; a no-op in every page the gate does not drive. */
export function toTest(channel: TestChannel, data: unknown): void {
  if (!sink) return;
  try { sink(channel, data); } catch { /* a broken sink must not break the page */ }
}
