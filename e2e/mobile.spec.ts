/**
 * iOS Safari profile — the client's main audience (README-CONTEXT «ГЛАВНЫЙ ПРИОРИТЕТ: МОБИЛЬНЫЙ»): Playwright WebKit with
 * the Level A iPhones, and Chrome with the Level A Android phones (projects A-*, e2e/devices.ts). Key scenarios: home, booking to step 7, the quick form,
 * «Мои записи». On every screen: no horizontal scroll, text fields ≥ 16 px (no iOS auto-zoom), fixed / sticky bottom
 * elements above the home indicator (env(safe-area-inset-bottom)), the focused field is not left under the keyboard.
 */
import { test, expect, type Page } from '@playwright/test';
import en from '../messages/en.json';
import { guard, expectClean, seedConsent, toReview, fillPhone, tapMarksRightAway, deepLinksEveryStep, settle3D, entryProbe, withChoice, CHOICE_IN_URL } from './helpers';
import { SERVICES, STAFF } from '../src/lib/api/mock-data';

async function noHorizontalScroll(page: Page, label: string) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, `${label}: horizontal scroll`).toBeLessThanOrEqual(w + 1);
}

/** every visible text field ≥ 16 px — otherwise iOS Safari zooms the page on focus */
async function noAutoZoom(page: Page, label: string) {
  const small = await page.evaluate(() => [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea')]
    .filter((el) => (el as HTMLElement).offsetParent !== null)
    .map((el) => ({ id: el.id || el.getAttribute('name') || el.tagName, px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((f) => f.px < 16));
  expect(small, `${label}: fields under 16 px`).toEqual([]);
}

/** the element is kept above the home indicator: a CSS rule that applies to it uses env(safe-area-inset-bottom) */
async function hasSafeArea(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    let found = false;
    const walk = (rules: CSSRuleList) => {
      for (const r of [...rules]) {
        if (r instanceof CSSMediaRule && !window.matchMedia(r.conditionText).matches) continue;
        if (r instanceof CSSStyleRule) { try { if (el.matches(r.selectorText) && /safe-area-inset-bottom/.test(r.style.cssText)) found = true; } catch { /* nested selector */ } }
        if ('cssRules' in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
      }
    };
    for (const s of [...document.styleSheets]) { try { walk(s.cssRules); } catch { /* cross-origin */ } }
    return found;
  }, selector);
}

/** a field placed low on the screen is moved up when focused (the keyboard takes the lower part — FocusIntoView) */
async function focusStaysAboveKeyboard(page: Page, selector: string) {
  const field = page.locator(selector);
  await field.evaluate((el) => { // put it near the bottom edge first
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - window.innerHeight * 0.88);
  });
  await field.tap();
  await page.waitForTimeout(450); // rAF + the post-keyboard re-check (350 ms)
  const pos = await field.evaluate((el) => { const r = el.getBoundingClientRect(); return (r.top + r.height / 2) / window.innerHeight; });
  expect(pos, `${selector} centre after focus (share of the viewport height)`).toBeLessThan(0.6);
}

test('viewport: device-width, cover (safe areas), zoom not disabled', async ({ page }) => {
  await page.goto('/ru/', { waitUntil: 'domcontentloaded' });
  const vp = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(vp).toMatch(/width=device-width/);
  expect(vp).toMatch(/viewport-fit=cover/);
  expect(vp).not.toMatch(/user-scalable=no|maximum-scale=1(?!\d)/);
});

test('home: cookie sheet and FAB above the home indicator, quick form without auto-zoom, no horizontal scroll', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/ru/', { waitUntil: 'networkidle' });
  await noHorizontalScroll(page, 'home top');
  await expect(page.locator('.cookie')).toBeVisible();
  expect(await hasSafeArea(page, '.cookie'), 'cookie sheet: safe-area-inset-bottom').toBe(true);
  await page.locator('.cookie').getByRole('button').first().tap(); // «Принять все»
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
  await expect(page.locator('.fab-wrap')).toBeAttached();
  expect(await hasSafeArea(page, '.fab-wrap'), 'FAB: safe-area-inset-bottom').toBe(true);
  await page.locator('form.qform').scrollIntoViewIfNeeded();
  await noAutoZoom(page, 'quick form');
  await noHorizontalScroll(page, 'home scrolled');
  expectClean(await g.problems(), 'mobile home');
});

test('quick form: the focused field is not left under the keyboard; the request goes through', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  await focusStaysAboveKeyboard(page, '#qf-name');
  const form = page.locator('form.qform');
  await page.locator('#qf-name').fill('Demo');
  await page.locator('#qf-phone').fill('+971501234567');
  await page.locator('#qf-service').selectOption({ index: 1 });
  await expect(page.locator('#qf-date')).toBeEnabled();
  await page.locator('#qf-date').selectOption({ index: 1 });
  await expect(page.locator('#qf-time')).toBeEnabled();
  await page.locator('#qf-consent').check();
  await form.getByRole('button', { name: en.home.form.submit, exact: true }).tap();
  await expect(page.getByRole('status').filter({ hasText: en.booking.done.title })).toBeVisible();
  await noHorizontalScroll(page, 'quick form done');
  expectClean(await g.problems(), 'mobile quick form');
});

test('booking: zone list → step 7; sticky CTA above the home indicator, contacts without auto-zoom and keyboard overlap', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await noHorizontalScroll(page, 'step 1');
  expect(await hasSafeArea(page, '.bk-step--zones .bk-cta'), 'step 1 sticky CTA: safe-area-inset-bottom').toBe(true);
  // toReview: zone from the list → service → any specialist → day and slot → contacts → step 6
  await toReview(page, { zones: 1 });
  await page.getByRole('button', { name: en.booking.review.confirm }).tap();
  await page.waitForURL(/step=7/);
  await expect(page.locator('#st7')).toHaveText(en.booking.done.title);
  await noHorizontalScroll(page, 'step 7');
  // contacts once more (direct link): sizes and the keyboard
  await page.goto('/en/booking/?step=5', { waitUntil: 'networkidle' });
  await noAutoZoom(page, 'step 5');
  await focusStaysAboveKeyboard(page, '#c-email');
  expectClean(await g.problems(), 'mobile booking');
});

test('«My bookings»: sign in with phone and code, records listed, no horizontal scroll', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/account/', { waitUntil: 'networkidle' });
  await noAutoZoom(page, 'login');
  await fillPhone(page.locator('#acc-phone'), '+971501234567');
  await page.getByRole('button', { name: en.account.login.getCode }).tap();
  await page.locator('#acc-code').fill('1234');
  await page.getByRole('button', { name: en.account.login.submit }).tap();
  await expect(page.getByTestId('account-record')).toHaveCount(3);
  await noHorizontalScroll(page, 'records');
  expectClean(await g.problems(), 'mobile account');
});

test('R-FINAL F-04: a tap on the model right after load places «Marker 1»; a drag rotates', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await tapMarksRightAway(page, true);
  expectClean(await g.problems(), 'mobile tap');
});


// ---------------------------------------------------------------- device matrix (README-CONTEXT «ВСЕ iPhone И ВСЕ Android»)
const isAndroid = (name: string) => /moto|pixel|galaxy/.test(name);

const overlayDepth = (page: Page) => page.evaluate(() => Number((history.state as { bmOverlay?: number } | null)?.bmOverlay) || 0);
/** Android «Back» once the overlay has put its history entry (React effect, a frame after the UI opens — a person is never faster) */
async function back(page: Page, depth = 1) {
  await expect.poll(() => overlayDepth(page), 'overlay history entry').toBe(depth);
  await page.goBack();
}

test('R-FINAL-2 F2-01: /booking step 1 — the model ≥ 55 % of the visible height (iPhone SE ≥ 50 %), «Step 1 of 7» and the H1 on one row, a marker leaves the sheet in peek', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  const vp = page.viewportSize()!;
  // the model area left free: below the toolbar, above the peeking sheet and the CTA bar
  const m = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const slot = r('.booking-3d__model .b3d-slot'), bar = r('.booking-3d__model .b3d-switch') /* the top row; the tools are a column on the left edge (design audit F01) */, sheet = r('.bsheet'), cta = r('.bk-step--zones .bk-cta');
    const h1 = r('#st1'), step = r('.bk-head__step');
    return {
      free: Math.min(slot.bottom, sheet.top, cta.top) - Math.max(slot.top, bar.bottom),
      sameRow: Math.abs((h1.top + h1.bottom) / 2 - (step.top + step.bottom) / 2) < 4 && h1.height < 30,
      demoBar: !!document.querySelector('.demo-notice') && getComputedStyle(document.querySelector('.demo-notice')!).display !== 'none',
    };
  });
  const need = vp.height < 600 ? 0.5 : 0.55;
  expect(m.free / vp.height, `free model ${Math.round(m.free)} px of ${vp.height}`).toBeGreaterThanOrEqual(need);
  expect(m.sameRow, '«Step 1 of 7» and the H1 share one row').toBe(true);
  expect(m.demoBar, 'no demo bar over the model on phones').toBe(false);
  await expect(page.locator('#st1')).toHaveText(en.booking.zones.heading); // the H1 stays in the DOM
  // a marker from the zone list: the sheet stays in peek and names it («Marker 1 · …»)
  await page.locator('#zone-list input[type="checkbox"]').first().check();
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  const sheet = page.locator('.bsheet');
  await page.waitForTimeout(500);
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
  await expect(sheet.locator('.bsheet__title span')).toContainText(en.body3d.panel.markerTitle.split(' {n}')[0] + ' 1');
  expectClean(await g.problems(), 'F2-01 step 1');
});

test('«Back» closes the open «Booking» sheet and the help sheet — the page stays', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  const sheet = page.locator('.bsheet');
  test.skip(!(await page.locator('.bsheet__grab').isVisible()), 'no bottom sheet at this width (side panel)');
  await page.locator('.bsheet__grab').tap();
  await expect(sheet).not.toHaveAttribute('data-snap', 'peek');
  await back(page);
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
  await expect(page).toHaveURL(/\/en\/booking\/$/);
  // the help sheet («?»)
  await page.locator('.b3d-help-btn').tap();
  await expect(page.locator('dialog.sheet-dialog[open]')).toHaveCount(1);
  await back(page);
  await expect(page.locator('dialog.sheet-dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/booking\/$/);
  // closing from the UI does not leave an extra history entry: one Back leaves /booking
  await page.locator('.bsheet__grab').tap();
  await expect(sheet).not.toHaveAttribute('data-snap', 'peek');
  await page.locator('.bsheet__grab').tap();
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
  expectClean(await g.problems(), 'back closes sheets');
});

test('«Back» closes the burger menu and the cookie settings — the page stays; a menu link returns with one Back', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  const menu = page.locator('dialog.burger-dialog');
  const openMenu = page.getByRole('button', { name: en.nav.burger.open });
  // Back closes the menu
  await openMenu.tap();
  await expect(menu).toHaveAttribute('open', '');
  await back(page);
  await expect(menu).not.toHaveAttribute('open');
  await expect(page).toHaveURL(/\/en\/$/);
  // closed with «×»: no extra history entry left behind
  await openMenu.tap();
  await expect(menu).toHaveAttribute('open', '');
  await page.getByRole('button', { name: en.nav.burger.close }).tap(); // RC-8: the cross is the burger in the header, not a button inside the dialog
  await expect(menu).not.toHaveAttribute('open');
  await expect.poll(() => overlayDepth(page)).toBe(0);
  // a menu link: one Back returns to the page the menu was opened on
  await openMenu.tap();
  await menu.getByRole('link', { name: en.nav.burger.journal }).tap();
  await expect(page).toHaveURL(/\/en\/journal\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/$/);
  // cookie settings reopened from the footer
  const settings = page.getByRole('button', { name: en.footer.docs.cookies });
  await settings.scrollIntoViewIfNeeded();
  await settings.tap();
  const cookie = page.locator('section.cookie');
  await expect(cookie).toBeVisible();
  await back(page);
  await expect(cookie).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/$/);
  expectClean(await g.problems(), 'back closes menu and cookie settings');
});

test('«Back» closes the «Clear all» confirmation over the open «Booking» sheet — one overlay per Back', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await page.locator('#zone-list input[type="checkbox"]').first().check();
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  const sheet = page.locator('.bsheet');
  const phone = await page.locator('.bsheet__grab').isVisible();
  if (phone) {
    // R-FINAL-2 F2-01: a new marker leaves the sheet in peek (the model stays in view); the visitor opens it — half, then
    // full (one history entry, depth 1); fully open, «Clear all» is above the CTA bar
    await expect(sheet).toHaveAttribute('data-snap', 'peek');
    await page.locator('.bsheet__grab').focus();
    await page.keyboard.press('ArrowUp');
    await expect(sheet).toHaveAttribute('data-snap', 'half');
    await page.keyboard.press('ArrowUp');
    await expect(sheet).toHaveAttribute('data-snap', 'full');
  }
  const clear = page.getByRole('button', { name: en.body3d.panel.clearAll });
  await clear.scrollIntoViewIfNeeded();
  await clear.tap({ timeout: 10_000 });
  const confirm = page.locator('dialog.b3d-confirm');
  await expect(confirm).toHaveAttribute('open', '');
  await back(page, phone ? 2 : 1);
  await expect(confirm).not.toHaveAttribute('open');
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1); // the markers are kept
  await expect(page).toHaveURL(/\/en\/booking\/$/);
  if (phone) {
    await expect(sheet).not.toHaveAttribute('data-snap', 'peek'); // the sheet under it stays open
    await back(page, 1);
    await expect(sheet).toHaveAttribute('data-snap', 'peek');
    await expect(page).toHaveURL(/\/en\/booking\/$/);
  }
  expectClean(await g.problems(), 'back closes the confirmation');
});

test('/booking deep links: every step by direct link, Back / Forward between steps — step 1 never flashes (option A)', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await deepLinksEveryStep(page);
  expectClean(await g.problems(), 'booking deep links (phone)');
});

/**
 * R-FINAL-2 (lead): a slot on the specialist page → step 2 with ?staff&date&time, no service preset; after a service that
 * has this slot → step 4 with the slot picked («Next» active); a service without it → the calendar on that day + slotUnfit.
 * Which service fits follows the mock's own rule (lib/api getTimes).
 */
test('specialist slot → service → «Time» with that slot picked; a service without it → that day and «slotUnfit»', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/team/specialist-2/', { waitUntil: 'networkidle' });
  // RC-10 (Ж-9): the window is a link to /booking/?step=2 and nothing else — the specialist, the day and the time are
  // handed over at the tap (lib/booking/preset); a link from outside may still carry them, as the second half does
  const link = page.locator('main a[href="/en/booking/?step=2"]').first();
  await link.scrollIntoViewIfNeeded();
  const pick = async (title: string) => {
    await page.locator('label').filter({ hasText: title }).locator('input[name="service"]').first().check();
    await page.getByRole('button', { name: en.common.actions.next, exact: true }).tap();
    await page.waitForURL(/step=4/);
  };
  await link.tap();
  await page.waitForURL(/\/en\/booking\/\?step=2$/);
  const handed = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')!)) as { serviceId: number | null; staffId: number; wantDate: string; wantTime: string };
  expect(handed.serviceId, 'no default service').toBeNull();
  const staff = handed.staffId, date = handed.wantDate, time = handed.wantTime;
  expect(staff).toBeGreaterThan(0);
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(time).toMatch(/^\d{2}:\d{2}$/);
  const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const fits = (id: number) => (m / 30 + ((id + staff + Number(date.slice(-2))) % 5)) % 4 !== 0;
  const good = SERVICES.find((s) => fits(s.id))!, bad = SERVICES.find((s) => !fits(s.id))!;
  await expect(page.locator('input[name="service"]:checked')).toHaveCount(0);
  await pick(good.title.en);
  await expect(page.locator('.bk-picked')).toContainText(time);
  // N2-01: the summary names the specialist of the link (step 3 was skipped) — on step 4 and on step 5
  const staffName = STAFF.find((x) => x.id === staff)!.name.en;
  const summaryStaff = page.locator('.bk-summary dt', { hasText: en.booking.review.specialist }).locator('xpath=following-sibling::dd');
  await expect(summaryStaff).toHaveText(staffName);
  await page.getByRole('button', { name: en.common.actions.next, exact: true }).tap();
  await page.waitForURL(/step=5/);
  await expect(summaryStaff).toHaveText(staffName);
  await page.goBack();
  await page.waitForURL(/step=4/);
  await expect(page.getByRole('button', { name: en.common.actions.next, exact: true })).toBeEnabled();
  await expect(page.getByTestId('slot-unfit')).toHaveCount(0);
  // «Back» from step 4 reaches the specialist step (the skip is forward-only)
  await page.getByRole('button', { name: en.common.actions.back, exact: true }).first().tap();
  await page.waitForURL(/step=3/);
  // the same slot link, a service without that time
  await page.goto(`/en/booking/?step=2&staff=${staff}&date=${date}&time=${time}`, { waitUntil: 'networkidle' });
  await pick(bad.title.en);
  await expect(page.getByTestId('slot-unfit')).toHaveText(en.booking.time.slotUnfit);
  await expect(page.locator('.dates button[aria-pressed="true"]')).toHaveCount(1); // the calendar is on that day
  await expect(page.locator('.bk-picked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: en.common.actions.next, exact: true })).toBeDisabled();
  expectClean(await g.problems(), 'specialist slot');
});

/**
 * R-FINAL-2 part 2 (reviewer, lead): the FAB pill must never sit over a field or a button of a page form — on 30b7070 it
 * covered «Name» of the home quick form at 89 of 155 scroll positions and a tap on the field opened /booking (the flaky
 * «quick form» test). Every 40 px through the form region: a tap at the centre of each visible control lands on the control.
 */
test('FAB pill never covers a field or a button of the home quick form (every scroll position, RU and EN)', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await seedConsent(page);
  const g = guard(page, baseURL!);
  for (const locale of ['en', 'ru']) {
    await page.goto(`/${locale}/`, { waitUntil: 'networkidle' });
    const vh = page.viewportSize()!.height;
    const { top, bottom } = await page.locator('form.qform').evaluate((f) => { const b = f.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY }; });
    const hits: string[] = [];
    let positions = 0;
    for (let y = Math.max(0, Math.round(top - vh)); y <= bottom; y += 40) {
      await page.evaluate((t) => window.scrollTo({ top: t, behavior: 'instant' }), y);
      await page.waitForTimeout(250); // IntersectionObserver + the pill's 200 ms slide (no taps while it slides out)
      positions++;
      hits.push(...(await page.evaluate((sy) => {
        const fab = document.querySelector('.fab-wrap');
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('form.qform input, form.qform select, form.qform textarea, form.qform button')) {
          const b = el.getBoundingClientRect();
          const x = b.left + b.width / 2, yy = b.top + b.height / 2;
          if (!b.width || yy < 0 || yy >= innerHeight) continue;
          const hit = document.elementFromPoint(x, yy);
          if (hit && fab?.contains(hit)) out.push(`scroll ${sy}: ${el.id || el.getAttribute('type') || el.tagName} under the pill`);
        }
        return out;
      }, y)));
    }
    expect(positions, 'scroll positions checked').toBeGreaterThan(5);
    expect(hits, `/${locale}/`).toEqual([]);
  }
  // N2-04 (WCAG 2.4.11): keyboard focus scrolled into view stays above the pill — scroll-padding-bottom ≥ 12 + 52 + 12 px
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom))).toBeGreaterThanOrEqual(76);
  expectClean(await g.problems(), 'FAB over the quick form');
});

type HeroAnchor = { zoneId: string; x: number; y: number; visible: boolean; restX: number; restY: number; restVisible: boolean };
type HeroAnchors = { mode: string | null; source?: 'poster'; width: number; height: number; zones: HeroAnchor[] };
/** hero anchors in both modes (3D runtime or poster fallback) through the read-only probe of lib/body3d/anchors; since RC-5
 * the poster publishes them until the model is ready too → wait for the wanted source */
async function heroAnchors(page: Page, from: 'poster' | '3d'): Promise<HeroAnchors> {
  await page.waitForFunction(() => !!(window as unknown as { __bmAnchors?: unknown }).__bmAnchors);
  await page.evaluate(() => (window as unknown as { __bmAnchors: { watch: () => void } }).__bmAnchors.watch());
  await page.waitForFunction((f) => {
    const a = (window as unknown as { __bmAnchors: { get: () => HeroAnchors } }).__bmAnchors.get();
    return a.mode === 'hero' && a.zones.length > 0 && (a.source === 'poster') === (f === 'poster');
  }, from, { timeout: 30_000 });
  return page.evaluate(() => (window as unknown as { __bmAnchors: { get: () => HeroAnchors } }).__bmAnchors.get());
}

/**
 * Hero on phones (client, iPhone 17 Pro Max; the centring of the «model + index» group is e2e/hero.spec.ts, art director):
 * the poster fallback (no WebGL) has the same geometry as the 3D hero — same slot, every poster anchor within 3 % of the
 * slot height of the 3D rest anchor, whatever size and position the slot gets.
 */
test('hero on phones: the poster fallback has the same geometry as the 3D hero (slot and anchors)', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  await settle3D(page);
  const slot = (await page.locator('.b3d-slot[data-mode="hero"]').boundingBox())!;
  const a3 = await heroAnchors(page, '3d');
  const byId = new Map(a3.zones.map((z) => [z.zoneId, z]));
  expect(a3.zones.filter((z) => z.restVisible).length, 'front-view anchors of the 3D hero').toBeGreaterThan(5);
  // the poster fallback: same slot, same anchors (the poster IS the rest front view)
  await page.goto('/en/?debug=nowebgl', { waitUntil: 'networkidle' });
  const slot2 = (await page.locator('.b3d-slot[data-mode="hero"]').boundingBox())!;
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(slot2[k] - slot[k]), `poster slot ${k}`).toBeLessThanOrEqual(1);
  const ap = await heroAnchors(page, 'poster');
  const tol = slot.height * 0.03, off: string[] = [];
  for (const z of ap.zones) {
    const r = byId.get(z.zoneId);
    if (!r || !r.restVisible || !z.visible) continue;
    if (Math.abs(z.x - r.restX) > tol || Math.abs(z.y - r.restY) > tol) off.push(`${z.zoneId}: poster ${Math.round(z.x)},${Math.round(z.y)} vs 3D ${Math.round(r.restX)},${Math.round(r.restY)}`);
  }
  expect(off, `poster anchors vs 3D rest anchors (±${Math.round(tol)} px)`).toEqual([]);
  expectClean(await g.problems(), 'hero geometry');
});

test('Android: light only — the page opts out of forced dark (meta + CSS color-scheme «only light»)', async ({ page }, info) => {
  test.skip(!isAndroid(info.project.name), 'Android only');
  // NB: Chrome's DevTools auto-dark override (Emulation.setAutoDarkModeOverride) darkens even opted-out pages, so it cannot
  // stand in for Samsung Internet; the real check is on a Samsung device (README). Here: both opt-out signals are present.
  await seedConsent(page);
  for (const url of ['/ru/', '/ru/booking/']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    expect(await page.locator('meta[name="color-scheme"]').getAttribute('content'), url).toBe('only light');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), url).toMatch(/^(only light|light only)$/); // serialised either way
  }
});

for (const scale of [1.3, 2]) {
  test(`Android: text scaled to ${scale * 100}% — no horizontal scroll, main buttons not cut off`, async ({ page, baseURL }, info) => {
    test.skip(!isAndroid(info.project.name), 'Android only');
    await seedConsent(page);
    const g = guard(page, baseURL!);
    for (const [url, cta] of [['/ru/', '[data-track="body_open"]'], ['/ru/booking/', '.bk-cta button'], ['/ru/account/', 'form button[type="submit"]']] as const) {
      await page.goto(url, { waitUntil: 'networkidle' });
      // Chrome's «text scaling» multiplies the font size of every element, the layout width stays (px fonts included)
      await page.evaluate((k) => {
        const els = [...document.querySelectorAll<HTMLElement>('body *')];
        const sizes = els.map((el) => parseFloat(getComputedStyle(el).fontSize));
        els.forEach((el, i) => { el.style.fontSize = `${sizes[i] * k}px`; });
      }, scale);
      await page.waitForTimeout(200);
      await noHorizontalScroll(page, `${url} @ ${scale * 100}%`);
      const b = await page.locator(cta).first().boundingBox();
      expect(b, `${url}: ${cta}`).not.toBeNull();
      expect(b!.x, `${url}: ${cta} left edge`).toBeGreaterThanOrEqual(-1);
      expect(b!.x + b!.width, `${url}: ${cta} right edge`).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    expectClean(await g.problems(), `text ${scale * 100}%`);
  });
}

test('weak GPU (forced): hero keeps the poster, booking switches to 2D and still works', async ({ page, baseURL }, info) => {
  test.skip(!/moto-g4|iphone-se/.test(info.project.name), 'Moto G4 and iPhone SE');
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/ru/?debug=lowfps', { waitUntil: 'networkidle' });
  const hero = page.locator('.b3d-slot[data-mode="hero"]');
  await expect(hero).toHaveAttribute('data-fallback', 'true');
  await expect(hero.locator('.b3d-poster img')).toBeVisible();
  await page.goto('/en/booking/?debug=lowfps', { waitUntil: 'networkidle' });
  await expect(page.locator('.b3d-slot[data-mode="booking"]')).toHaveAttribute('data-mode2d', 'lowFps');
  await page.locator('#zone-list input[type="checkbox"]').first().check();
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  await page.getByRole('button', { name: en.body3d.panel.cta }).first().tap();
  await page.waitForURL(/step=2/);
  expectClean(await g.problems(), 'weak GPU');
});

/** RC-5 (lead): no word of a heading or a button is split across lines on 320–375 — every page template of the site and the landing, RU / EN
 *  («Политика конфиденциальности»: «конфиденциальности» was cut mid-word by overflow-wrap since RC-1; hyphens: auto has no
 *  Russian dictionary in Chrome on Windows). HR's RS-11: H1–H3 and buttons, 320 / 340 / 360 / 375. Once per engine; no 3D files. */
test('no word of a heading (H1–H3) or a button splits across lines or is cut by «…» on 320 / 340 / 360 / 375 (every page template, site + landing, RU / EN)', async ({ page }, ti) => {
  test.skip(!['A-iphone-se', 'A-moto-g4'].includes(ti.project.name), 'once per engine, the widths are set below');
  test.setTimeout(480_000);
  await seedConsent(page);
  await page.route('**/*.{glb,ktx2,wasm,basis}', (r) => r.abort());
  const paths = ['', 'services/', 'services/sports/', 'services/classic-infrared/', 'services/orthopedic-rehab/', 'prices/', 'team/', 'team/specialist-1/',
    'journal/', 'journal/demo-article-1/', 'contacts/', 'privacy/', 'terms/', 'booking/', 'account/', 'lp/a/', 'lp/b/', 'nope-404/'];
  const bad: string[] = [];
  for (const width of [320, 340, 360, 375]) {
    await page.setViewportSize({ width, height: 740 });
    for (const l of ['ru', 'en']) for (const p of paths) {
      await page.goto(`/${l}/${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const split = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, button, a.btn')].flatMap((h) => {
        const r = h.getBoundingClientRect();
        if (r.width < 40 || r.height < 10 || getComputedStyle(h).visibility === 'hidden') return []; // visually hidden, icon-only
        const out: string[] = []; const tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT); let n: Node | null;
        while ((n = tw.nextNode())) for (const m of (n.textContent ?? '').matchAll(/[^\s\u00a0\u00ad-]{2,}/g)) {
          const rg = document.createRange(); rg.setStart(n, m.index!); rg.setEnd(n, m.index! + m[0].length);
          if (new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size > 1) out.push(m[0]);
        }
        // and no heading or button is cut by «…» (lead, RC-5: the booking head row clipped «Mark the areas on the mod…» on 320)
        if (getComputedStyle(h).textOverflow === 'ellipsis' && h.scrollWidth > h.clientWidth + 0.5) out.push(`«${(h.textContent ?? '').trim()}» cut by an ellipsis`);
        return out.map((w) => `${h.tagName.toLowerCase()} ${w}`);
      }));
      bad.push(...split.map((w) => `${width} /${l}/${p}: «${w}»`));
    }
  }
  expect(bad).toEqual([]);
});

/**
 * DEV-16 (RC-6, lead): under reduced motion nothing on the page moves from its first frame on — every tracked box within
 * 0.5 px of the frame it first appeared in (sampled per rAF from the document's creation, 2.5 s). The old reset
 * (* { transition-duration: 120ms }, transition-property: all) turned every change of geometry — an early style pass, a
 * hydration, a cqw resize — into a 120 ms slide: the home cards and hero, the LP copy and form (bfdb925: LP 10 of 10
 * loads, home 3 of 10). Home: header, H1, the hero stage and first index row, the first cards; /booking: the 3D slot, the
 * step heading and the restored markers (a draft of 3 zones); LP: H1, the sub-line, the form's first field and fine
 * print. The project's phone, 768 and 1280; four loads each. One Chromium and one WebKit project.
 */
type GeoBox = { k: string; b: number[] };
const DEV16: { path: string; sel: string[]; draft?: boolean }[] = [
  { path: '/ru/', sel: ['.site-header', 'h1', '.atlas-stage', '.atlas-index li', '.photo', '.photo-cap'] },
  { path: '/ru/booking/', sel: ['.b3d-slot[data-mode="booking"]', '#st1', '[data-testid="b3d-marker"]'], draft: true },
  { path: '/ru/lp/a/', sel: ['#lp-h1', '.lp-copy .sub', '.lp-form input', '.lp-form .fine'] },
];
test('DEV-16 reduced motion: from the first frame nothing moves — home, /booking (slot, markers), LP (≤ 0.5 px)', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(600_000);
  const baseURL = ti.project.use.baseURL!;
  const u = ti.project.use as { viewport?: { width: number; height: number }; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean; userAgent?: string };
  // a draft with three zones, taken once from a desktop window (the zone list is a sheet on phones)
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
  const dp = await dctx.newPage();
  await seedConsent(dp);
  await dp.goto('/ru/booking/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 3; i++) await dp.locator('#zone-list input[type="checkbox"]').nth(i).click();
  await expect(dp.getByTestId('b3d-marker')).toHaveCount(3);
  const draft = await dp.evaluate(() => sessionStorage.getItem('bm.bookingDraft'));
  await dctx.close();
  expect(draft, 'the booking draft').toBeTruthy();
  const windows = [{ label: ti.project.name, opts: { viewport: u.viewport, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch, userAgent: u.userAgent } },
    { label: '768×1024', opts: { viewport: { width: 768, height: 1024 } } }, { label: '1280×800', opts: { viewport: { width: 1280, height: 800 } } }];
  const bad: string[] = [];
  for (const pg of DEV16) for (const win of windows) {
    let worst = { d: 0, what: '' }, hit = 0;
    for (let k = 0; k < 4; k++) {
      const ctx = await browser.newContext({ ...win.opts, baseURL, reducedMotion: 'reduce' });
      await ctx.addInitScript(([sel, d]) => {
        localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' }));
        if (d) sessionStorage.setItem('bm.bookingDraft', d);
        const w = window as unknown as { __g: GeoBox[][] };
        w.__g = [];
        const tick = () => {
          const f: GeoBox[] = [];
          for (const s of sel) document.querySelectorAll(s).forEach((e, i) => {
            if (i > 2) return;
            const r = e.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) f.push({ k: `${s}#${i}`, b: [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10) });
          });
          w.__g.push(f);
          if (performance.now() < 2500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, [pg.sel, pg.draft ? draft : null] as const);
      const page = await ctx.newPage();
      await page.goto(pg.path, { waitUntil: 'load' });
      await page.waitForTimeout(Math.max(0, 2600 - (await page.evaluate(() => performance.now()))));
      const F = await page.evaluate(() => (window as unknown as { __g: GeoBox[][] }).__g);
      await ctx.close();
      const first = new Map<string, number[]>();
      let d = 0, what = '';
      for (const f of F) for (const x of f) {
        const b0 = first.get(x.k);
        if (!b0) { first.set(x.k, x.b); continue; }
        x.b.forEach((v, j) => { const dd = Math.abs(v - b0[j]); if (dd > d) { d = dd; what = `${x.k} ${['x', 'y', 'w', 'h'][j]} ${b0[j]} → ${v}`; } });
      }
      if (d > 0.5) hit++;
      if (d > worst.d) worst = { d, what };
    }
    console.log(`[dev16] ${pg.path} ${win.label} reduce: moved > 0.5 px in ${hit}/4 loads (max ${worst.d.toFixed(1)} px${worst.what ? ': ' + worst.what : ''})`);
    if (hit) bad.push(`${pg.path} ${win.label}: moved up to ${worst.d.toFixed(1)} px in ${hit}/4 loads — ${worst.what}`);
  }
  // the restored-draft offer lives in the «Запись» sheet (RC-6, lead + AD): on the phone the peek row keeps its height with
  // the offer and without it, the two actions are ≥ 44 px and stay clear of the CTA bar
  const peek = async (withDraft: boolean) => {
    const ctx = await browser.newContext({ ...windows[0].opts, baseURL });
    await ctx.addInitScript((d) => { localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' })); if (d) sessionStorage.setItem('bm.bookingDraft', d); }, withDraft ? draft : null);
    const page = await ctx.newPage();
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    if (withDraft) await expect(page.locator('.bsheet__head .booking-restore--peek')).toBeVisible();
    const r = await page.evaluate(() => {
      const head = document.querySelector<HTMLElement>('.bsheet__head')!, cta = document.querySelector('.bk-cta')!.getBoundingClientRect();
      const acts = [...document.querySelectorAll('.booking-restore--peek .btn')].map((e) => e.getBoundingClientRect());
      return { h: head.getBoundingClientRect().height, acts: acts.map((x) => ({ h: x.height, bottom: x.bottom })), ctaTop: cta.top };
    });
    await ctx.close();
    return r;
  };
  if ((u.viewport?.width ?? 0) < 768) {
    const [withOffer, without] = [await peek(true), await peek(false)];
    console.log(`[dev16] /ru/booking/ ${windows[0].label} peek: ${withOffer.h} px with the offer, ${without.h} px without; actions ${withOffer.acts.map((x) => x.h).join(' / ')} px`);
    if (Math.abs(withOffer.h - without.h) > 0.5) bad.push(`peek row ${without.h} → ${withOffer.h} px with the restored-draft offer`);
    if (withOffer.acts.length !== 2 || withOffer.acts.some((x) => x.h < 44)) bad.push(`restore actions in the peek: ${JSON.stringify(withOffer.acts)} (two, ≥ 44 px)`);
    if (withOffer.acts.some((x) => x.bottom > withOffer.ctaTop + 0.5)) bad.push('a restore action overlaps the CTA bar');
  }
  expect(bad).toEqual([]);
});

/**
 * RC-7 (HR MINOR on 86e41f6): under reduced motion a 3D marker appears as it is. The * reset only shortened the pin's pop-in
 * and ring-wave animations to 0.01 ms; with fill «both» the first frame still drew the pin at scale 0.9 / opacity 0 and the
 * ring at 0.6. Checked at the moment each pin enters the DOM (MutationObserver, before any frame): no CSS animation on the
 * pin or its ::after, the pin untransformed and opaque, the ring invisible. /ru/booking/ with a 3-zone draft (3 pins).
 */
test('DEV-16 reduced motion: a 3D marker pin appears without the pop-in and the ring wave', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(120_000);
  const baseURL = ti.project.use.baseURL!;
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
  const dp = await dctx.newPage();
  await seedConsent(dp);
  await dp.goto('/ru/booking/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 3; i++) await dp.locator('#zone-list input[type="checkbox"]').nth(i).click();
  await expect(dp.getByTestId('b3d-marker')).toHaveCount(3);
  const draft = await dp.evaluate(() => sessionStorage.getItem('bm.bookingDraft'));
  await dctx.close();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL, reducedMotion: 'reduce' });
  await ctx.addInitScript((d) => {
    localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' }));
    if (d) sessionStorage.setItem('bm.bookingDraft', d);
    const w = window as unknown as { __pins: { anims: string[]; transform: string; opacity: string; ring: string; back: boolean }[] };
    w.__pins = [];
    const seen = new WeakSet<Element>();
    const check = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      const cs = getComputedStyle(el), ring = getComputedStyle(el, '::after');
      const anims = el.getAnimations({ subtree: true }).map((a) => (a as CSSAnimation).animationName ?? 'animation');
      w.__pins.push({ anims, transform: cs.transform, opacity: cs.opacity, ring: ring.opacity, back: (el as HTMLElement).dataset.back === 'true' });
    };
    new MutationObserver(() => document.querySelectorAll('.b3d-pin').forEach(check)).observe(document, { childList: true, subtree: true });
  }, draft);
  const page = await ctx.newPage();
  await page.goto('/ru/booking/', { waitUntil: 'load' });
  const mode2d = await page.locator('.b3d-slot[data-mode2d]').count();
  test.skip(mode2d > 0, 'the 2D fallback: no 3D pins on this run');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pins: unknown[] }).__pins.length), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  const pins = await page.evaluate(() => (window as unknown as { __pins: { anims: string[]; transform: string; opacity: string; ring: string; back: boolean }[] }).__pins);
  await ctx.close();
  const bad = pins.flatMap((p, i) => [
    ...(p.anims.length ? [`pin ${i + 1}: animations ${p.anims.join(', ')}`] : []),
    ...(p.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(p.transform) ? [`pin ${i + 1}: transform ${p.transform}`] : []),
    ...(p.opacity !== '1' && !p.back ? [`pin ${i + 1}: opacity ${p.opacity}`] : []), // a pin on the far side is hidden on purpose
    ...(p.ring !== '0' ? [`pin ${i + 1}: ring opacity ${p.ring}`] : []),
  ]);
  expect(bad).toEqual([]);
});

/**
 * RC-6 (lead + AD): a late web font moves nothing on the site either. Manrope delayed 800 ms: the header, the H1, the
 * first paragraph after it, the first button and chip of the first screen stay where the first frame put them (≤ 1 px),
 * sampled per rAF from the document's creation. display: optional + the calibrated fallback (styles/font-fallback.css).
 * Home, services, booking, contacts; 320 / 390 / 768 / 1280. One Chromium and one WebKit project.
 * And the site loads ONLY its own variable Manrope: in rc-6 488688c the landing's @font-face rules rode along in a CSS chunk
 * shared by both layouts under the same family name «manrope», so the site drew 400–800 with the landing's static files
 * (+70 KB) and WebKit re-laid the text out when they came after the first frame (DEV-16: the booking slot 0.5 px).
 */
type SiteBox = { k: string; b: number[] };
test('a late web font moves nothing on the site\'s first screen: header, H1, lead, first button and chip (≤ 1 px)', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(480_000);
  const baseURL = ti.project.use.baseURL!;
  const SEL = ['.site-header', 'main h1', 'main h1 ~ p', 'main .btn', 'main .chip'];
  const bad: string[] = [];
  for (const path of ['/ru/', '/ru/services/', '/ru/booking/', '/ru/contacts/']) for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, baseURL, ...(w < 768 ? { deviceScaleFactor: 2, hasTouch: true } : {}) });
    const fontFiles: string[] = [];
    ctx.on('request', (r) => { if (/\.woff2(\?|$)/.test(r.url())) fontFiles.push(new URL(r.url()).pathname.split('/').pop()!); });
    await ctx.route(/\.woff2(\?|$)/, async (route) => { const r = await route.fetch(); await new Promise((res) => setTimeout(res, 800)); await route.fulfill({ response: r }); });
    await ctx.addInitScript((sel) => {
      localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' }));
      const wnd = window as unknown as { __sf: SiteBox[][] };
      wnd.__sf = [];
      const tick = () => {
        const f: SiteBox[] = [];
        for (const sl of sel) { const e = document.querySelector(sl); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.top < innerHeight) f.push({ k: sl, b: [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10) }); }
        wnd.__sf.push(f);
        if (performance.now() < 2400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, SEL);
    const page = await ctx.newPage();
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForTimeout(Math.max(0, 2500 - (await page.evaluate(() => performance.now()))));
    const F = await page.evaluate(() => (window as unknown as { __sf: SiteBox[][] }).__sf);
    await ctx.close();
    const first = new Map<string, number[]>();
    let d = 0, what = '';
    for (const f of F) for (const x of f) {
      const b0 = first.get(x.k);
      if (!b0) { first.set(x.k, x.b); continue; }
      x.b.forEach((v, j) => { const dd = Math.abs(v - b0[j]); if (dd > d) { d = dd; what = `${x.k} ${['x', 'y', 'w', 'h'][j]} ${b0[j]} → ${v}`; } });
    }
    if (!first.size) bad.push(`${path} ${w}×${h}: nothing tracked on the first screen`);
    if (d > 1) bad.push(`${path} ${w}×${h}: moved ${d.toFixed(1)} px when the font came — ${what}`);
    const foreign = [...new Set(fontFiles.filter((f) => /^Manrope-[4678]00\.woff2$/.test(f)))];
    if (foreign.length) bad.push(`${path} ${w}×${h}: loads the landing's static font files ${foreign.join(', ')}`);
  }
  expect(bad).toEqual([]);
});

/** RC-6 (lead + AD + BD). (2) One H1 formula for every inner page, option б: min(clamp, 9.75vw − 3.7px) — /privacy sat 5 px under its
 *  neighbours on 320 (26.7 vs 31.7); its long-word safeguard ([data-word], 5 % reserve) may keep it ≤ 1.2 px lower. (3) Every
 *  first-level page («Главная / page») shows only «← Главная» below 600 (crumbs--up) — «Главная / Политика конфиденциальности» took
 *  two lines on 320. AD's conditions: the link target ≥ 44 px; from 600 px and on a second-level page without `up` (the article) the
 *  full trail. The BreadcrumbList JSON-LD is server-rendered and unchanged (seo.spec checks it). Once per engine; no 3D files. */
test('first-level pages on 320 / 340 / 360 / 375: one H1 size, its words whole, «← Home» on one line with a 44 px target; full trail from 600 and on the article (RU / EN)', async ({ page }, ti) => {
  test.skip(!['A-iphone-se', 'A-moto-g4'].includes(ti.project.name), 'once per engine, the widths are set below');
  test.setTimeout(300_000);
  await seedConsent(page);
  await page.route('**/*.{glb,ktx2,wasm,basis}', (r) => r.abort());
  const first = ['services/', 'prices/', 'team/', 'journal/', 'contacts/', 'privacy/', 'terms/', 'account/', 'account/record/'];
  const head = () => page.evaluate(() => {
    const shown = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const h1 = document.querySelector('.page-head h1')!;
    const split: string[] = []; const tw = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT); let n: Node | null;
    while ((n = tw.nextNode())) for (const m of (n.textContent ?? '').matchAll(/[^\s\u00a0\u00ad-]{2,}/g)) {
      const rg = document.createRange(); rg.setStart(n, m.index!); rg.setEnd(n, m.index! + m[0].length);
      if (new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size > 1) split.push(m[0]);
    }
    const ol = document.querySelector('.page-head .crumbs ol')!;
    const items = [...ol.querySelectorAll('a, [aria-current]')].filter(shown);
    const a = items[0] as HTMLAnchorElement | undefined; const ar = a?.getBoundingClientRect();
    return {
      fs: parseFloat(getComputedStyle(h1).fontSize), split,
      crumbs: items.map((e) => (e.textContent ?? '').trim()), olH: ol.getBoundingClientRect().height,
      href: a?.getAttribute('href') ?? '', arrow: !!a?.querySelector('.crumbs__arrow') && shown(a!.querySelector('.crumbs__arrow')!),
      target: ar ? [ar.width, ar.height] : [0, 0],
    };
  });
  const bad: string[] = [];
  for (const width of [320, 340, 360, 375]) {
    await page.setViewportSize({ width, height: 740 });
    const want = Math.min(Math.max(30, 24 + 0.024 * width), 60, 0.0975 * width - 3.7); // pages.css .page-head .h1
    for (const l of ['ru', 'en']) {
      const sizes: number[] = [];
      for (const p of first) {
        await page.goto(`/${l}/${p}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        const h = await head();
        const at = `${width} /${l}/${p}`;
        sizes.push(h.fs);
        if (h.fs > want + 0.3) bad.push(`${at}: H1 ${h.fs} px > ${want.toFixed(1)} (option б)`);
        if (h.split.length) bad.push(`${at}: H1 word split «${h.split.join('», «')}»`);
        if (h.crumbs.length !== 1 || h.href !== `/${l}/` || !h.arrow) bad.push(`${at}: crumbs «${h.crumbs.join(' / ')}» (${h.href}), arrow ${h.arrow} — want only «← Home»`);
        if (h.olH > 45) bad.push(`${at}: crumbs ${Math.round(h.olH)} px tall — more than one line`);
        if (Math.min(...h.target) < 44) bad.push(`${at}: «← Home» target ${h.target.map(Math.round).join('×')} < 44`);
      }
      if (Math.max(...sizes) < want - 0.3) bad.push(`${width} /${l}/: no H1 at the formula size ${want.toFixed(1)} (${sizes.join(', ')})`);
      if (Math.max(...sizes) - Math.min(...sizes) > 1.2) bad.push(`${width} /${l}/: H1 sizes differ by more than 1.2 px (${first.map((p, i) => `${p} ${sizes[i]}`).join(', ')})`);
    }
  }
  // the full trail from 600 px, and on a second-level page without `up` at any width
  for (const [width, p, n] of [[600, 'privacy/', 2], [768, 'services/', 2], [320, 'journal/demo-article-1/', 3], [600, 'journal/demo-article-1/', 3]] as const) {
    await page.setViewportSize({ width, height: 740 });
    for (const l of ['ru', 'en']) {
      await page.goto(`/${l}/${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);
      const h = await head();
      if (h.crumbs.length !== n || h.arrow) bad.push(`${width} /${l}/${p}: crumbs «${h.crumbs.join(' / ')}», arrow ${h.arrow} — want the full trail of ${n}`);
    }
  }
  expect(bad).toEqual([]);
});

/** RC-7 — the lines of text inside `root`: every word's box (spaces excluded, so a wrap never counts its space), grouped by line;
 *  «Демо» badges count as their pill box. Returns each line's left, right and vertical centre. Evaluated in the page. */
const LINES = `(root, skip) => {
  const boxes = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = tw.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('[hidden], .badge' + (skip ? ', ' + skip : '')) || getComputedStyle(el).visibility === 'hidden') continue;
    for (const m of (n.textContent || '').matchAll(/\\S+/g)) {
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      for (const q of rg.getClientRects()) if (q.width >= 2 && q.height >= 2) boxes.push(q);
    }
  }
  for (const b of root.querySelectorAll('.badge')) if (!b.closest('[hidden]') && b.getClientRects().length) boxes.push(b.getBoundingClientRect());
  boxes.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
  const lines = [];
  for (const q of boxes) {
    const c = (q.top + q.bottom) / 2, last = lines[lines.length - 1];
    if (last && Math.abs(c - last.c) <= 6) { last.l = Math.min(last.l, q.left); last.r = Math.max(last.r, q.right); }
    else lines.push({ l: q.left, r: q.right, c });
  }
  return lines;
}`;

/** RC-7 (lead, Brand Designer's variant B, review/design-audit-footer-text-rc6.html): the phone footer has ONE axis — it was the logo
 *  in the middle and every text row on the left edge, 132–184 px off the axis. Every row of text (group headings, link rows, the
 *  contact line and its «Демо», the language switch, «© … Демо», «Политика», «Условия · Настройки cookie») is centred within
 *  1 px; «О студии» is 3 + 2; the logo is whole, centred, min(100 %, 380 px) wide, and the SVG keeps ≥ 3.5 units of room under
 *  «MECHANIC» (viewBox +6, BD); every link and button ≥ 44 × 44; nothing runs past the screen. Once per engine; no 3D files. */
test('phone footer on 320 / 360 / 375 / 390 / 440 / 767: every text row centred (≤ 1 px), «О студии» 3 + 2, the logo whole and centred, targets ≥ 44 px (RU / EN); the wide logo whole on 768 / 1440', async ({ page }, ti) => {
  test.skip(!['A-iphone-se', 'A-moto-g4'].includes(ti.project.name), 'once per engine, the widths are set below');
  test.setTimeout(240_000);
  await seedConsent(page);
  await page.route('**/*.{glb,ktx2,wasm,basis}', (r) => r.abort());
  const bad: string[] = [];
  let svgChecked = false;
  for (const width of [320, 360, 375, 390, 440, 767]) {
    await page.setViewportSize({ width, height: 740 });
    for (const l of ['ru', 'en']) {
      await page.goto(`/${l}/contacts/`, { waitUntil: 'domcontentloaded' });
      await page.locator('.site-footer').scrollIntoViewIfNeeded();
      await page.locator('.site-footer__logo img').evaluate((img: HTMLImageElement) => img.decode().catch(() => undefined));
      await page.waitForTimeout(200);
      const r = await page.evaluate((linesSrc) => {
        const lines = (0, eval)(linesSrc) as (root: Element, skip?: string) => { l: number; r: number; c: number }[];
        const vw = document.documentElement.clientWidth, axis = vw / 2;
        const footer = document.querySelector('.site-footer')!;
        const off = lines(footer).map((q) => ({ d: (q.l + q.r) / 2 - axis, l: q.l, r: q.r }));
        const studio = [...footer.querySelectorAll('.site-footer__cols > :nth-child(2) li')].map((li) => Math.round(li.getBoundingClientRect().top));
        const rows = [...new Set(studio)].map((t) => studio.filter((x) => x === t).length);
        const img = footer.querySelector('.site-footer__logo img')!.getBoundingClientRect();
        const box = footer.querySelector('.container')!; const cs = getComputedStyle(box);
        const col = box.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const small = [...footer.querySelectorAll('a, button')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
          // the target: the element or its ::after hit area (footer links: the box is the text, the 44 px target an ::after — RC-7)
          .map((e) => ({ t: (e.textContent ?? '').trim(), w: Math.max(e.getBoundingClientRect().width, parseFloat(getComputedStyle(e, '::after').width) || 0), h: e.getBoundingClientRect().height }))
          .filter((e) => e.w < 43.5 || e.h < 43.5);
        return { vw, off, rows, img: { l: img.left, r: img.right, w: img.width, h: img.height }, col, small };
      }, LINES);
      const at = `${width} /${l}/`;
      for (const o of r.off) if (Math.abs(o.d) > 1) bad.push(`${at}: a footer row ${o.l.toFixed(1)}…${o.r.toFixed(1)} is ${o.d.toFixed(1)} px off the axis`);
      for (const o of r.off) if (o.l < -0.5 || o.r > r.vw + 0.5) bad.push(`${at}: a footer row ${o.l.toFixed(1)}…${o.r.toFixed(1)} runs past the screen`);
      if (r.rows.join('+') !== '3+2') bad.push(`${at}: «О студии» rows ${r.rows.join('+')} — want 3+2`);
      if (Math.abs((r.img.l + r.img.r) / 2 - r.vw / 2) > 1 || r.img.l < -0.5 || r.img.r > r.vw + 0.5) bad.push(`${at}: logo ${r.img.l.toFixed(1)}…${r.img.r.toFixed(1)} not whole / centred`);
      if (Math.abs(r.img.w - Math.min(r.col, 380)) > 1) bad.push(`${at}: logo ${r.img.w.toFixed(1)} px wide — want min(column ${r.col.toFixed(1)}, 380)`);
      if (Math.abs(r.img.h / r.img.w - 549.19 / 720) > 0.004) bad.push(`${at}: logo ${r.img.w.toFixed(1)}×${r.img.h.toFixed(1)} — not the 720 × 549.19 box`);
      bad.push(...r.small.map((s) => `${at}: target «${s.t}» ${s.w.toFixed(1)}×${s.h.toFixed(1)} < 44`));
      if (!svgChecked) { bad.push(...await logoRoom(page, `${at} stacked`, false)); svgChecked = true; }
    }
  }
  // ≥ 768 the wide lockup (lead, RC-7: «the logo whole» on tablets and desktop too; BD gave it the same room under the letters)
  for (const [width, height] of [[768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/ru/contacts/', { waitUntil: 'domcontentloaded' });
    await page.locator('.site-footer').scrollIntoViewIfNeeded();
    await page.locator('.site-footer__logo img').evaluate((img: HTMLImageElement) => img.decode().catch(() => undefined));
    await page.waitForTimeout(200);
    const img = await page.locator('.site-footer__logo img').evaluate((el: HTMLImageElement) => {
      const q = el.getBoundingClientRect(); return { l: q.left, r: q.right, vw: document.documentElement.clientWidth, src: el.currentSrc };
    });
    if (!/wide/.test(img.src)) bad.push(`${width}: the footer shows ${img.src}, not the wide lockup`);
    if (img.l < -0.5 || img.r > img.vw + 0.5) bad.push(`${width}: wide logo ${img.l.toFixed(1)}…${img.r.toFixed(1)} runs past the screen`);
    bad.push(...await logoRoom(page, `${width} wide`, true));
  }
  expect(bad).toEqual([]);
});

/** RC-7 (BD): the footer lockup in use (currentSrc) — its drawing inside the viewBox with ≥ 3.5 units under the letters (the round
 *  letters of «MECHANIC» ended 2 units BELOW the old box; BD's kit now adds 6) — and above them too for the wide lockup (its round
 *  letters and the emblem were cut at the top as well: −3.5 … 404.1 in 0 … 400.6; now 8 units each side) — and the width / height attributes of the picked
 *  <source> or <img> — the box reserved before the SVG loads — in the viewBox's proportion (± 0.5 px, the attributes are integers). */
async function logoRoom(page: Page, at: string, top: boolean): Promise<string[]> {
  const s = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.site-footer__logo img')!;
    const src = [...img.parentElement!.querySelectorAll('source')].find((x) => matchMedia(x.media).matches) ?? img;
    const holder = document.createElement('div'); holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:720px';
    holder.innerHTML = await (await fetch(img.currentSrc)).text(); document.body.append(holder);
    const el = holder.querySelector('svg')!; const vb = el.viewBox.baseVal; const b = el.getBBox(); holder.remove();
    return { vb: [vb.width, vb.height], b: [b.x, b.y, b.width, b.height], attr: [Number(src.getAttribute('width')), Number(src.getAttribute('height'))] };
  });
  const [vbw, vbh] = s.vb; const [bx, by, bw, bh] = s.b; const [aw, ah] = s.attr; const out: string[] = [];
  // the side edges are flush by design (BD: the wordmark spans the box) — WebKit's getBBox reads them as −0.01 … 1680.00, float
  // noise (≈ 0.007 px on a 1200 px footer), so «inside the viewBox ± 0.1» there (lead); top and bottom keep the real room (≥ 3.5)
  if (bx < -0.1 || by < (top ? 3.5 : 0) || bx + bw > vbw + 0.1 || vbh - (by + bh) < 3.5) out.push(`${at}: logo drawing ${bx.toFixed(2)},${by.toFixed(2)} … ${(bx + bw).toFixed(2)},${(by + bh).toFixed(2)} in viewBox ${vbw}×${vbh} — want inside, ≥ 3.5 units under it${top ? ' and above it' : ''}`);
  if (Math.abs(ah - (aw * vbh) / vbw) > 0.5) out.push(`${at}: logo attributes ${aw}×${ah} — the viewBox ${vbw}×${vbh} wants ${aw}×${((aw * vbh) / vbw).toFixed(2)}`);
  return out;
}

/** RC-7 (lead, BD's variant C for the hero only; AD centres the figure in rc7-ad): wherever the figure is centred under the text —
 *  phones (< 768) and the stack (768–1023, portrait ≥ 1024; lead: «otherwise a mixed axis again over the centred figure») — the
 *  first screen's text has the figure's axis: the eyebrow, every line of the H1 and the lead centred within ± 2 px; below 768 «Начать»
 *  and every line of the note, on the stack the CTA row («Начать» + the note) as one group. The atlas (figure, index, its caption,
 *  the switch and the pause) is AD's — hero.spec. Once per engine; no 3D files. */
test('hero text centred (± 2 px) on 320 / 360 / 375 / 390 / 440 / 767 and on the stack 768 / 820 / 1024 portrait: eyebrow, H1, lead, «Начать», the note (RU / EN)', async ({ page }, ti) => {
  test.skip(!['A-iphone-se', 'A-moto-g4'].includes(ti.project.name), 'once per engine, the widths are set below');
  test.setTimeout(300_000);
  await seedConsent(page);
  await page.route('**/*.{glb,ktx2,wasm,basis}', (r) => r.abort());
  const bad: string[] = [];
  for (const [width, height] of [[320, 740], [360, 740], [375, 740], [390, 740], [440, 740], [767, 740], [768, 1024], [820, 1180], [1024, 1366]]) {
    await page.setViewportSize({ width, height });
    for (const l of ['ru', 'en']) {
      await page.goto(`/${l}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const r = await page.evaluate((linesSrc) => {
        const lines = (0, eval)(linesSrc) as (root: Element) => { l: number; r: number; c: number }[];
        const axis = document.documentElement.clientWidth / 2;
        const out: { what: string; d: number }[] = [];
        const row = getComputedStyle(document.querySelector('.hero__cta')!).flexDirection === 'row'; // the stack (≥ 768): button + note side by side
        for (const sel of ['.hero__text .eyebrow', '.hero__text h1', '.hero__text .lead', ...(row ? [] : ['.hero__cta .cap'])]) {
          const el = document.querySelector(sel);
          if (!el) { out.push({ what: `${sel} missing`, d: 999 }); continue; }
          lines(el).forEach((q, i) => out.push({ what: `${sel} line ${i + 1}`, d: (q.l + q.r) / 2 - axis }));
        }
        const b = document.querySelector('.hero__cta .btn-book')!.getBoundingClientRect();
        if (row) {
          const c = document.querySelector('.hero__cta .cap')!.getBoundingClientRect();
          out.push({ what: 'CTA row «Начать» + note', d: (Math.min(b.left, c.left) + Math.max(b.right, c.right)) / 2 - axis });
        } else out.push({ what: '«Начать»', d: (b.left + b.right) / 2 - axis });
        return out;
      }, LINES);
      for (const o of r) if (Math.abs(o.d) > 2) bad.push(`${width}×${height} /${l}/: ${o.what} ${o.d.toFixed(1)} px off the axis`);
    }
  }
  expect(bad).toEqual([]);
});

/**
 * RC-10 (security review Ж-9) on the phones, WebKit included: the two entries that matter most. A link from outside —
 * the inline script of the booking page, replaceState while the HTML is parsed, the tab's storage; and the button of a
 * service page. The container stub (helpers entryProbe) must never see an address with the choice. The full set of
 * entries runs in Chrome (seo.spec).
 */
test('a choice brought into the booking is never in an address a tag reads: a link from outside and the service page (Ж-9)', async ({ page }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(90_000);
  await seedConsent(page, { analytics: true, marketing: true });
  const seen = await entryProbe(page);
  const stored = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps') ?? 'null') as { serviceId: number | null } | null);
  // 1. from outside
  await page.goto('/en/booking/?service=101&utm_source=x', { waitUntil: 'networkidle' });
  expect(new URL(page.url()).search).toBe('?utm_source=x');
  expect((await stored())?.serviceId).toBe(101);
  await expect.poll(() => seen.some((r) => r.who === 'container' && r.what === 'start')).toBe(true);
  expect(seen.filter((r) => r.who === 'container').filter(withChoice), 'the container: never, in any form').toEqual([]);
  expect(seen.filter((r) => r.who === 'page' && CHOICE_IN_URL.test(r.href)), 'the page never ends up on an address with the choice').toEqual([]);
  await page.reload({ waitUntil: 'networkidle' });
  expect(new URL(page.url()).search, 'the cleaned address does not come back').toBe('?utm_source=x');
  expect((await stored())?.serviceId).toBe(101);
  // 2. the button of a service page
  await page.evaluate(() => sessionStorage.clear());
  seen.length = 0;
  await page.goto('/en/services/manual/', { waitUntil: 'networkidle' });
  const book = page.locator('main .btn-book').first();
  await expect(book).toHaveAttribute('href', '/en/booking/');
  await book.scrollIntoViewIfNeeded();
  await book.tap();
  await page.waitForURL(/\/en\/booking\/$/);
  await expect.poll(async () => (await stored())?.serviceId ?? 0).toBeGreaterThan(0);
  expect(seen.filter(withChoice), 'no address with the choice, for the page or for the container').toEqual([]);
});
