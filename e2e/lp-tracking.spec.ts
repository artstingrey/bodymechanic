/** Landing consent, attribution and analytics for bookings and WhatsApp. */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type { BookingRecordRequest } from '../src/lib/contracts/booking-record';
import type { Attribution } from '../src/lib/lp/attr';
import ru from '../messages/ru.json';
import en from '../messages/en.json';
import { guard, expectClean, fillPhone, stubStudioMap, testHook } from './helpers';

const GTM = 'GTM-LPTEST1';
const TRACKERS = /facebook\.com|facebook\.net|googletagmanager\.com|google-analytics\.com|doubleclick\.net|googleadservices\.com|google\.com\/(pagead|ccm)/;
const ALLOWED = ['event', 'lp_version', 'lang', 'placement', 'offer_id', 'event_id', 'error_type'];
const isFlows = (ti: TestInfo) => ti.project.name === 'flows';
test.beforeEach(async ({ context }) => stubStudioMap(context));

/** tracker requests are recorded and answered locally (nothing leaves the machine); GTM gets a test id */
async function setup(page: Page, consent?: { analytics: boolean; marketing: boolean }) {
  const trackers: string[] = [];
  await page.route(TRACKERS, (r) => { trackers.push(`${r.request().method()} ${r.request().url()} ${r.request().postData() ?? ''}`); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  await testHook(page, { gtmId: GTM });
  await page.addInitScript((c) => {
    if (c) localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, ...(c as object), at: 'gate' }));
  }, consent ?? null);
  return trackers;
}
const dataLayer = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window.dataLayer ?? []).filter((x) => x && typeof x === 'object' && !('length' in (x as object)))))) as Promise<Record<string, unknown>[]>;
const lpEvents = async (page: Page, name?: string) => (await dataLayer(page)).filter((e) => typeof e.event === 'string' && (e.event as string).startsWith('lp_') && (!name || e.event === name));
const attribution = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('bm_attr')!) as Attribution);

async function stubBooking(page: Page, rejectFirst = false) {
  const serviceId = 13982356;
  const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const datetime = date + 'T14:20:00+04:00';
  const requests: BookingRecordRequest[] = [];
  await page.route('**/api/catalog/services?*', (r) => r.fulfill({ json: { data: { categories: [], services: [
    { id: serviceId, title: 'Fixture massage', description: null, categoryId: null, priceMin: null,
      priceMax: null, currency: null, durationMin: null, imageUrl: null },
  ] } } }));
  const serviceIds = [serviceId];
  await page.route('**/api/booking/staff?*', (r) => r.fulfill({ json: { data: { serviceIds, staff: [{ id: 1, name: 'Fixture specialist' }] } } }));
  await page.route('**/api/booking/dates?*', (r) => r.fulfill({ json: { data: { serviceIds, staffId: 0, dates: [date] } } }));
  await page.route('**/api/booking/times?*', (r) => r.fulfill({ json: { data: { serviceIds, staffId: 0, date, times: [{ datetime, time: '14:20' }] } } }));
  await page.route('**/api/booking/record', (r) => {
    requests.push(r.request().postDataJSON() as BookingRecordRequest);
    if (rejectFirst && requests.length === 1) {
      return r.fulfill({ status: 503, json: { error: { code: 'BOOKING_UNAVAILABLE', message: 'Fixture unavailable' } } });
    }
    return r.fulfill({ status: 201, json: { data: {
      status: 'created', recordId: 12345, serviceIds, services: [{ id: serviceId, title: 'Fixture massage' }], datetime,
    } } });
  });
  return requests;
}

async function chooseWindow(page: Page, opts: { form?: string; name?: string; chips?: number } = {}) {
  const form = page.locator('#' + (opts.form ?? 'lp-f1'));
  await form.locator('input[name="name"]').fill(opts.name ?? 'Fixture visitor');
  await fillPhone(form.locator('input[type="tel"]'), '+971501234567');
  await form.locator('input[name="email"]').fill('visitor@example.test');
  await form.getByRole('button', { name: ru.lp.booking.selectService }).click();
  await form.locator('.bk-opt input').check();
  await form.getByRole('button', { name: ru.lp.form.submit }).click();
  await form.locator('.cal button[data-available]').click();
  await form.getByRole('button', { name: '14:20', exact: true }).click();
  await form.getByRole('button', { name: ru.lp.booking.continue }).click();
  await form.locator('input[name="consent"]').check();
  if (opts.chips) {
    await form.locator('summary').click();
    for (let i = 0; i < opts.chips; i++) await form.locator('.chip').nth(i).click();
  }
  return form;
}

async function confirmBooking(page: Page, opts: Parameters<typeof chooseWindow>[1] = {}) {
  const form = await chooseWindow(page, opts);
  await form.getByRole('button', { name: ru.lp.booking.book }).click();
  await expect(form.locator('.lp-thanks')).toBeVisible();
}

test.describe('LP tracking (lp-brief §5)', () => {
  test.beforeEach(({}, ti) => test.skip(!isFlows(ti), 'logic: desktop Chrome («flows»); devices: T-13 below'));

  test('T-01 / T-11: no trackers before consent; after «Принять все» Consent Mode then GTM, not before load', async ({ page, baseURL }) => {
    const trackers = await setup(page);
    const g = guard(page, baseURL!);
    await page.goto('/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    expect(trackers, 'no tracker request before consent').toEqual([]);
    expect(await dataLayer(page), 'no dataLayer queue before consent').toEqual([]);
    await stubBooking(page);
    await confirmBooking(page);
    expect(await lpEvents(page)).toEqual([]);
    await page.getByRole('button', { name: ru.cookie.acceptAll }).click();
    await expect(page.getByTestId('lp-consent')).toHaveCount(0);
    await expect.poll(() => trackers.length).toBeGreaterThan(0);
    expect(trackers[0]).toContain(`googletagmanager.com/gtm.js?id=${GTM}`);
    const dl = await page.evaluate(() => (window.dataLayer ?? []).map((x) => (x && typeof x === 'object' && 'length' in (x as object) ? [...(x as unknown[])].slice(0, 2) : (x as { event?: string }).event)));
    const iDefault = dl.findIndex((x) => Array.isArray(x) && x[0] === 'consent' && x[1] === 'default');
    const iUpdate = dl.findIndex((x) => Array.isArray(x) && x[0] === 'consent' && x[1] === 'update');
    const iGtm = dl.indexOf('gtm.js');
    expect(iDefault, 'consent default first').toBeGreaterThanOrEqual(0);
    expect(iUpdate).toBeGreaterThan(iDefault);
    expect(iGtm, 'GTM after the consent commands').toBeGreaterThan(iUpdate);
    expect(await lpEvents(page, 'lp_view')).toHaveLength(1);
    expectClean((await g.problems()).filter((p) => !TRACKERS.test(p)), 'T-01');
  });

  test('T-11: with a stored consent GTM is requested only after the load event', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const gtm = performance.getEntriesByType('resource').find((e) => e.name.includes('googletagmanager.com'));
      return { load: nav.loadEventStart, gtm: gtm?.startTime ?? -1 };
    });
    expect(t.gtm, 'GTM requested').toBeGreaterThan(0);
    expect(t.gtm).toBeGreaterThanOrEqual(t.load);
  });

  test('T-02 / T-14 / L-02: tags stored, utm_term and utm_content leave the address, main UTM reach the booking route', async ({ page }) => {
    await setup(page);
    const before = Date.now();
    const requests = await stubBooking(page);
    await page.goto('/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&utm_content=cr_a3&utm_term=kw_012&fbclid=TEST1&gclid=TEST2#lp-f1', { waitUntil: 'networkidle' });
    const search = await page.evaluate(() => location.search);
    expect(search).not.toMatch(/utm_term|utm_content/);
    expect(search).toMatch(/utm_source=meta/); expect(search).toMatch(/fbclid=TEST1/); expect(search).toMatch(/gclid=TEST2/);
    expect(await page.evaluate(() => location.hash)).toBe('#lp-f1');
    await confirmBooking(page);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source: 'lp', utm: { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'lp_a_sports' } });
    expect(JSON.stringify(requests[0])).not.toMatch(/cr_a3|kw_012|TEST1|TEST2/);
    const captured = await attribution(page);
    expect(captured.utm).toMatchObject({ content: 'cr_a3', term: 'kw_012' });
    expect(captured.clickIds).toMatchObject({ fbclid: 'TEST1', gclid: 'TEST2' });
    expect(captured.fbclidAt).toBeGreaterThanOrEqual(before);
    // a second visit in the session: the first-visit UTM stay, the click ID is the last one
    await page.goto('/ru/lp/b/?utm_source=google&utm_medium=paid&utm_campaign=lp_a_sports&gclid=NEW3', { waitUntil: 'networkidle' });
    const a = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm_attr')!));
    expect(a.utm.source).toBe('meta');
    expect(a.clickIds.gclid).toBe('NEW3');
    expect(a.clickIds.fbclid).toBe('TEST1');
  });

  // RC-9 (lead, 12.11): today's fbclid is longer than 100 characters. Click IDs used to be cut like UTM values, and the _fbc
  // built from a cut fbclid matched no click. Up to 500 characters now, whole or not at all.
  test('a click ID longer than 100 characters stays whole (fbclid, gclid); a value that is not an ID is dropped', async ({ page }) => {
    await setup(page);
    const FB = `IwZXh0bgNhZW0CMTEAAR${'aB3_x-9Zq'.repeat(14)}_aem_${'Kd7'.repeat(8)}`, G = `Cj0KCQiA${'x1Y-z_'.repeat(20)}`;
    expect(FB.length).toBeGreaterThan(150);
    expect(G.length).toBeGreaterThan(100);
    await page.goto(`/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&fbclid=${FB}&gclid=${G}&wbraid=%3Cscript%3E`, { waitUntil: 'networkidle' });
    expect((await attribution(page)).clickIds).toEqual({ fbclid: FB, gclid: G, wbraid: null, gbraid: null });
  });

  // RC-9 (lead, 12.11): a returning visitor opens the landing in a NEW tab — no bm_attr there. Only when that visit brings no
  // tags of its own are the first visit's UTM taken from the bm_utm cookie (30 days, written and read only with consent); the
  // lead used to go without any UTM. A visit with its own tags is attributed to them, as before. Click IDs are never in the cookie.
  test('UTM in a new tab: (a) tags, no cookie → the tags; (b) tags and an older cookie → the tags; (c) no tags, cookie → the cookie; (d) neither → empty', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const FIRST = '?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&utm_content=cr_a3&fbclid=FB1';
    const LATER = '?utm_source=google&utm_medium=cpc&utm_campaign=lp_a_search&gclid=G2';
    const NONE = { source: null, medium: null, campaign: null, content: null, term: null };
    const NO_IDS = { gclid: null, gbraid: null, wbraid: null, fbclid: null };
    for (const consent of [true, false]) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
      await stubStudioMap(context);
      /** a lead from a new tab: the context's cookies and localStorage, a sessionStorage of its own */
      const leadFrom = async (query: string) => {
        const tab = await context.newPage();
        await setup(tab, { analytics: consent, marketing: false });
        await tab.goto(`/ru/lp/b/${query}`, { waitUntil: 'networkidle' });
        const captured = await attribution(tab);
        await tab.close();
        return captured;
      };
      const cookie = async () => { const c = (await context.cookies()).find((x) => x.name === 'bm_utm'); return c ? JSON.parse(decodeURIComponent(c.value)) as Record<string, string> : null; };

      // (a) tags in the address, no cookie yet → the tags of this visit
      const a = await leadFrom(FIRST);
      expect(a.utm, '(a)').toEqual({ source: 'meta', medium: 'paid', campaign: 'lp_a_sports', content: 'cr_a3', term: null });
      expect(a.firstTouchAt, '(a) the time of this visit').not.toBeNull();
      expect(a.clickIds, '(a)').toEqual({ ...NO_IDS, fbclid: 'FB1' });
      expect(await cookie(), `the bm_utm cookie, consent ${consent}`).toEqual(consent ? { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'lp_a_sports', utm_content: 'cr_a3' } : null);

      if (consent) {
        // (b) a later visit with its own tags, the older cookie is there → the tags of THIS visit (came back by a new ad);
        //     the cookie keeps the first visit (the site's booking comment reads it)
        const b = await leadFrom(LATER);
        expect(b.utm, '(b)').toEqual({ source: 'google', medium: 'cpc', campaign: 'lp_a_search', content: null, term: null });
        expect(b.firstTouchAt, '(b) the time of this visit').not.toBeNull();
        expect(b.clickIds, '(b)').toEqual({ ...NO_IDS, gclid: 'G2' });
        expect((await cookie())?.utm_source, '(b) the cookie still holds the first visit').toBe('meta');
        // (c) no tags in the address, the cookie is there → the cookie's UTM; the time of the first visit is not kept in
        //     the cookie, so it is null — never invented; no click IDs
        const c = await leadFrom('');
        expect(c.utm, '(c)').toEqual({ source: 'meta', medium: 'paid', campaign: 'lp_a_sports', content: 'cr_a3', term: null });
        expect(c.firstTouchAt, '(c) unknown stays null').toBeNull();
        expect(c.clickIds, '(c) click IDs are never in the cookie').toEqual(NO_IDS);
      } else {
        // (d) no tags and no cookie (no consent → the cookie was never written) → nothing
        const d = await leadFrom('');
        expect(d.utm, '(d)').toEqual(NONE);
        expect(d.firstTouchAt, '(d) the time of this visit').not.toBeNull();
        expect(d.clickIds, '(d)').toEqual(NO_IDS);
      }
      await context.close();
    }
  });

  test('T-14: a phrase in utm_term / utm_content is dropped from attribution, gone from the address and from every outgoing request', async ({ page }) => {
    const trackers = await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/?utm_source=google&utm_medium=paid&utm_campaign=lp_a_sports&utm_term=massage_lower_back&utm_content=Lower%20back%20pain', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => location.search)).not.toMatch(/utm_term|utm_content|massage|back/i);
    expect((await attribution(page)).utm).toMatchObject({ term: null, content: null });
    const all = JSON.stringify(await dataLayer(page)) + trackers.join('\n');
    expect(all).not.toMatch(/massage_lower_back|Lower back pain/i);
  });

  test('J-04: bm_utm cookie only with «Аналитика» or «Маркетинг», removed when withdrawn', async ({ page, context }) => {
    await setup(page);
    await page.goto('/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_b_office', { waitUntil: 'networkidle' });
    const bmUtm = async () => (await context.cookies()).find((c) => c.name === 'bm_utm');
    expect(await bmUtm()).toBeUndefined();
    await page.getByRole('button', { name: ru.cookie.customize }).click();
    await page.locator('.lp-consent input[type="checkbox"]').nth(1).check(); // Аналитика
    await page.getByRole('button', { name: ru.cookie.save }).click();
    await expect.poll(async () => (await bmUtm())?.value ?? '').toContain('lp_b_office');
    expect((await bmUtm())!.expires - Date.now() / 1000).toBeGreaterThan(29 * 24 * 3600);
    await page.evaluate(() => window.dispatchEvent(new Event('bm:cookie-settings'))); // the footer link of the site does the same
    await page.getByRole('button', { name: ru.cookie.necessaryOnly }).click();
    await expect.poll(async () => !!(await bmUtm())).toBe(false);
  });

  test('one booking confirmation emits one lp_lead with the booking key', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    const requests = await stubBooking(page);
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    const form = await chooseWindow(page);
    await form.evaluate((node) => {
      const button = node.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      button.click();
      button.click();
    });
    await expect(form.locator('.lp-thanks')).toBeVisible();
    expect(requests).toHaveLength(1);
    const leads = await lpEvents(page, 'lp_lead');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ lp_version: 'b', lang: 'ru', placement: 'hero', event_id: requests[0].idempotencyKey });
    expect(requests[0].recoveryKey).toMatch(/^[a-f0-9-]{36}$/i);
    expect(requests[0].recoveryKey).not.toBe(requests[0].idempotencyKey);
    expect(JSON.stringify(leads)).not.toContain(requests[0].recoveryKey);
  });

  test('a rejected booking keeps the details and emits no lp_lead until a successful retry', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await stubBooking(page, true);
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    const form = await chooseWindow(page, { chips: 1 });
    const note = form.locator('textarea');
    await note.fill('Fixture note');
    const submit = form.getByRole('button', { name: ru.lp.booking.book });
    await submit.click();
    await expect(form.getByRole('alert')).toHaveText(ru.home.form.feedback.unavailable);
    await expect(note).toHaveValue('Fixture note');
    await expect(form.locator('.chip').first()).toHaveAttribute('aria-pressed', 'true');
    expect(await lpEvents(page, 'lp_lead')).toHaveLength(0);
    await submit.click();
    await expect(form.locator('.lp-thanks')).toBeVisible();
    expect(await lpEvents(page, 'lp_lead')).toHaveLength(1);
  });

  test('T-04 / T-08: events carry only the allowed parameters; form start once, errors by type, WhatsApp with its own id and the version tag', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    await stubBooking(page);
    await expect.poll(async () => (await lpEvents(page, 'lp_view')).length).toBe(1);
    const f = page.locator('#lp-f2');
    await f.scrollIntoViewIfNeeded();
    await f.locator('button[type="submit"]').click(); // empty: name, phone and email errors
    await f.locator('input[name="name"]').focus();
    expect((await lpEvents(page, 'lp_form_error')).map((e) => [e.error_type, e.placement])).toEqual([['name', 'final'], ['phone', 'final'], ['email', 'final']]);
    // WhatsApp: the link ends with the version tag; a click → lp_whatsapp_click (navigation stopped in the test)
    const wa = page.locator('header a[data-track="whatsapp"]');
    expect(decodeURIComponent((await wa.getAttribute('href'))!)).toMatch(/\[LP-B\]$/);
    await page.evaluate(() => document.addEventListener('click', (e) => { if ((e.target as Element).closest('a[href^="https://wa.me/"]')) e.preventDefault(); }));
    await wa.click();
    await confirmBooking(page, { form: 'lp-f2' });
    const ev = await lpEvents(page);
    expect(ev.filter((e) => e.event === 'lp_form_start')).toHaveLength(1);
    const clickEv = ev.find((e) => e.event === 'lp_whatsapp_click')!;
    const lead = ev.find((e) => e.event === 'lp_lead')!;
    expect(clickEv).toMatchObject({ placement: 'hero', lp_version: 'b', lang: 'ru' });
    expect(clickEv.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(clickEv.event_id).not.toBe(lead.event_id);
    expect(lead.placement).toBe('final');
    for (const e of ev) expect(Object.keys(e).filter((k) => !ALLOWED.includes(k)), `${e.event}: only allowed parameters`).toEqual([]);
  });

  test('booking details and personal data stay out of analytics and URLs', async ({ page }) => {
    const trackers = await setup(page, { analytics: true, marketing: true });
    const requests = await stubBooking(page);
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    await confirmBooking(page, { name: 'Zelda', chips: 2 });
    expect(requests[0]).toMatchObject({ details: ['neckShoulders', 'lowerBack'] });
    const outsideBooking = JSON.stringify(await lpEvents(page)) + trackers.join('\n') + page.url();
    expect(outsideBooking).not.toMatch(/Zelda|501234567|visitor@example|neckShoulders|lowerBack/);
  });

  // RC-9 (security review В-2 / S-1, Ж-1 / S-3, Ж-3): the visitor's page — no hook of the gate. The lead used to stay in
  // window.__lpBff / __lpLastRequest and in the console; `?mock=` switched the stub for anyone; window.__bmGtmId chose the container
  test('a visitor\'s page: the lead leaves no name or phone in globals, the console or the storage; ?mock= and a container id set from outside do nothing', async ({ page }) => {
    const NAME = 'Zarina Testova', PHONE = '+971501234567';
    const gtm: string[] = [];
    await page.route(TRACKERS, (r) => { gtm.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    // what an outsider can do: a global before the page's scripts, the address parameter, consent given
    await page.addInitScript(() => {
      (window as unknown as { __bmGtmId: string }).__bmGtmId = 'GTM-OUTSIDE1';
      localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: true, marketing: true, at: 'gate' }));
    });
    const said: string[] = [];
    page.on('console', (m) => said.push(`${m.type()}: ${m.text()}`));
    await page.goto('/ru/lp/b/?mock=server&utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports', { waitUntil: 'networkidle' });
    await stubBooking(page);
    await confirmBooking(page, { name: NAME, chips: 1 });
    await page.waitForTimeout(500);
    const kept = await page.evaluate(() => ({
      globals: ['__bmTest', '__lpBff', '__lpLastRequest', '__lpLeads', '__bmLastComment'].filter((k) => k in window),
      storage: [sessionStorage, localStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`)),
    }));
    expect(kept.globals, 'debug globals after a lead').toEqual([]);
    expect(kept.storage.filter((kv) => kv.startsWith('bm.mock')), '?mock= is not even stored').toEqual([]);
    const digits = PHONE.replace(/\D/g, '');
    const personal = (s: string) => s.includes(NAME) || s.includes('Zarina') || s.replace(/\D/g, '').includes(digits);
    expect(kept.storage.filter(personal), 'name or phone in the storage').toEqual([]);
    expect(said.filter((l) => personal(l) || l.includes('[demo BFF]')), 'name, phone or the demo BFF in the console').toEqual([]);
    expect(gtm, 'no container: the build has no id and a global set from outside is not read').toEqual([]);
  });

  // RC-9 (Hard Reviewer): the hook is read once, with the page's own scripts. Installed later — by a tag, an extension, the
  // console — it switches nothing: no ?mock=, no container id, and the sink receives nothing
  test('the gate\'s hook installed AFTER the page\'s scripts does nothing: no ?mock=, no container id, no sink', async ({ page }) => {
    const gtm: string[] = [];
    await page.route(TRACKERS, (r) => { gtm.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: true, marketing: true, at: 'gate' })));
    await page.goto('/ru/lp/b/?mock=server', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const w = window as unknown as { __bmTest?: unknown; __late?: string[] };
      w.__late = [];
      w.__bmTest = { mock: true, gtmId: 'GTM-LATE01', sink: (channel: string) => { w.__late!.push(channel); } };
      window.dispatchEvent(new Event('bm:consent')); // the loader runs again and would take the id if it read the hook now
    });
    await stubBooking(page);
    await confirmBooking(page, { chips: 1 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __late: string[] }).__late), 'the late sink received nothing').toEqual([]);
    expect(gtm, 'the late container id is not read').toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('bm.mock'))), '?mock= is not stored').toEqual([]);
  });
});

for (const variant of ['a', 'b'] as const) {
  for (const [locale, { lp }] of [['ru', ru], ['en', en]] as const) {
    test(`WhatsApp / ${variant.toUpperCase()} / ${locale}: empty and filled hero, final and sheet`, async ({ page, context }, ti) => {
      test.skip(!['A-pixel-7', 'A-iphone-se'].includes(ti.project.name), 'one Chrome and one WebKit project');
      await setup(page, { analytics: true, marketing: false });
      await context.route('https://wa.me/**', (route) => route.fulfill({ body: 'WhatsApp intercepted' }));
      for (const id of ['lp-f1', 'lp-f2', 'lp-fs']) {
        await page.goto(`/${locale}/lp/${variant}/${id === 'lp-fs' ? '?form=sheet' : ''}`);
        await expect.poll(async () => (await lpEvents(page, 'lp_view')).length).toBe(1);
        if (id === 'lp-fs') await page.locator('.lp-hero-cta button').click();
        const form = page.locator(`#${id}`);
        const chatLink = form.getByRole('link', { name: lp.form.whatsapp });
        for (const fill of [false, true]) {
          if (fill) {
            await form.locator('input[name="name"]').fill('Анна Fixture');
            await fillPhone(form.locator('input[type="tel"]'), '+971501234567');
            await form.locator('input[name="email"]').fill('visitor@example.test');
          }
          const [chat] = await Promise.all([context.waitForEvent('page'), chatLink.click()]);
          try {
            await chat.waitForLoadState();
            const url = new URL(chat.url());
            expect(url.origin + url.pathname).toBe('https://wa.me/971585172380');
            expect([...url.searchParams]).toEqual([['text', `${lp[variant].wa.message} [LP-${variant.toUpperCase()}]`]]);
          } finally {
            await chat.close();
          }
        }
        const events = await lpEvents(page, 'lp_whatsapp_click');
        expect(events).toHaveLength(2);
        for (const event of events) {
          expect(event).toMatchObject({ lp_version: variant, lang: locale, placement: id === 'lp-f2' ? 'final' : 'hero' });
        }
      }
    });
  }
}

/** T-13: every phone (Level A) and the in-app browsers — the consent bar on the first screen and a booking with its attribution */
test.describe('LP tracking on devices (T-13)', () => {
  test.beforeEach(({}, ti) => test.skip(!/^(A-|inapp-)/.test(ti.project.name), 'Level A phones and in-app browsers'));

  test('consent bar: on top, ≤ 35 % of the screen (≥ 600 px high) / ≤ 50 % (lower), the hero form button or first field stays whole and tappable; booking carries main UTM', async ({ page, baseURL }) => {
    await setup(page);
    const g = guard(page, baseURL!);
    await page.goto('/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&utm_content=cr_a3&fbclid=FB1&gclid=G1', { waitUntil: 'networkidle' });
    const bar = page.getByTestId('lp-consent');
    await expect(bar).toBeVisible();
    const vp = page.viewportSize()!;
    const b = (await bar.boundingBox())!;
    expect(b.y, 'the consent card floats 8 px off the top (RC-8)').toBeLessThanOrEqual(9);
    // D-02, revised by the lead 07.11 (RC-2, after BD's L01: the old 30 % cut the text and the privacy link on 7 phones):
    // visible height ≥ 600 px → the bar ≤ 35 % of it; lower (SE 548, IG / FB iOS 559, FB on Moto 540, IG on SE 448,
    // 320×560) → ≤ 50 % (= max-height: 50svh). The whole text, the link and both buttons: lp.spec «consent bar: the whole…».
    const cap = vp.height >= 600 ? 0.35 : 0.5;
    expect(b.height, `consent bar ≤ ${cap * 100} % of the ${vp.width}×${vp.height} screen (D-02, RC-2)`).toBeLessThanOrEqual(vp.height * cap + 1);
    // the hero form button — or, when it sits below the first screen, the first field «Имя» (first-screen rule, RC-2) — or
    // the sheet test's hero button is not under the bar
    const button = page.locator('#lp-f1 button[type="submit"], .lp-hero [data-lp-cta]').first();
    const bb = await button.boundingBox();
    const target = bb && bb.y + bb.height <= vp.height ? button : page.locator('#lp-f1 input:not([type="hidden"])').first();
    const box = await target.boundingBox();
    if (box && box.y + box.height <= vp.height) {
      // what a tap at the centre hits: inside the consent bar = covered (a field is no button / link: ask the bar directly)
      const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest('.lp-consent') ? 'lp-consent' : e?.closest('button, a, input')?.outerHTML.slice(0, 60) ?? ''; }, [box.x + box.width / 2, box.y + box.height / 2] as const);
      expect(hit, 'the hero button / first field is not covered').not.toContain('lp-consent');
      expect(box.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
    }
    await page.getByRole('button', { name: ru.cookie.necessaryOnly }).click();
    await expect(bar).toHaveCount(0);
    const requests = await stubBooking(page);
    await confirmBooking(page);
    expect(requests[0]).toMatchObject({ utm: { utm_source: 'meta', utm_campaign: 'lp_a_sports' } });
    expect(JSON.stringify(requests[0])).not.toMatch(/cr_a3|FB1|G1/);
    expectClean((await g.problems()).filter((p) => !TRACKERS.test(p)), 'T-13 device');
  });

  test('consent settings opened: the categories get room (not the 35 / 50 % cap), all three readable by scrolling, buttons on screen', async ({ page }) => {
    await setup(page);
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: ru.cookie.customize }).click();
    const vp = page.viewportSize()!;
    const area = await page.locator('.lp-consent__scroll').evaluate((e) => e.clientHeight);
    expect(area, 'visible room for the categories').toBeGreaterThanOrEqual(Math.min(240, vp.height * 0.35));
    for (const box of await page.locator('.lp-consent input[type="checkbox"]').all()) { await box.scrollIntoViewIfNeeded(); await expect(box).toBeInViewport(); }
    for (const b of await page.locator('.lp-consent__acts .btn').all()) await expect(b).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: ru.cookie.save }).click();
    await expect(page.getByTestId('lp-consent')).toHaveCount(0);
  });
});
