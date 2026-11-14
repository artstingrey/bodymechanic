/** Shared gate helpers: route inventory from the Next.js build, network/console guard, page-level checks. */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Request } from '@playwright/test';
import en from '../messages/en.json';

export const LOCALES = ['en', 'ru'] as const;
/** The deck glues one-letter words and some numbers to the next word with U+00A0 (808 / 833): compare text as plain spaces. */
export const plainSpaces = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');
export const ROOT = path.resolve(__dirname, '..');
export const NEXT = path.join(ROOT, '.next');

/**
 * Route templates of the sitemap (ТЗ §04 + README §13). Every one must exist in the server build for both locales —
 * a missing template fails the gate even if nothing links to it.
 */
export const REQUIRED = [
  '', 'services/', 'services/[slug]/', 'prices/', 'team/', 'team/[slug]/', 'journal/', 'journal/[slug]/',
  'contacts/', 'booking/', 'account/', 'account/record/', 'account/record/[id]/[hash]/', 'privacy/', 'terms/',
  'lp/[variant]/', // ad landing (task 01a1b325): own root layout, noindex, not in the sitemap; checked in lp.spec.ts
];

/** Prerendered URLs plus representative request-time URLs. */
const manifest = JSON.parse(fs.readFileSync(path.join(NEXT, 'prerender-manifest.json'), 'utf8')) as {
  routes: Record<string, unknown>;
};

export function builtPages(locale: string): string[] {
  const prefix = `/${locale}`;
  const pages = Object.keys(manifest.routes)
    .filter((route) => route === prefix || route.startsWith(`${prefix}/`))
    .map((route) => route === prefix ? '' : `${route.slice(prefix.length + 1)}/`);
  return [...new Set(['', ...pages, 'account/record/9001/demo-hash/'])].sort();
}

/** Template of a concrete page path: 'services/sports/' → 'services/[slug]/'. */
export function templateOf(p: string): string {
  return p
    .replace(/^account\/record\/[^/]+\/[^/]+\/$/, 'account/record/[id]/[hash]/')
    .replace(/^(services|team|journal)\/[^/]+\/$/, '$1/[slug]/')
    .replace(/^lp\/[^/]+\/$/, 'lp/[variant]/');
}

/**
 * Pages checked in the width × locale matrix: built pages and URL states for filters, booking and record links.
 */
export function matrixPages(locale: string): string[] {
  const extra = ['services/?category=massage', 'services/?category=rehab', 'booking/?step=2', 'booking/?step=4&service=101', 'booking/?step=6', 'account/record/1234/abcd/'];
  return [...builtPages(locale), ...extra];
}

/** One representative per template for DEL-09 screenshots (other slugs share the template). */
const SHOT_DETAILS = ['services/sports/', 'services/lfk-kinesio/', 'team/specialist-1/', 'journal/demo-article-1/']; // CMS service, Altegio-only service, profile, article
export function isShotPage(p: string): boolean {
  if (/^(services|team|journal)\/[^/?]+\/$/.test(p)) return SHOT_DETAILS.includes(p);
  return !p.startsWith('account/record/1234');
}

export const shotName = (locale: string, p: string) =>
  `${locale}-${(p || 'home').replace(/[/?=&]+/g, '_').replace(/_+$/, '') || 'home'}`;

export interface Guard {
  /** All problems; cancelled (ERR_ABORTED) GETs are re-requested and count only if they do not answer 200. */
  problems: () => Promise<string[]>;
  warnings: string[];
  requests: Request[];
}

/**
 * Collects everything DEL-02/DEL-08 forbid: 4xx/5xx, failed requests, third-party origins, console errors, page errors.
 * Chrome reports every HEAD fetch as net::ERR_ABORTED over CDP even though the page receives the 2xx response
 * (reproduced with a manual fetch('/robots.txt', {method:'HEAD'})). Next's export-mode prefetch uses HEAD, so a HEAD
 * that already got a response < 400 is not a failure.
 */
export function guard(page: Page, baseURL: string, opts: { allowStatus?: (url: string, status: number) => boolean } = {}): Guard {
  const origin = new URL(baseURL).origin;
  const out: string[] = [];
  const warnings: string[] = [];
  const requests: Request[] = [];
  const responded = new Map<Request, number>();
  const cancelled: string[] = [];
  // Document epochs: a request still in flight when the main frame loads a NEW document (redirect from "/", reload)
  // is cancelled by the browser (ERR_ABORTED) — that is navigation, not a broken asset. Client-side (Next) navigations
  // do not create document requests, so aborted prefetches/GLBs there are still reported.
  let epoch = 0;
  const epochOf = new Map<Request, number>();
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) epoch++;
    epochOf.set(r, epoch);
    requests.push(r);
    const u = r.url();
    if (/^(data|blob):/.test(u)) return;
    if (new URL(u).origin !== origin) out.push(`third-party request: ${r.method()} ${u}`);
  });
  page.on('response', (r) => {
    responded.set(r.request(), r.status());
    if (r.status() >= 400 && !opts.allowStatus?.(r.url(), r.status())) out.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    const st = responded.get(r);
    if (r.method() === 'HEAD' && st !== undefined && st < 400) return;
    // cancelled: Chrome «net::ERR_ABORTED», WebKit «Load request cancelled» (iPhone projects)
    const aborted = /^net::ERR_ABORTED$|^Load request cancelled$/.test(r.failure()?.errorText ?? '');
    if (aborted && (epochOf.get(r) ?? 0) < epoch) return;
    // A cancelled request is not a broken asset: the Next router cancels in-flight RSC prefetches when it navigates, Chrome
    // cancels the favicon fetch on navigation — on a slow network (Render) both happen. Verified below: the same URL must
    // answer 200 (a cancelled HEAD prefetch is checked with GET). Real failures (DNS, connection, 4xx/5xx) have other error
    // texts / statuses and are still reported.
    // blob: URLs live inside the page (the KTX2 transcoder's worker script, an embedded image): one cancelled by a navigation
    // is not a broken asset, and it cannot be re-requested from outside (→ 0). Seen since the hero's runtime waits for the
    // LCP (RC-4): a test that leaves the home page early now cancels it mid-load.
    if (aborted && r.url().startsWith('blob:')) return;
    if (aborted && (r.method() === 'GET' || r.method() === 'HEAD')) { cancelled.push(r.url()); return; }
    out.push(`failed: ${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') out.push(`console.error: ${m.text()}`);
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => {
    // WebKit (iPhone projects) reports a same-origin fetch cancelled by a navigation — an RSC prefetch, or the 3D model still
    // loading when the test moves on (/models/*.glb) — as «<url> due to access control checks» (Chrome: ERR_ABORTED).
    // Same treatment as above: re-requested below, a problem only if it does not answer 200.
    const m = e.message.match(/(\S+) due to access control checks/);
    if (m) {
      try {
        const u = new URL(/^[a-z]+:\/\//i.test(m[1]) ? m[1] : `http://${m[1].replace(/^\/+/, '')}`);
        if (u.origin === origin) { cancelled.push(u.href); return; }
      } catch { /* not a URL — report it */ }
    }
    out.push(`pageerror: ${e.message}`);
  });
  const problems = async () => {
    const extra: string[] = [];
    for (const u of [...new Set(cancelled)]) {
      const st = (await page.request.get(u, { headers: { rsc: '1' } }).catch(() => null))?.status() ?? 0;
      if (st !== 200) extra.push(`cancelled request does not exist: ${u} → ${st}`);
    }
    return [...out, ...extra];
  };
  return { problems, warnings, requests };
}

/** Waits until the 3D slot (if any) has the model ready or switched to 2D — so screenshots show the final state. */
export async function settle3D(page: Page) {
  if (!(await page.locator('.b3d-slot').count())) return;
  await page.waitForFunction(() => {
    const s = document.querySelector<HTMLElement>('.b3d-slot');
    return !s || s.dataset.status === 'ready' || !!s.dataset.mode2d;
  }, null, { timeout: 30_000 });
}

/**
 * For full-page screenshots: the render loop sleeps while the slot is off-screen (frameloop 'never'), so a slot below
 * the first screen would be captured blank. Scroll it into view, let it draw, come back to the top.
 */
export async function drawOffscreen3D(page: Page) {
  const slot = page.locator('.b3d-slot:not([data-mode2d])');
  if (!(await slot.count())) return;
  const f0 = await page.evaluate(() => window.__bm3d?.frames ?? 0);
  await slot.first().scrollIntoViewIfNeeded();
  await page.waitForFunction((f) => (window.__bm3d?.frames ?? 0) > f + 3, f0, { timeout: 10_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Static checks on the rendered DOM (DEL-03/04/05/13, html lang, one h1). Returns human-readable problems. */
export async function domChecks(page: Page, locale: string) {
  return page.evaluate((loc) => {
    const p: string[] = [];
    const html = document.documentElement;
    if (html.lang !== loc) p.push(`html lang="${html.lang}", expected "${loc}"`);
    // Next adds its own <meta robots="noindex"> on some pages; all tags together must say noindex + nofollow
    const robots = [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute('content')).join(', ');
    if (!/noindex/.test(robots) || !/nofollow/.test(robots)) p.push(`meta robots="${robots}" (needs noindex, nofollow)`);
    const vp = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    if (!/width=device-width/.test(vp) || /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(vp)) p.push(`viewport="${vp}"`);
    const h1 = document.querySelectorAll('h1').length;
    if (h1 !== 1) p.push(`${h1} <h1> on the page (expected 1)`);
    // horizontal overflow: report the widest offenders
    const cw = html.clientWidth;
    if (html.scrollWidth > cw) {
      const off = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((e) => e.getBoundingClientRect().right > cw + 0.5)
        .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''} →${Math.round(e.getBoundingClientRect().right)}px`);
      p.push(`horizontal overflow ${html.scrollWidth}>${cw}: ${off.join(', ')}`);
    }
    // dead links (DEL-03)
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a')) {
      const raw = a.getAttribute('href');
      if (raw === null || raw.trim() === '' || raw === '#' || /^javascript:/i.test(raw)) p.push(`dead link: <a href="${raw}"> "${a.textContent?.trim().slice(0, 40)}"`);
    }
    // touch targets ≥44×44 (A11Y-03, R-3D-01 F-05): every visible button
    for (const btn of document.querySelectorAll<HTMLElement>('button')) {
      const r = btn.getBoundingClientRect();
      if (r.width && r.height && (r.width < 43.5 || r.height < 43.5)) p.push(`button ${Math.round(r.width)}×${Math.round(r.height)} < 44: "${btn.textContent?.trim().slice(0, 30) || btn.getAttribute('aria-label')}"`);
    }
    // iOS zoom-on-focus (DEL-05): fields ≥16px
    for (const f of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      const fs = parseFloat(getComputedStyle(f).fontSize);
      if (fs < 16) p.push(`field font-size ${fs}px < 16: ${f.outerHTML.slice(0, 80)}`);
    }
    return p;
  }, locale);
}

/** Internal link targets of the page (same origin, no hash-only), for the link-resolution check. */
export async function internalLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((a) => a.href).filter((h) => h.startsWith(location.origin)))]);
}

export function expectClean(problems: string[], label: string) {
  expect(problems, `${label}:\n  ${problems.join('\n  ')}`).toEqual([]);
}

/**
 * Cookie consent given in advance: the hi-fi cookie card is a fixed card over the content and would cover part of the 3D
 * slot in pixel and click tests. The banner itself stays covered by the page matrix (no consent there).
 */
export async function seedConsent(page: Page, c: { analytics: boolean; marketing: boolean } = { analytics: false, marketing: false }) {
  await page.addInitScript((v) => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, ...v, at: 'gate' })), c);
}

/**
 * RC-9 (security review S-1, S-3, Ж-3): the deployed build — the very one this gate runs against — keeps no debug globals,
 * ignores `?mock=` and takes the container id from the build only. A test that needs the stubs installs this hook BEFORE
 * the page's scripts; src/lib/dev/test-hook.ts reads `window.__bmTest` once, together with the page's own scripts:
 *   mock  — `?mock=<mode>` is honoured (lib/api/mock-flags);
 *   gtmId — the loader takes this test container id (the spec answers the request itself, nothing leaves the machine);
 *   sink  — what the stubs built lands in the TEST's own globals, which exist only in a page the gate drives:
 *           __lpLastRequest (the lead request), __lpBff { requests, telegram, capi, ads, comments }, __lpLeads (leads
 *           accepted), __bmLastComment (the record comment the BFF would send to Altegio).
 * A test of the visitor's page (no globals, `?mock=` ignored) simply does not call it.
 */
export async function testHook(page: Page, opts: { gtmId?: string } = {}) {
  await page.addInitScript((o) => {
    type Bff = { requests: unknown[]; telegram: unknown[]; capi: unknown[]; ads: unknown[]; comments: unknown[] };
    const w = window as unknown as { __bmTest?: unknown; __lpLastRequest?: unknown; __lpBff?: Bff; __lpLeads?: number; __bmLastComment?: unknown };
    w.__bmTest = {
      mock: true,
      ...(o.gtmId ? { gtmId: o.gtmId } : {}),
      sink: (channel: string, data: unknown) => {
        if (channel === 'lp-request') w.__lpLastRequest = data;
        else if (channel === 'booking-comment') w.__bmLastComment = data;
        else if (channel === 'lp-bff') {
          const d = data as { request: unknown; telegram: unknown; capi?: unknown; ads?: unknown; comment: unknown };
          const L = (w.__lpBff ||= { requests: [], telegram: [], capi: [], ads: [], comments: [] });
          L.requests.push(d.request); L.telegram.push(d.telegram); L.comments.push(d.comment);
          if (d.capi) L.capi.push(d.capi);
          if (d.ads) L.ads.push(d.ads);
          w.__lpLeads = (w.__lpLeads ?? 0) + 1;
        }
      },
    };
  }, opts);
}

/** Zones from the list → service → any specialist → first free day, first non-13:30 slot → contacts → step 6 */
/**
 * Fill a PhoneField: it puts «+971 » on focus (state update) — under heavy parallel load that render can land after a
 * fill done in the same breath and swallow it. Focus, wait for the prefix, fill, check the value.
 */
export async function fillPhone(field: import('@playwright/test').Locator, value: string) {
  await expect(async () => { await field.focus(); await expect(field).toHaveValue(/^\+971/, { timeout: 1000 }); }).toPass();
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

export async function toReview(page: Page, opts: { zones?: number; slot1330?: boolean } = {}) {
  const boxes = page.locator('#zone-list input[type="checkbox"]');
  for (let i = 0; i < (opts.zones ?? 1); i++) await boxes.nth(i).check();
  await page.getByRole('button', { name: en.body3d.panel.cta }).click();
  await page.waitForURL(/step=2/);
  await page.locator('input[name="service"]').first().check();
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=3/);
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=4/);
  if (opts.slot1330) {
    await page.locator('.dates button:not([aria-disabled])').first().waitFor(); // the calendar loads after the step change
    const n = await page.locator('.dates button:not([aria-disabled])').count();
    for (let i = 0; i < n; i++) {
      const d = page.locator('.dates button:not([aria-disabled])').nth(i);
      await d.click();
      await expect(d).toHaveAttribute('aria-pressed', 'true');
      await page.waitForFunction(() => !document.querySelector('.booking-loading') && document.querySelectorAll('.times button').length > 0);
      const t = page.locator('.times button', { hasText: '13:30' });
      if (await t.count()) { await t.first().click(); await expect(t.first()).toHaveAttribute('aria-pressed', 'true'); break; }
    }
  } else {
    const d = page.locator('.dates button:not([aria-disabled])').first();
    await d.click();
    await expect(d).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.booking-loading')).toHaveCount(0);
    await page.locator('.times button').filter({ hasNotText: '13:30' }).first().click();
  }
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=5/);
  await expect(page.locator('#st5')).toBeFocused(); // the flow moves the focus to the step heading (rAF) — let it land first
  await page.locator('input[autocomplete="name"]').fill('Demo');
  await fillPhone(page.locator('input[type="tel"]'), '+971500000000');
  for (const c of await page.locator('form input[type="checkbox"]').all()) await c.check();
  await page.getByRole('button', { name: en.booking.contacts.next }).click();
  await page.waitForURL(/step=6/);
  await expect(page.getByTestId('captcha')).toHaveAttribute('data-verified', 'true');
}

/**
 * /booking prerenders step 1 (R-FINAL perf, option A). Counts animation frames in which step 1 was visible while the URL
 * points at steps 2–7 — i.e. a flash of step 1 before the linked step (window.__bkFlash; rAF runs right before a paint).
 */
const STEP1_FLASH_PROBE = `(() => {
  window.__bkFlash = 0;
  const tick = () => {
    const b = document.querySelector('.booking');
    if (b && /[?&]step=[2-7]/.test(location.search) && b.getAttribute('data-step') === '1' && getComputedStyle(b).visibility !== 'hidden') window.__bkFlash++;
    if (performance.now() < 20000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;
const flashes = (page: Page) => page.evaluate(() => (window as unknown as { __bkFlash?: number }).__bkFlash ?? -1);

/**
 * Every step by direct link (F5 / a shared link) and the browser Back between steps: the linked step is shown, step 1
 * never flashes, the focus is not moved on load (F-04: only on step changes). Starts on /en/booking/ with consent seeded.
 */
export async function deepLinksEveryStep(page: Page) {
  await page.addInitScript(STEP1_FLASH_PROBE);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await toReview(page, { zones: 1 }); // a full choice in sessionStorage → every step has content
  const at = async (n: number, how: string) => {
    await expect(page.locator('.booking'), how).toHaveAttribute('data-step', String(n));
    await expect(page.locator(`#st${n}`), how).toBeVisible();
    expect(await flashes(page), `${how}: frames with step 1 visible`).toBe(0);
  };
  for (const n of [2, 3, 4, 5, 6]) {
    await page.goto(`/en/booking/?step=${n}`, { waitUntil: 'networkidle' });
    await at(n, `direct link ?step=${n}`);
    expect(await page.evaluate(() => document.activeElement?.id ?? ''), `?step=${n}: focus not moved on load`).not.toBe(`st${n}`);
  }
  // browser Back / Forward between steps loaded by direct link (separate documents, bfcache or reload)
  await page.goBack({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/step=5/);
  await at(5, 'Back to ?step=5');
  await page.goForward({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/step=6/);
  await at(6, 'Forward to ?step=6');
  // in-app step change after a direct link, then the browser Back
  await page.goto('/en/booking/?step=4', { waitUntil: 'networkidle' });
  await at(4, 'direct link ?step=4 (again)');
  await page.getByRole('button', { name: en.common.actions.next, exact: true }).click();
  await page.waitForURL(/step=5/);
  await at(5, 'Next → step 5');
  await page.goBack();
  await page.waitForURL(/step=4/);
  await at(4, 'Back → step 4');
  // step 7 by direct link after a booking (survives F5)
  await page.goto('/en/booking/?step=6', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('captcha')).toHaveAttribute('data-verified', 'true');
  await page.getByRole('button', { name: en.booking.review.confirm }).click();
  await page.waitForURL(/step=7/);
  await page.goto('/en/booking/?step=7', { waitUntil: 'networkidle' });
  await at(7, 'direct link ?step=7 after a booking');
  // and step 1 itself is the static first paint: visible, no guard
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await expect(page.locator('.booking')).toHaveAttribute('data-step', '1');
  await expect(page.locator('#st1')).toBeVisible();
}

/**
 * R-FINAL F-04: right after /booking loads — no tool chosen — a drag rotates the model and places nothing, then a tap on the chest places «Marker 1»;
 * the model and places nothing. `touch` = touchscreen taps (phones), else the mouse.
 */
export async function tapMarksRightAway(page: Page, touch: boolean) {
  await settle3D(page);
  await page.locator('.b3d-slot').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => !!window.__bm3d?.anchors);
  await page.evaluate(() => window.__bm3d!.anchors!.watch());
  await page.waitForFunction(() => window.__bm3d!.anchors!.get().zones.some((z) => z.zoneId === 'chest' && z.visible));
  const box = (await page.locator('.b3d-slot canvas').boundingBox())!;
  const chest = () => page.evaluate(() => window.__bm3d!.anchors!.get().zones.find((z) => z.zoneId === 'chest')!);
  // 1) a drag rotates the model and places nothing (before any marker: on phones the «Запись» sheet then rises over the
  //    lower part of the model)
  const c0 = await chest();
  const x0 = box.x + c0.x - 40, y0 = box.y + c0.y;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 30, y0, { steps: 5 }); await page.mouse.move(x0 + 60, y0, { steps: 5 }); await page.mouse.up();
  // OrbitControls damping keeps turning a little after the release — wait until the chest anchor stands still
  await page.waitForFunction(() => {
    const z = window.__bm3d!.anchors!.get().zones.find((q) => q.zoneId === 'chest')!;
    const w = window as unknown as { __chestX?: number }; const still = w.__chestX !== undefined && Math.abs(w.__chestX - z.x) < 0.5;
    w.__chestX = z.x; return still;
  }, null, { polling: 150 });
  const c1 = await chest();
  expect(Math.abs(c1.x - c0.x), 'the drag rotated the model').toBeGreaterThan(5);
  expect(c1.visible, 'the chest still faces the camera').toBe(true);
  await expect(page.getByTestId('b3d-marker')).toHaveCount(0);
  // 2) a tap on the chest (wherever it is now) places «Marker 1» — no tool chosen
  const box1 = (await page.locator('.b3d-slot canvas').boundingBox())!;
  const x = box1.x + c1.x, y = box1.y + c1.y;
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  await expect(page.getByTestId('b3d-live')).toContainText(`Marker 1: ${en.body3d.zones.chest}`);
}

/**
 * RC-10 (security review Ж-9): two observers of the addresses a page goes through — for the tests that a choice brought
 * into the booking is never in an address a tag reads (seo.spec in Chrome, mobile.spec on the phones, WebKit included).
 *   `page`      — installed before the page's scripts: the address after every pushState / replaceState and on popstate;
 *   `container` — the stub that answers the container request reports what a real container would see: the address and
 *                 the referrer when it starts, «old → new» on every later change of the history.
 * Consent has to be seeded by the test (seedConsent), otherwise the container is never requested.
 */
export type EntrySeen = { who: 'page' | 'container'; what: string; href: string; from?: string; referrer?: string };
export const CHOICE_IN_URL = /[?&](?:service|staff|date|time)=/;
export const withChoice = (r: EntrySeen) => [r.href, r.from ?? '', r.referrer ?? ''].some((u) => CHOICE_IN_URL.test(u));
export async function entryProbe(page: Page, gtmId = 'GTM-GATE01') {
  const seen: EntrySeen[] = [];
  await page.exposeFunction('__bmEntrySeen', (r: EntrySeen) => { seen.push(r); });
  await page.addInitScript(() => {
    const tell = (r: unknown) => (window as unknown as { __bmEntrySeen: (r: unknown) => void }).__bmEntrySeen(r);
    for (const m of ['pushState', 'replaceState'] as const) {
      const native = history[m].bind(history);
      history[m] = ((...a: Parameters<History['pushState']>) => { const from = location.href; native(...a); tell({ who: 'page', what: m, href: location.href, from }); }) as History['pushState'];
    }
    window.addEventListener('popstate', () => tell({ who: 'page', what: 'popstate', href: location.href }));
  });
  const stub = `(function(){var tell=window.__bmEntrySeen,last=location.href;tell({who:'container',what:'start',href:last,referrer:document.referrer});`
    + `['pushState','replaceState'].forEach(function(m){var n=history[m];history[m]=function(){var r=n.apply(this,arguments);tell({who:'container',what:m,href:location.href,from:last});last=location.href;return r}});`
    + `window.addEventListener('popstate',function(){tell({who:'container',what:'popstate',href:location.href,from:last});last=location.href})})();`;
  await page.route(/googletagmanager\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: stub }));
  await testHook(page, { gtmId });
  return seen;
}
