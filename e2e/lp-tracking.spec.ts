/**
 * Landing tracking and leads (lp-brief §5, T-01…T-14 — Frontend Builder). Prototype: no real tags, no BFF — GTM gets a
 * test container id and every tracker domain is intercepted and recorded, the BFF is lib/lp/bff-mock. RC-9: the build keeps
 * no debug globals — the test container id, `?mock=` and what the stub built come through the gate's hook (helpers.ts
 * `testHook`), whose sink fills the test's own window.__lpBff / __lpLastRequest. Project «flows» (desktop Chrome) runs
 * everything; Level A phones and the in-app browsers run the device part (T-13: the consent bar on the first screen, a lead
 * with its attribution).
 */
import { createHash } from 'node:crypto';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import ru from '../messages/ru.json';
import en from '../messages/en.json';
import { guard, expectClean, fillPhone, stubStudioMap, testHook } from './helpers';

const GTM = 'GTM-LPTEST1';
const TRACKERS = /facebook\.com|facebook\.net|googletagmanager\.com|google-analytics\.com|doubleclick\.net|googleadservices\.com|google\.com\/(pagead|ccm)/;
const ALLOWED = ['event', 'lp_version', 'lang', 'placement', 'offer_id', 'event_id', 'error_type'];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const isFlows = (ti: TestInfo) => ti.project.name === 'flows';
test.beforeEach(async ({ context }) => stubStudioMap(context));

type Req = { eventId: string; consent: { marketing: boolean; details: boolean }; attribution: { utm: Record<string, string | null>; firstTouchAt: string | null; clickIds: Record<string, string | null>; fbc: string | null }; page: { url: string }; interests: string[] };
type Bff = { requests: Req[]; telegram: string[]; capi: { data: { event_name: string; event_id: string; event_source_url: string; user_data: Record<string, unknown>; custom_data: Record<string, unknown> }[] }[]; ads: Record<string, unknown>[]; comments: string[] };

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
const bff = (page: Page) => page.evaluate(() => (window as unknown as { __lpBff?: unknown }).__lpBff ?? { requests: [], telegram: [], capi: [], ads: [], comments: [] }) as Promise<Bff>;
const lastRequest = (page: Page) => page.evaluate(() => (window as unknown as { __lpLastRequest?: unknown }).__lpLastRequest) as Promise<Req>;

async function submitLead(page: Page, opts: { form?: string; name?: string; chips?: number; double?: boolean } = {}) {
  const f = page.locator(`#${opts.form ?? 'lp-f1'}`);
  await f.scrollIntoViewIfNeeded();
  await f.locator('input[name="name"]').fill(opts.name ?? 'Demo');
  await fillPhone(f.locator('input[type="tel"]'), '+971501234567');
  if (opts.chips) {
    await f.locator('summary').click();
    for (let i = 0; i < opts.chips; i++) await f.locator('.chip').nth(i).click();
    await f.locator('input[name="detailsConsent"]').check();
  }
  const btn = f.locator('button[type="submit"]');
  if (opts.double) await btn.dblclick(); else await btn.click();
  await expect(page.locator(`#${opts.form ?? 'lp-f1'} .lp-thanks`)).toBeVisible({ timeout: 10_000 });
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
    await submitLead(page); // a lead without consent: accepted, but no lp_lead (dropped, not queued)
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

  test('T-02 / T-14 / L-02: tags stored, utm_term and utm_content leave the address, all values reach the BFF and Telegram', async ({ page }) => {
    await setup(page);
    const before = Date.now();
    await page.goto('/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&utm_content=cr_a3&utm_term=kw_012&fbclid=TEST1&gclid=TEST2#lp-f1', { waitUntil: 'networkidle' });
    const search = await page.evaluate(() => location.search);
    expect(search).not.toMatch(/utm_term|utm_content/);
    expect(search).toMatch(/utm_source=meta/); expect(search).toMatch(/fbclid=TEST1/); expect(search).toMatch(/gclid=TEST2/);
    expect(await page.evaluate(() => location.hash)).toBe('#lp-f1');
    await submitLead(page);
    const r = await lastRequest(page);
    expect(r.attribution.utm).toEqual({ source: 'meta', medium: 'paid', campaign: 'lp_a_sports', content: 'cr_a3', term: 'kw_012' });
    expect(r.attribution.clickIds).toMatchObject({ fbclid: 'TEST1', gclid: 'TEST2' });
    expect(r.attribution.fbc).toMatch(/^fb\.1\.(\d+)\.TEST1$/);
    expect(Number(r.attribution.fbc!.split('.')[2])).toBeGreaterThanOrEqual(before);
    expect(r.page.url).not.toMatch(/utm_term|utm_content/);
    const tg = (await bff(page)).telegram[0];
    for (const v of ['meta', 'paid', 'lp_a_sports', 'cr_a3', 'kw_012', 'TEST1', 'TEST2']) expect(tg).toContain(v);
    // a second visit in the session: the first-visit UTM stay, the click ID is the last one
    await page.goto('/ru/lp/b/?utm_source=google&utm_medium=paid&utm_campaign=lp_a_sports&gclid=NEW3', { waitUntil: 'networkidle' });
    const a = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm_attr')!));
    expect(a.utm.source).toBe('meta');
    expect(a.clickIds.gclid).toBe('NEW3');
    expect(a.clickIds.fbclid).toBe('TEST1');
  });

  // RC-9 (lead, 12.11): today's fbclid is longer than 100 characters. Click IDs used to be cut like UTM values, and the _fbc
  // built from a cut fbclid matched no click. Up to 500 characters now, whole or not at all.
  test('a click ID longer than 100 characters stays whole (fbclid → _fbc, gclid); a value that is not an ID is dropped', async ({ page }) => {
    await setup(page);
    const FB = `IwZXh0bgNhZW0CMTEAAR${'aB3_x-9Zq'.repeat(14)}_aem_${'Kd7'.repeat(8)}`, G = `Cj0KCQiA${'x1Y-z_'.repeat(20)}`;
    expect(FB.length).toBeGreaterThan(150);
    expect(G.length).toBeGreaterThan(100);
    await page.goto(`/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&fbclid=${FB}&gclid=${G}&wbraid=%3Cscript%3E`, { waitUntil: 'networkidle' });
    await submitLead(page);
    const r = await lastRequest(page);
    expect(r.attribution.clickIds).toEqual({ fbclid: FB, gclid: G, wbraid: null, gbraid: null });
    expect(r.attribution.fbc).toMatch(new RegExp(`^fb\\.1\\.\\d{13}\\.${FB}$`));
    expect((await bff(page)).requests[0].attribution.clickIds, 'the server sample keeps them whole too').toEqual({ fbclid: FB, gclid: G, wbraid: null, gbraid: null });
  });

  // RC-9 (lead, 12.11): a returning visitor opens the landing in a NEW tab — no bm_attr there. Only when that visit brings no
  // tags of its own are the first visit's UTM taken from the bm_utm cookie (30 days, written and read only with consent); the
  // lead used to go without any UTM. A visit with its own tags is attributed to them, as before. Click IDs are never in the cookie.
  test('UTM of a lead in a new tab: (a) tags, no cookie → the tags; (b) tags and an older cookie → the tags; (c) no tags, cookie → the cookie; (d) neither → empty', async ({ browser, baseURL }) => {
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
        await submitLead(tab);
        const r = await lastRequest(tab);
        await tab.close();
        return r.attribution;
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

  test('T-14: a phrase in utm_term / utm_content is dropped (null in the lead), gone from the address and from every outgoing request', async ({ page }) => {
    const trackers = await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/?utm_source=google&utm_medium=paid&utm_campaign=lp_a_sports&utm_term=massage_lower_back&utm_content=Lower%20back%20pain', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => location.search)).not.toMatch(/utm_term|utm_content|massage|back/i);
    await submitLead(page);
    const r = await lastRequest(page);
    expect(r.attribution.utm.term).toBeNull();
    expect(r.attribution.utm.content).toBeNull();
    const all = JSON.stringify(await bff(page)) + JSON.stringify(await dataLayer(page)) + trackers.join('\n');
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

  test('T-03 / T-09: a double tap makes one lead, one Telegram message and one lp_lead with event_id = the request id', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    await submitLead(page, { double: true });
    await page.waitForTimeout(1200);
    const b = await bff(page);
    expect(b.requests).toHaveLength(1);
    expect(b.telegram).toHaveLength(1);
    const leads = await lpEvents(page, 'lp_lead');
    expect(leads).toHaveLength(1);
    expect(leads[0].event_id).toBe(b.requests[0].eventId);
    expect(b.requests[0].eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(leads[0]).toMatchObject({ lp_version: 'b', lang: 'ru', placement: 'hero', offer_id: 'first_visit_example' });
    // Telegram (§5.3): no marks without chips; the number opens WhatsApp; the page path; the short id
    const tg = b.telegram[0];
    expect(tg).toContain('версия B · RU');
    expect(tg).toContain('<a href="https://wa.me/971501234567">+971501234567</a>');
    expect(tg).toContain('Страница: /ru/lp/b/');
    expect(tg).toContain(`Номер заявки: ${b.requests[0].eventId.slice(0, 8)}`);
    expect(tg).not.toContain('Есть отметки');
  });

  test('T-03: lp_lead only after the server accepted — a server error sends none, the retry sends one', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/?mock=server', { waitUntil: 'networkidle' });
    const f = page.locator('#lp-f1');
    await f.locator('input[name="name"]').fill('Demo');
    await fillPhone(f.locator('input[type="tel"]'), '+971501234567');
    await f.locator('button[type="submit"]').click();
    await expect(f.locator('.server-err[role="alert"]')).toBeVisible();
    expect(await lpEvents(page, 'lp_lead')).toHaveLength(0);
    expect((await lpEvents(page, 'lp_form_error')).map((e) => e.error_type)).toEqual(['server']);
    await f.locator('button[type="submit"]').click(); // the mock fails once, like the site's
    await expect(page.locator('#lp-f1 .lp-thanks')).toBeVisible({ timeout: 10_000 });
    expect(await lpEvents(page, 'lp_lead')).toHaveLength(1);
    await page.evaluate(() => sessionStorage.removeItem('bm.mock'));
  });

  test('T-03 (L-09): a chip without the marks consent — the checkbox is invalid, described by the error and focused', async ({ page }) => {
    await setup(page);
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    const f = page.locator('#lp-f1');
    await f.locator('input[name="name"]').fill('Demo');
    await fillPhone(f.locator('input[type="tel"]'), '+971501234567');
    await f.locator('summary').click();
    await f.locator('.chip').first().click();
    await f.locator('button[type="submit"]').click();
    const box = f.locator('input[name="detailsConsent"]');
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(box).toBeFocused();
    const describedBy = (await box.getAttribute('aria-describedby'))!;
    await expect(page.locator(`[id="${describedBy.split(' ').pop()}"]`)).toHaveText(ru.lp.error.consentDetails);
  });

  test('T-04 / T-08: events carry only the allowed parameters; form start once, errors by type, WhatsApp with its own id and the version tag', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    await expect.poll(async () => (await lpEvents(page, 'lp_view')).length).toBe(1);
    const f = page.locator('#lp-f2');
    await f.scrollIntoViewIfNeeded();
    await f.locator('button[type="submit"]').click(); // empty: name + phone errors
    await f.locator('input[name="name"]').focus();
    expect((await lpEvents(page, 'lp_form_error')).map((e) => [e.error_type, e.placement])).toEqual([['name', 'final'], ['phone', 'final']]);
    // WhatsApp: the link ends with the version tag; a click → lp_whatsapp_click (navigation stopped in the test)
    const wa = page.locator('header a[data-track="whatsapp"]');
    expect(decodeURIComponent((await wa.getAttribute('href'))!)).toMatch(/\[LP-B\]$/);
    await page.evaluate(() => document.addEventListener('click', (e) => { if ((e.target as Element).closest('a[href^="https://wa.me/"]')) e.preventDefault(); }));
    await wa.click();
    await submitLead(page, { form: 'lp-f2' });
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

  for (const [locale, { lp }] of [['ru', ru], ['en', en]] as const) {
    test(`15.3 / ${locale}: form WhatsApp opens the original chat message`, async ({ page, context }) => {
      await setup(page, { analytics: true, marketing: false });
      await context.route('https://wa.me/**', (route) => route.fulfill({ body: 'WhatsApp intercepted' }));
      for (const id of ['lp-f1', 'lp-f2', 'lp-fs']) {
        await page.goto(`/${locale}/lp/a/${id === 'lp-fs' ? '?form=sheet' : ''}`, { waitUntil: 'networkidle' });
        if (id === 'lp-fs') await page.locator('.lp-hero-cta button').click();
        const chatLink = page.locator(`#${id}`).getByRole('link', { name: lp.form.whatsapp });
        const [chat] = await Promise.all([context.waitForEvent('page'), chatLink.click()]);
        try {
          await chat.waitForLoadState();
          const url = new URL(chat.url());
          expect(url.origin + url.pathname).toBe('https://wa.me/971585172380');
          expect([...url.searchParams]).toEqual([['text', `${lp.a.wa.message} [LP-A]`]]);
        } finally { await chat.close(); }
        const events = await lpEvents(page, 'lp_whatsapp_click');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ lp_version: 'a', lang: locale, placement: id === 'lp-f2' ? 'final' : 'hero' });
      }
    });
  }

  test('T-05 / T-06: chips, name and phone never reach dataLayer, trackers or URLs; CAPI = same event id, hashed ph / fn, no query', async ({ page }) => {
    const trackers = await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports&fbclid=FB9', { waitUntil: 'networkidle' });
    await submitLead(page, { name: 'Zelda', chips: 2 });
    const b = await bff(page);
    const r = b.requests[0];
    expect(r.interests).toHaveLength(2);
    expect(r.consent.details).toBe(true);
    const chipLabels = Object.values(ru.lp.chips);
    // dataLayer: no VALUE is a chip id, a chip label, the name or the phone (a chip id may equal a key name, e.g. «event»)
    const values = (await dataLayer(page)).flatMap((e) => Object.values(e).map(String));
    for (const v of values) for (const s of ['Zelda', '501234567', ...r.interests, ...chipLabels]) expect(v, `dataLayer value «${v}»`).not.toContain(s);
    // tracker requests and the address: no name, phone, chip label, and no chip id as a parameter value
    const outgoing = trackers.join('\n') + (await page.evaluate(() => location.href));
    for (const s of ['Zelda', '501234567', ...chipLabels]) expect(outgoing, `«${s}» must not leave`).not.toContain(s);
    for (const id of r.interests) expect(outgoing).not.toMatch(new RegExp(`=${id}\\b`));
    // Telegram: marks hidden until the lawyers answer (J-13): two lines, no chip names
    expect(b.telegram[0]).toContain('Есть отметки: да');
    for (const l of chipLabels) expect(b.telegram[0]).not.toContain(l);
    // CAPI
    const e = b.capi[0].data[0];
    const lead = (await lpEvents(page, 'lp_lead'))[0];
    expect(e.event_name).toBe('Lead');
    expect(e.event_id).toBe(r.eventId);
    expect(lead.event_id).toBe(e.event_id);
    expect(e.event_source_url).toMatch(/\/ru\/lp\/b\/$/);
    expect(e.event_source_url).not.toContain('?');
    expect(e.user_data.ph).toEqual([sha('971501234567')]);
    expect(e.user_data.fn).toEqual([sha('zelda')]);
    expect(e.user_data.fbc).toMatch(/^fb\.1\.\d+\.FB9$/);
    expect(Object.keys(e.custom_data)).toEqual(['lp_version']);
    const capi = JSON.stringify(b.capi);
    for (const s of ['Zelda', ...chipLabels, ...r.interests.map((id) => `"${id}"`)]) expect(capi).not.toContain(s);
  });

  test('T-06: without «Маркетинг» the server sends no CAPI event', async ({ page }) => {
    await setup(page, { analytics: true, marketing: false });
    await page.goto('/ru/lp/b/', { waitUntil: 'networkidle' });
    await submitLead(page);
    const b = await bff(page);
    expect(b.requests[0].consent.marketing).toBe(false);
    expect(b.capi).toEqual([]);
    expect(b.ads, 'no Google Ads upload record without «Маркетинг» (R-LP-04 F-01)').toEqual([]);
  });

  test('T-07: all Google click IDs stored; the upload carries gclid, and wbraid without gbraid — only with «Маркетинг»', async ({ page }) => {
    await setup(page, { analytics: true, marketing: true });
    await page.goto('/ru/lp/b/?gclid=G1&wbraid=W1&gbraid=B1', { waitUntil: 'networkidle' });
    await submitLead(page);
    let b = await bff(page);
    expect(b.requests[0].attribution.clickIds).toMatchObject({ gclid: 'G1', wbraid: 'W1', gbraid: 'B1' });
    expect(b.ads[0]).toMatchObject({ gclid: 'G1', wbraid: 'W1', order_id: b.requests[0].eventId, consent: { ad_user_data: 'GRANTED', ad_personalization: 'GRANTED' } });
    expect(b.ads[0]).not.toHaveProperty('gbraid');
    // only wbraid + gbraid (a fresh session)
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/ru/lp/b/?wbraid=W2&gbraid=B2', { waitUntil: 'networkidle' });
    await submitLead(page);
    b = await bff(page);
    expect(b.ads.at(-1)).toMatchObject({ wbraid: 'W2' });
    expect(b.ads.at(-1)).not.toHaveProperty('gbraid');
    expect(b.ads.at(-1)).not.toHaveProperty('gclid');
  });

  // R-LP-04 F-01 (S3 «Только необходимые», S4 «только Аналитика»): the click IDs stay in the lead, no upload record at all
  for (const [name, consent] of [['necessary only', null], ['analytics only', { analytics: true, marketing: false }]] as const) {
    test(`T-07: without «Маркетинг» (${name}) — click IDs kept in the lead, no Google Ads upload record`, async ({ page }) => {
      await setup(page, consent ?? undefined);
      await page.goto('/ru/lp/b/?gclid=G9&wbraid=W9&gbraid=B9', { waitUntil: 'networkidle' });
      if (!consent) await page.getByRole('button', { name: ru.cookie.necessaryOnly }).click();
      await submitLead(page);
      const b = await bff(page);
      expect(b.requests[0].consent.marketing).toBe(false);
      expect(b.requests[0].attribution.clickIds).toMatchObject({ gclid: 'G9', wbraid: 'W9', gbraid: 'B9' });
      expect(b.ads).toEqual([]);
      expect(b.capi).toEqual([]);
    });
  }

  test('T-09 / T-10 / T-12: queued lead, the Altegio comment with «[Сайт/LP]», nothing leaves the prototype', async ({ page }) => {
    const trackers = await setup(page);
    const api: string[] = [];
    page.on('request', (r) => { if (/\/api\//.test(r.url())) api.push(r.url()); });
    const logs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'info') logs.push(m.text()); });
    await page.goto('/ru/lp/b/?mock=queued&utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports', { waitUntil: 'networkidle' });
    await submitLead(page);
    const b = await bff(page);
    expect(b.telegram[0]).toContain('резервной очереди');
    expect(b.comments[0].startsWith('[Сайт/LP]')).toBe(true);
    expect(b.comments[0]).toContain('meta / paid / lp_a_sports');
    expect(api, 'no request to a BFF in the prototype').toEqual([]);
    expect(trackers).toEqual([]);
    expect(logs, 'RC-9 (S-1): the demo BFF prints nothing — its message goes to the gate\'s sink only').toEqual([]);
    await page.evaluate(() => sessionStorage.removeItem('bm.mock'));
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
    await submitLead(page, { name: NAME, chips: 1 }); // «спасибо» at the first try: ?mock=server did not make the stub fail
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
    await submitLead(page, { chips: 1 }); // «спасибо» at the first try: ?mock=server is not honoured
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __late: string[] }).__late), 'the late sink received nothing').toEqual([]);
    expect(gtm, 'the late container id is not read').toEqual([]);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('bm.mock'))), '?mock= is not stored').toEqual([]);
  });
});

/** T-13: every phone (Level A) and the in-app browsers — the consent bar on the first screen and a lead with its attribution */
test.describe('LP tracking on devices (T-13)', () => {
  test.beforeEach(({}, ti) => test.skip(!/^(A-|inapp-)/.test(ti.project.name), 'Level A phones and in-app browsers'));

  test('consent bar: on top, ≤ 35 % of the screen (≥ 600 px high) / ≤ 50 % (lower), the hero form button or first field stays whole and tappable; a lead carries UTM and click IDs', async ({ page, baseURL }) => {
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
    await submitLead(page);
    const r = await lastRequest(page);
    expect(r.attribution.utm).toMatchObject({ source: 'meta', campaign: 'lp_a_sports', content: 'cr_a3' });
    expect(r.attribution.clickIds).toMatchObject({ fbclid: 'FB1', gclid: 'G1' });
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
