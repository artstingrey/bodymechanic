/**
 * SEO and analytics (ТЗ §14):
 *  - JSON-LD on every page: valid JSON, the expected @types, never a medical type, none of the forbidden words;
 *  - canonical + hreflang ru / en / x-default, unique title / description per page and language;
 *  - sitemap.xml with language versions, robots.txt pointing to it;
 *  - dataLayer events only after consent, strictly the parameters of the §14 table; GTM (test container id) loads only after
 *    consent, never a third-party request without it;
 *  - UTM of the first visit → sessionStorage without consent, cookie for 30 days after consent → the record comment.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import en from '../messages/en.json';
import ru from '../messages/ru.json';
import { LOCALES, builtPages, templateOf, guard, expectClean, seedConsent, toReview, plainSpaces, testHook, entryProbe, withChoice, CHOICE_IN_URL, type EntrySeen } from './helpers';
import { personJsonLd } from '../src/lib/jsonld';
import { SERVICES } from '../src/lib/api/mock-data';
import { calendarDays } from '../src/lib/api';
import { BASE_ZONES, PAIRED } from '../src/lib/body3d/zones';
import { isPrivatePath } from '../src/lib/analytics/private';

const DECK = { en, ru } as const;
type Json = Record<string, unknown>;

// ---------------------------------------------------------------- HTML helpers (server HTML, no browser)
const html = async (request: APIRequestContext, url: string) => {
  const res = await request.get(url);
  expect(res.status(), url).toBe(200);
  return res.text();
};
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const tags = (doc: string, name: string) => [...doc.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const attr = (tag: string, a: string) => { const v = tag.match(new RegExp(`\\s${a}="([^"]*)"`, 'i'))?.[1]; return v === undefined ? undefined : decode(v); };
const ld = (doc: string): Json[] => [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Json);
const typesIn = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.flatMap(typesIn);
  if (!v || typeof v !== 'object') return [];
  const o = v as Json;
  return [...(typeof o['@type'] === 'string' ? [o['@type']] : []), ...Object.values(o).flatMap(typesIn)];
};

/** Expected top-level JSON-LD per route template. */
const EXPECTED: Record<string, string[]> = {
  '': ['HealthAndBeautyBusiness', 'FAQPage'],
  'contacts/': ['HealthAndBeautyBusiness', 'BreadcrumbList'],
  'services/[slug]/': ['Service', 'BreadcrumbList'],
  'team/[slug]/': ['BreadcrumbList'], // DECISION: no Person for the demo «Специалист студии N» (see the Person test)
  'journal/[slug]/': ['Article', 'BreadcrumbList'],
  'services/': ['BreadcrumbList'], 'prices/': ['BreadcrumbList'], 'team/': ['BreadcrumbList'], 'journal/': ['BreadcrumbList'],
  'privacy/': ['BreadcrumbList'], 'terms/': ['BreadcrumbList'],
  'booking/': [], 'account/': [], 'account/record/': [], 'account/record/[id]/[hash]/': [],
  'lp/[variant]/': [], // ad landing: noindex, no structured data
};
const MEDICAL_TYPE = /medical|clinic|physiotherap|hospital|physician|diagnos/i;
const FORBIDDEN = /лечени|физиотерап|диагност|diagnos|treatment|physiotherap/i; // README «Жёсткие правила»
const stripTodo = (x: string) => { const r = x.replace(/^TODO\(content\):\s*/, ''); return r === x ? x : r.charAt(0).toLocaleUpperCase() + r.slice(1); };
const PLACEHOLDER_DESCRIPTIONS = new Set([en.journal.todo.articles, ru.journal.todo.articles].flatMap((x) => [x, stripTodo(x)]));
const faqOf = (locale: 'en' | 'ru') => Object.values(DECK[locale].home.faq as Record<string, unknown>)
  .filter((v): v is { q: string; a: string } => !!v && typeof v === 'object' && 'q' in v && 'a' in v);

test('JSON-LD on every page: valid JSON, expected @types, no medical types, no forbidden words (ТЗ §14)', async ({ request }) => {
  for (const locale of LOCALES) {
    for (const p of builtPages(locale)) {
      const label = `/${locale}/${p}`;
      const doc = await html(request, label);
      const blocks = ld(doc); // throws on invalid JSON
      expect(blocks.map((b) => b['@type']), label).toEqual(EXPECTED[templateOf(p)]);
      expect(JSON.stringify(blocks), label).not.toMatch(FORBIDDEN);
      for (const t of typesIn(blocks)) expect(t, label).not.toMatch(MEDICAL_TYPE);
      const canonical = attr(tags(doc, 'link').find((l) => attr(l, 'rel') === 'canonical')!, 'href')!;
      const home = canonical.replace(/(\/(en|ru)\/).*$/, '$1');
      for (const b of blocks) {
        expect(b['@context'], label).toBe('https://schema.org');
        switch (b['@type']) {
          case 'BreadcrumbList': {
            const items = b.itemListElement as { position: number; name: string; item: string }[];
            expect(items.map((i) => i.position), label).toEqual(items.map((_, k) => k + 1));
            expect(items[0], label).toMatchObject({ name: DECK[locale].nav.breadcrumbs.home, item: home });
            expect(items.at(-1)!.item, label).toBe(canonical);
            break;
          }
          case 'HealthAndBeautyBusiness': {
            expect(b, label).toMatchObject({ name: DECK[locale].common.brand, url: home, address: { '@type': 'PostalAddress', addressLocality: 'Dubai', addressCountry: 'AE' } });
            // TODO(content) facts are not invented: present only when the client gave them (Render env)
            if ('telephone' in b) expect(b.telephone, label).toMatch(/^\+\d{7,15}$/);
            break;
          }
          case 'FAQPage': {
            const qa = (b.mainEntity as { name: string; acceptedAnswer: { text: string } }[]).map((q) => [q.name, q.acceptedAnswer.text]);
            expect(qa, label).toEqual(faqOf(locale).map((f) => [f.q, f.a]));
            expect(JSON.stringify(qa), label).not.toContain('TODO');
            break;
          }
          case 'Service': {
            const s = SERVICES.find((x) => `services/${x.slug}/` === p)!;
            expect(b, label).toMatchObject({ name: s.title[locale], url: canonical, provider: { '@type': 'HealthAndBeautyBusiness' } });
            if (s.priceOnRequest || s.priceMin == null) expect(b.offers, `${label}: «price on request» has no Offer`).toBeUndefined();
            else expect(b.offers, label).toMatchObject({ '@type': 'Offer', price: s.priceMin, priceCurrency: 'AED' });
            break;
          }
          case 'Article':
            expect(b, label).toMatchObject({ inLanguage: locale, url: canonical, headline: expect.stringMatching(/\S/), publisher: { '@type': 'HealthAndBeautyBusiness' } });
            if (b.description !== undefined) expect(b.description, `${label}: no placeholder in structured data`).not.toMatch(/^TODO/);
            break;
        }
      }
    }
  }
});

test('Person JSON-LD only for real staff — none for the demo «Специалист студии N» (DECISION)', () => {
  const staff = { id: 1, name: 'Test Person', position: 'Test position', avatarUrl: null, rating: null, nearestSlot: null, slug: 'test-person' };
  expect(personJsonLd('en', { ...staff, placeholder: true }, 'The Body Mechanic')).toBeNull();
  expect(personJsonLd('en', { ...staff, placeholder: false }, 'The Body Mechanic')).toMatchObject({
    '@type': 'Person', name: 'Test Person', jobTitle: 'Test position', url: expect.stringMatching(/\/en\/team\/test-person\/$/), worksFor: { '@type': 'HealthAndBeautyBusiness' },
  });
});

test('meta: one canonical, hreflang ru / en / x-default, unique title and description per page and language', async ({ request }) => {
  const origins = new Set<string>();
  for (const locale of LOCALES) {
    const titles = new Map<string, string>(), descriptions = new Map<string, string>();
    for (const p of builtPages(locale)) {
      const label = `/${locale}/${p}`;
      const doc = await html(request, label);
      const links = tags(doc, 'link');
      const canon = links.filter((l) => attr(l, 'rel') === 'canonical').map((l) => attr(l, 'href')!);
      expect(canon, label).toHaveLength(1);
      const url = new URL(canon[0]);
      origins.add(url.origin);
      const canonicalPath = templateOf(p) === 'account/record/[id]/[hash]/' ? 'account/record/' : p;
      expect(url.pathname, label).toBe(`/${locale}/${canonicalPath}`);
      const alt = Object.fromEntries(links.filter((l) => attr(l, 'rel') === 'alternate' && attr(l, 'hreflang')).map((l) => [attr(l, 'hreflang'), attr(l, 'href')]));
      expect(alt, label).toEqual({ ru: `${url.origin}/ru/${canonicalPath}`, en: `${url.origin}/en/${canonicalPath}`, 'x-default': `${url.origin}/en/${canonicalPath}` });
      const title = decode(doc.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
      const description = attr(tags(doc, 'meta').find((m) => attr(m, 'name') === 'description') ?? '', 'content') ?? '';
      expect(title, label).not.toBe('');
      expect(description, label).not.toBe('');
      expect(`${title} ${description}`, label).not.toMatch(FORBIDDEN);
      if (p.startsWith('account/record/')) continue; // private record links share the «Мои записи» meta on purpose
      expect(titles.get(title), `${label}: title also on`).toBeUndefined();
      // the demo articles share the deck's content placeholder (journal.todo.articles, shown without the «TODO(content):»
      // prefix — components/ui/Todo stripTodo) as excerpt → known until the CMS (reported)
      if (!PLACEHOLDER_DESCRIPTIONS.has(description)) expect(descriptions.get(description), `${label}: description also on`).toBeUndefined();
      titles.set(title, label); descriptions.set(description, label);
      const og = tags(doc, 'meta').find((m) => attr(m, 'property') === 'og:image');
      // RC-9 (C-1): the ad landings have their own card per version (the site card names services they must not), lp.spec
      const lp = /^lp\/(a|b)\/$/.exec(p);
      expect(attr(og ?? '', 'content'), label).toBe(`${url.origin}/og/${lp ? `og-lp-${lp[1]}-${locale}` : `og-template-${locale}`}.png`);
    }
  }
  expect([...origins], 'one origin for every canonical').toHaveLength(1);
});

test('sitemap.xml: every public page in both languages with ru / en / x-default; robots.txt points to it', async ({ request }) => {
  const xml = await html(request, '/sitemap.xml');
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: m[1].match(/<loc>(.*?)<\/loc>/)![1],
    alt: Object.fromEntries([...m[1].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((a) => [a[1], a[2]])),
  }));
  const origin = new URL(urls[0].loc).origin;
  const expected = LOCALES.flatMap((l) => builtPages(l).filter((p) => !p.startsWith('account/') && !p.startsWith('lp/')).map((p) => `${origin}/${l}/${p}`));
  expect(urls.map((u) => u.loc).sort()).toEqual(expected.sort());
  for (const u of urls) {
    const p = u.loc.slice(origin.length).replace(/^\/(en|ru)\//, '');
    expect(u.alt, u.loc).toEqual({ ru: `${origin}/ru/${p}`, en: `${origin}/en/${p}`, 'x-default': `${origin}/en/${p}` });
  }
  const robots = await html(request, '/robots.txt');
  expect(robots).toMatch(/Disallow:\s*\/\s*$/im); // prototype: closed (DEL-13)
  expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
});

// ---------------------------------------------------------------- analytics (browser)
const GTM_TEST_ID = 'GTM-GATE01';
/** Strict parameters of the §14 table (value of booking_success is optional: «price on request»). */
const TABLE: Record<string, { required: string[]; optional?: string[] }> = {
  body_open: { required: [] },
  body_model_switch: { required: ['model'] },
  body_marker_add: { required: ['marker_count', 'step', 'model'] }, // no zone (D-01, M7)
  booking_step: { required: ['step', 'source'] },
  booking_success: { required: ['service_id', 'staff_id', 'currency', 'source'], optional: ['value'] },
  booking_error: { required: ['reason'] },
  account_login: { required: [] },
  booking_cancel: { required: [] },
  booking_reschedule: { required: [] },
  contact_click: { required: ['channel'] },
};

/** dataLayer as plain data: events (objects with `event`, GTM's own gtm.* excluded) and gtag commands (Arguments). */
async function dataLayer(page: Page) {
  return page.evaluate(() => {
    const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    if (!dl) return null;
    const events: Record<string, unknown>[] = [], commands: unknown[][] = [];
    for (const e of dl) {
      if (e && typeof e === 'object' && typeof (e as { length?: unknown }).length === 'number') commands.push(Array.from(e as ArrayLike<unknown>));
      else if (e && typeof e === 'object' && 'event' in e && !String((e as { event: unknown }).event).startsWith('gtm.')) events.push({ ...(e as Record<string, unknown>) });
    }
    return { events, commands };
  });
}
function expectTable(events: Record<string, unknown>[]) {
  for (const e of events) {
    const spec = TABLE[String(e.event)];
    expect(spec, `unknown event ${String(e.event)}`).toBeDefined();
    const keys = Object.keys(e).filter((k) => k !== 'event').sort();
    for (const k of spec.required) expect(keys, `${String(e.event)} needs ${k}`).toContain(k);
    for (const k of keys) expect([...spec.required, ...(spec.optional ?? [])], `${String(e.event)}: extra parameter ${k}`).toContain(k);
  }
}
/**
 * Test container id for the loader (through the gate's hook, RC-9 Ж-3 — a plain global is no longer read) + GTM answered
 * locally; WhatsApp links do not leave the page (the click still counts).
 */
async function analyticsPage(page: Page) {
  const gtm: string[] = [];
  await testHook(page, { gtmId: GTM_TEST_ID });
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (a && /^https:\/\/wa\.me\//.test(a.getAttribute('href') || '')) e.preventDefault();
    }, true);
  });
  await page.route(/googletagmanager\.com/, (r) => { gtm.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  return gtm;
}
const zoneBox = (page: Page, i: number) => page.locator('#zone-list input[type="checkbox"]').nth(i);
/** keyboard instead of a click: the cookie card may cover the list while no choice is made */
async function toggleZone(page: Page, i: number) { await zoneBox(page, i).focus(); await page.keyboard.press('Space'); }

test.describe('analytics (ТЗ §14)', () => {
  test('without consent: dataLayer untouched, no GTM, no third-party request — also after «Essential only»', async ({ page, baseURL }) => {
    const gtm = await analyticsPage(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('dialog', { name: en.cookie.dialogLabel })).toBeVisible();
    await page.getByRole('button', { name: en.body3d.model.female, exact: true }).click();
    await page.locator('[data-track="body_open"]').click();
    await page.waitForURL(/\/en\/booking\/$/);
    await toggleZone(page, 0);
    await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
    expect(await dataLayer(page)).toBeNull();
    await page.getByRole('button', { name: en.cookie.necessaryOnly }).click();
    await toggleZone(page, 1);
    await expect(page.getByTestId('b3d-marker')).toHaveCount(2);
    expect(await dataLayer(page)).toBeNull();
    expect(gtm).toEqual([]);
    expectClean(await g.problems(), 'analytics without consent');
  });

  test('«Accept all» → Consent Mode + GTM once; 3D booking events with the §14 parameters', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const gtm = await analyticsPage(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/', { waitUntil: 'networkidle' });
    expect(gtm).toEqual([]);
    await page.getByRole('button', { name: en.cookie.acceptAll }).click();
    await expect.poll(() => gtm.length).toBe(1);
    expect(gtm[0]).toBe(`https://www.googletagmanager.com/gtm.js?id=${GTM_TEST_ID}`);
    const before = (await dataLayer(page))!;
    expect(before.commands).toEqual([
      ['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 }],
      ['consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }],
    ]);
    expect(before.events).toEqual([]); // nothing from before the consent is replayed

    await page.getByRole('button', { name: en.body3d.model.female, exact: true }).click();
    await page.locator('[data-track="body_open"]').click();
    await page.waitForURL(/\/en\/booking\/$/);
    await zoneBox(page, 0).check();
    await toReview(page, { zones: 0 });
    await page.getByRole('button', { name: en.booking.review.confirm }).click();
    await page.waitForURL(/step=7/);
    await page.getByRole('link', { name: en.booking.done.whatsapp }).click();

    const { events } = (await dataLayer(page))!;
    expectTable(events);
    const success = events.find((e) => e.event === 'booking_success')!;
    const svc = SERVICES.find((s) => s.id === success.service_id)!;
    expect(svc, 'service_id is a catalogue id').toBeDefined();
    expect(events).toEqual([
      { event: 'body_model_switch', model: 'female' },
      { event: 'body_open' },
      { event: 'booking_step', step: 1, source: '3d' },
      { event: 'body_marker_add', marker_count: 1, step: 1, model: 'female' },
      ...[2, 3, 4, 5, 6].map((step) => ({ event: 'booking_step', step, source: '3d' })),
      { event: 'booking_success', service_id: svc.id, staff_id: 0, ...(svc.priceOnRequest || svc.priceMin == null ? {} : { value: svc.priceMin }), currency: 'AED', source: '3d' },
      { event: 'booking_step', step: 7, source: '3d' },
      { event: 'contact_click', channel: 'whatsapp' },
    ]);
    expect(gtm, 'the container loads once').toHaveLength(1);
    expectClean((await g.problems()).filter((p) => !p.includes(`googletagmanager.com/gtm.js?id=${GTM_TEST_ID}`)), 'analytics with consent');
  });

  test('booking_error reason network (data step fails)', async ({ page, baseURL }) => {
    await seedConsent(page, { analytics: true, marketing: false });
    await testHook(page); // ?mock= is the gate's only (RC-9, S-3)
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?mock=offline', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: en.body3d.panel.skip }).click();
    await page.locator('input[name="service"]').first().check();
    await page.getByRole('button', { name: en.common.actions.next }).click();
    await expect(page.locator('.booking-error')).toContainText(en.booking.error.network);
    const { events } = (await dataLayer(page))!;
    expectTable(events);
    expect(events.filter((e) => e.event === 'booking_error')).toEqual([{ event: 'booking_error', reason: 'network' }]);
    expectClean(await g.problems(), 'booking_error');
  });

  test('booking_error reason slot_taken; «Marketing» alone also measures (Consent Mode: analytics denied)', async ({ page, baseURL }) => {
    await seedConsent(page, { analytics: false, marketing: true }); // marketing alone also measures (Meta Pixel)
    await testHook(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?mock=slot_taken', { waitUntil: 'networkidle' });
    await toReview(page, { zones: 1 });
    await page.getByRole('button', { name: en.booking.review.confirm }).click();
    await page.waitForURL(/step=4/);
    const dl = (await dataLayer(page))!;
    expect(dl.commands[1]).toEqual(['consent', 'update', { analytics_storage: 'denied', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }]);
    expect(dl.events.filter((e) => e.event === 'booking_error')).toEqual([{ event: 'booking_error', reason: 'slot_taken' }]);
    expectClean(await g.problems(), 'slot_taken');
  });

  // RC-9 (security review В-3 / S-2): the account's addresses are personal — /account/record/{id}/{hash}/ opens a record
  // without a login — so there is no tag manager and no event there, whatever the consent (lib/analytics/private). The
  // §14 events account_login, booking_reschedule, booking_cancel are no longer sent.
  test('«Мои записи»: no container and no events on the account pages; an account address never shares a document with a public page — way in, way out, reload and «Назад»', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const gtm = await analyticsPage(page);
    await seedConsent(page, { analytics: true, marketing: true });
    const g = guard(page, baseURL!);
    let mark = 0; // a new number per mark: a document restored from the back / forward cache carries an older one
    const sameDocument = () => page.evaluate((m) => (window as unknown as { __doc?: number }).__doc === m, mark);
    const markDocument = () => page.evaluate((m) => { (window as unknown as { __doc?: number }).__doc = m; }, ++mark);
    // 1. the account itself — login, reschedule, cancel: nothing is measured
    await page.goto('/en/account/', { waitUntil: 'networkidle' });
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    await page.locator('#acc-phone').fill('+971501234567');
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await page.locator('input[autocomplete="one-time-code"]').fill('1234');
    await page.getByRole('button', { name: en.account.login.submit }).click();
    const first = page.getByTestId('account-record').first();
    await first.getByRole('button', { name: en.account.action.reschedule }).click();
    // a day ≥ 3 days ahead (as states.spec): «tomorrow 10:30» falls within 24 h in the afternoon → cancelling online is
    // already too late and the cancel below never happens (the test failed by the clock, not by the site)
    await first.locator('.dates button:not([aria-disabled])').nth(3).click();
    await first.locator('.times button').first().click();
    await first.getByRole('button', { name: en.account.reschedule.confirm }).click();
    await expect(first.getByRole('status')).toBeVisible();
    await first.getByRole('button', { name: en.account.action.cancel }).click();
    await first.locator('dialog.account-cancel').getByRole('button', { name: en.account.cancel.confirm }).click();
    await expect(first).toContainText(en.account.status.cancelled);
    expect(await dataLayer(page), 'no dataLayer on /account/').toBeNull();
    expect(gtm, 'no container on /account/').toEqual([]);

    // 2. the record link: the pre-rendered demo record and any other id / hash (the hosting rewrite → the generic page)
    for (const url of ['/en/account/record/9001/demo-hash/', '/ru/account/record/777/zzz/']) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await expect(page.locator('meta[name="referrer"]'), `${url}: the address never travels as a referrer`).toHaveAttribute('content', 'no-referrer');
      expect(await dataLayer(page), `no dataLayer on ${url}`).toBeNull();
    }
    expect(gtm, 'no container on a record link').toEqual([]);

    // 3. the way OUT is a full page load too (Hard Reviewer, RC-9): history entries made by one document stay
    //    «same-document» even after a reload — record link → logo (client-side) → F5 → «Назад» was a popstate inside the
    //    reloaded public document: the record address under a live container. Now the logo opens a NEW document, and
    //    «Назад» from it loads the record page as a document of its own, without the container.
    const record = /\/en\/account\/record\/9001\/demo-hash\/$/;
    await page.goto('/en/account/record/9001/demo-hash/', { waitUntil: 'networkidle' });
    await markDocument();
    await page.locator('a.site-logo').click();
    await page.waitForURL(/\/en\/$/);
    await page.waitForLoadState('networkidle');
    expect(await sameDocument(), 'leaving the account by the logo = a new document').toBe(false);
    await expect.poll(() => gtm.length, 'the public page has the container').toBe(1);
    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(() => gtm.length, 'and again after the reload').toBe(2);
    await markDocument();
    await page.goBack({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(record);
    expect(await sameDocument(), '«Назад» to the record address = another document, not a popstate inside the public one').toBe(false);
    expect(await dataLayer(page), 'no dataLayer on the record address after «Назад»').toBeNull();
    expect(gtm, 'no container request on the record address').toHaveLength(2);
    // the other ways out go the same way: a menu link (replaces the menu's history entry) and «Book again» of a card
    await markDocument();
    await page.locator('.site-header .burger').click();
    await page.locator('#burger-dialog nav a').first().click();
    await page.waitForURL(/\/en\/services\/$/);
    await page.waitForLoadState('networkidle');
    expect(await sameDocument(), 'leaving the account by a menu link = a new document').toBe(false);
    await page.goBack({ waitUntil: 'networkidle' });
    await expect(page, 'one «Назад» returns to the record page under the menu').toHaveURL(record);
    expect(await dataLayer(page)).toBeNull();
    await page.goto('/en/account/', { waitUntil: 'networkidle' });
    await page.locator('#acc-phone').fill('+971501234567');
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await page.locator('input[autocomplete="one-time-code"]').fill('1234');
    await page.getByRole('button', { name: en.account.login.submit }).click();
    await markDocument();
    await page.getByRole('link', { name: en.common.actions.bookAgain }).first().click();
    await page.waitForURL(/\/en\/booking\/$/); // RC-10, Ж-9: the service and the specialist are handed over, not in the address
    await page.waitForLoadState('networkidle');
    expect(await sameDocument(), '«Book again» = a new document').toBe(false);

    // 4. the way in: a public page with the container loaded → «My bookings» in the menu is a full page load (a container
    //    cannot be unloaded), and it replaces the menu's history entry as the client-side link did: one «Назад» → the page
    const before = gtm.length;
    await page.goto('/en/', { waitUntil: 'networkidle' });
    await expect.poll(() => gtm.length, 'the container loads on a public page').toBe(before + 1);
    const loaded = gtm.length;
    await markDocument();
    await page.locator('.site-header .burger').click();
    await page.locator('#burger-dialog a.acct').click();
    await page.waitForURL(/\/en\/account\/$/);
    await page.waitForLoadState('networkidle');
    expect(await sameDocument(), 'a new document for the account').toBe(false);
    expect(await dataLayer(page), 'no dataLayer in the account after the menu link').toBeNull();
    expect(gtm, 'no container request from the account').toHaveLength(loaded);
    await page.goBack({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('#burger-dialog')).not.toHaveAttribute('open', '');
    expectClean((await g.problems()).filter((p) => !p.includes(`googletagmanager.com/gtm.js?id=${GTM_TEST_ID}`)), 'account without analytics');
  });
});

// ---------------------------------------------------------------- UTM
test.describe('UTM of the first visit (ТЗ §14 → §08)', () => {
  const UTM = '?utm_source=google&utm_medium=cpc&utm_campaign=sports_massage&utm_content=hero&ref=x';
  const LINE = 'UTM: google / cpc / sports_massage / hero';
  const TAGS = { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'sports_massage', utm_content: 'hero' };

  test('without consent: session only, no cookie — still in the 3D booking comment; the first visit wins', async ({ page, context, baseURL }) => {
    await seedConsent(page); // essential only (lead: attribution is not strictly necessary)
    await testHook(page); // the record comment reaches the gate through its sink only (RC-9, S-1)
    const g = guard(page, baseURL!);
    await page.goto(`/en/${UTM}`, { waitUntil: 'networkidle' });
    expect((await context.cookies()).find((c) => c.name === 'bm_utm'), 'no cookie without consent').toBeUndefined();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.utm') || 'null'))).toEqual(TAGS);
    await page.goto('/en/services/?utm_source=newsletter&utm_campaign=other', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.utm') || 'null')), 'a later visit does not overwrite').toEqual(TAGS);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await toReview(page, { zones: 1 });
    await page.getByRole('button', { name: en.booking.review.confirm }).click();
    await page.waitForURL(/step=7/);
    const comment = await page.evaluate(() => (window as unknown as { __bmLastComment?: string }).__bmLastComment);
    expect(comment).toMatch(/^\[Сайт\/3D\] /);
    expect(comment!.split('\n').at(-1)).toBe(LINE);
    expect((await context.cookies()).find((c) => c.name === 'bm_utm')).toBeUndefined();
    expectClean(await g.problems(), 'utm without consent');
  });

  test('consent → cookie for 30 days with the first-visit tags; consent withdrawn → cookie removed', async ({ page, context, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto(`/en/${UTM}`, { waitUntil: 'networkidle' });
    expect((await context.cookies()).find((c) => c.name === 'bm_utm')).toBeUndefined();
    await page.getByRole('button', { name: en.cookie.acceptAll }).click();
    const cookie = async () => (await context.cookies()).find((c) => c.name === 'bm_utm');
    await expect.poll(async () => !!(await cookie())).toBe(true);
    const c = (await cookie())!;
    expect(JSON.parse(decodeURIComponent(c.value))).toEqual(TAGS);
    const days = (c.expires * 1000 - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect([c.path, c.sameSite]).toEqual(['/', 'Lax']);
    // «Cookie settings» → essential only: the cookie goes, the session copy stays for this session's booking
    await page.evaluate(() => {
      localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'gate' }));
      window.dispatchEvent(new Event('bm:consent'));
    });
    await expect.poll(async () => !!(await cookie())).toBe(false);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.utm') || 'null'))).toEqual(TAGS);
    expectClean(await g.problems(), 'utm consent');
  });

  test('the visitor is told: UTM note in the cookie settings, the UTM clause in the privacy policy (lead)', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/ru/privacy/', { waitUntil: 'networkidle' });
    const clause = page.locator('.doc-clause');
    await expect(clause).toContainText(ru.docs.privacy.clause.utm);
    // RC-4 (lead): the clause waits for the lawyers (J-04) without a public «Черновик» pill — the mark stays in data-draft for QA
    await expect(clause).toHaveAttribute('data-draft', '');
    await expect(clause.locator('.badge')).toHaveCount(0);
    await page.getByRole('button', { name: ru.cookie.customize }).click();
    await expect(page.getByRole('dialog', { name: ru.cookie.dialogLabel })).toContainText(ru.cookie.utmNote);
    expectClean(await g.problems(), 'utm wording');
  });

  test('home form: [Сайт/форма] comment with the UTM line, booking_success source form', async ({ page, baseURL }) => {
    await seedConsent(page, { analytics: true, marketing: false });
    await testHook(page);
    const g = guard(page, baseURL!);
    await page.goto(`/en/${UTM}`, { waitUntil: 'networkidle' });
    const form = page.locator('form.qform');
    await form.locator('input[name="name"]').fill('Demo');
    await form.locator('input[name="phone"]').fill('+971500000000');
    await form.locator('select[name="service"]').selectOption({ index: 1 });
    const day = form.locator('select').nth(2);
    await expect(day).toBeEnabled();
    await day.selectOption({ index: 1 });
    await expect(form.locator('select[name="datetime"]')).toBeEnabled();
    await form.locator('input[type="checkbox"]').check();
    await form.getByRole('button', { name: en.home.form.submit }).click();
    await expect(page.getByRole('status').filter({ hasText: en.booking.done.title })).toBeVisible();
    const comment = await page.evaluate(() => (window as unknown as { __bmLastComment?: string }).__bmLastComment);
    expect(comment).toMatch(/^\[Сайт\/форма\]/);
    expect(comment!.split('\n').at(-1)).toBe(LINE);
    const { events } = (await dataLayer(page))!;
    expectTable(events);
    const success = events.filter((e) => e.event === 'booking_success');
    expect(success).toHaveLength(1);
    const svc = SERVICES.find((s) => s.id === success[0].service_id)!;
    expect(svc).toBeDefined();
    expect(success[0]).toEqual({ event: 'booking_success', service_id: svc.id, staff_id: 0, ...(svc.priceOnRequest || svc.priceMin == null ? {} : { value: svc.priceMin }), currency: 'AED', source: 'form' });
    expectClean(await g.problems(), 'utm form');
  });
});

/**
 * D-01 / D-08 (lead 2026-11-07, rule M7): a full booking with zones, marker notes, a general note and contacts — no event in
 * dataLayer carries a zone, a complaint text, a note, a name, a phone, an e-mail or a service title / slug; IDs are numbers.
 */
test('dataLayer carries no health data: no zones, notes, contacts or service names; service_id / staff_id are numbers', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await seedConsent(page, { analytics: true, marketing: true });
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await zoneBox(page, 0).check();
  await zoneBox(page, 5).check();
  const NOTE = 'sharp pain after deadlift', GENERAL = 'old knee injury from skiing';
  await page.locator('textarea[maxlength="300"]').first().fill(NOTE); // the first marker's note
  await page.locator('textarea[maxlength="1000"]').fill(GENERAL);
  await toReview(page, { zones: 0 });
  await page.getByRole('button', { name: en.booking.review.confirm }).click();
  await page.waitForURL(/step=7/);
  const events = await page.evaluate(() => ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [])
    .filter((x) => x && typeof x === 'object' && !('length' in (x as object)) && typeof (x as { event?: unknown }).event === 'string' && !String((x as { event: string }).event).startsWith('gtm.'))) as Record<string, unknown>[];
  expect(events.some((e) => e.event === 'body_marker_add')).toBe(true);
  expect(events.some((e) => e.event === 'booking_success')).toBe(true);
  const zones = BASE_ZONES.flatMap((z) => (PAIRED.has(z) ? [z, `${z}_l`, `${z}_r`] : [z]));
  const forbidden = [NOTE, GENERAL, 'Demo', '500000000', ...SERVICES.flatMap((sv) => [sv.title.en, sv.title.ru, sv.slug, sv.key])];
  for (const e of events) {
    for (const [k, v] of Object.entries(e)) {
      if (k === 'event') continue;
      if (k.endsWith('_id') && k !== 'event_id') expect(typeof v, `${e.event}.${k} is an opaque number`).toBe('number');
      if (typeof v !== 'string') continue;
      expect(zones, `${e.event}.${k}: no zone`).not.toContain(v);
      for (const f of forbidden) expect(plainSpaces(v).toLowerCase(), `${e.event}.${k}`).not.toContain(plainSpaces(f).toLowerCase());
    }
    expect(Object.keys(e).filter((k) => /zone|note|text|name|phone|mail|chip/i.test(k)), `${e.event}: no such parameter`).toEqual([]);
  }
  // RC-9 (security review В-2 / S-1): nor does any of it stay on the page after the booking. The record comment — with the
  // notes about the visitor's wellbeing — used to stay in sessionStorage «bm.mock.lastComment»; now it is neither stored nor
  // even built in a page the gate does not drive (this test installs no hook: it is the visitor's page), and no debug global exists
  const kept = await page.evaluate(() => ({
    storage: [sessionStorage, localStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`)),
    globals: ['__bmTest', '__bmLastComment', '__bmGtmId', '__lpBff', '__lpLastRequest', '__lpLeads'].filter((k) => k in window),
  }));
  expect(kept.globals, 'debug globals on a visitor page').toEqual([]);
  expect(kept.storage.filter((kv) => kv.startsWith('bm.mock.')), 'stub leftovers in the storage').toEqual([]);
  for (const kv of kept.storage) for (const f of [NOTE, GENERAL, 'Demo', '500000000', '[Сайт/']) expect(kv, `storage after the booking: ${kv.split('=')[0]}`).not.toContain(f);
  expectClean(await g.problems(), 'dataLayer without health data');
});

/**
 * RC-9 (security review В-3 / В-4, S-2): a tag manager sees the page address, the referrer and the href of every link.
 *  - Through a whole booking the address is /booking/ or /booking/?step=N and nothing else; the record number and the hash
 *    never reach it.
 *  - The links that open another service with the visitor's own text — WhatsApp («…: <service>, <date> · Reference <n>») and
 *    Google Calendar (title, record number, zones) — keep the bare service in `href`; the complete address is built at the
 *    click and is the very one the plain link carried before (components/ui/PrefilledLink). The same in «My bookings».
 *  - The links that bring a choice INTO the booking carry opaque numbers and the wanted slot only.
 */
test('booking and account: no address a tag can see carries health data or the record; the prefilled links open the same address as before', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const trackers: string[] = [];
  await page.route(/googletagmanager\.com|google-analytics\.com|facebook\.(?:com|net)|doubleclick\.net/, (r) => { trackers.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  await testHook(page, { gtmId: GTM_TEST_ID });
  await seedConsent(page, { analytics: true, marketing: true });
  // a click opens a new window: record its address instead (a truthy stand-in = «it opened»)
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = ((u?: string | URL) => { w.__opened.push(String(u)); return { opener: null } as unknown as Window; }) as typeof window.open;
  });
  const opened = () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.splice(0));
  const g = guard(page, baseURL!);
  const seen: string[] = []; // every address the main frame had, client-side navigations included
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.push(f.url().replace(baseURL!, '')); });

  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await zoneBox(page, 0).check();
  await zoneBox(page, 5).check();
  const NOTE = 'sharp pain after deadlift', GENERAL = 'old knee injury from skiing';
  await page.locator('textarea[maxlength="300"]').first().fill(NOTE);
  await page.locator('textarea[maxlength="1000"]').fill(GENERAL);
  await toReview(page, { zones: 0 });
  await page.getByRole('button', { name: en.booking.review.confirm }).click();
  await page.waitForURL(/step=7/);

  // 1. the addresses of the whole flow, the referrer, the tracker requests
  expect(seen.filter((u) => !/^\/en\/booking\/(\?step=[2-7])?$/.test(u)), 'booking addresses other than /booking/ and ?step=N').toEqual([]);
  expect(seen.some((u) => u.endsWith('?step=7'))).toBe(true);
  expect(await page.evaluate(() => document.referrer)).toBe('');
  expect(trackers, 'the container request and nothing else').toEqual([`https://www.googletagmanager.com/gtm.js?id=${GTM_TEST_ID}`]);

  // 2. step 7: bare hrefs, the same attributes as before
  const done = page.locator('section[data-result="created"]');
  const dd = async (i: number) => (await done.locator('.bk-review dd').nth(i).textContent())!;
  const [ref, date, service] = [await dd(0), await dd(1), await dd(2)];
  const result = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingResult')!)) as { datetime: string; durationMin: number | null; zones: string[]; recordId: number };
  expect(ref).toBe(String(result.recordId));
  const wa = done.getByRole('link', { name: en.booking.done.whatsapp }), cal = done.getByRole('link', { name: en.booking.done.calendarGoogle });
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/\d*$/);
  await expect(cal).toHaveAttribute('href', 'https://calendar.google.com/calendar/render?action=TEMPLATE');
  for (const l of [wa, cal]) { await expect(l).toHaveAttribute('target', '_blank'); await expect(l).toHaveAttribute('rel', 'noopener noreferrer'); }

  // 3. the click opens what the plain link carried before RC-9 (lib/config whatsappUrl, lib/booking/calendar googleCalendarUrl)
  await wa.click();
  await cal.focus();
  await page.keyboard.press('Enter'); // the keyboard goes the same way
  const [waUrl, calUrl] = await opened();
  expect(waUrl).toBe(`${await wa.getAttribute('href')}?text=${encodeURIComponent(`${en.common.brand}: ${service}, ${date} · ${en.booking.done.reference} ${ref}`)}`);
  const c = new URL(calUrl);
  expect(c.origin + c.pathname).toBe('https://calendar.google.com/calendar/render');
  expect([...c.searchParams.keys()]).toEqual(['action', 'text', 'dates', 'details', 'location', 'ctz']);
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(result.datetime), end = new Date(start.getTime() + (result.durationMin ?? 60) * 60_000);
  expect(Object.fromEntries(c.searchParams)).toMatchObject({ action: 'TEMPLATE', text: `${en.common.brand} · ${service}`, dates: `${utc(start)}/${utc(end)}`, location: '', ctz: 'Asia/Dubai' });
  const [refLine, areasLine] = c.searchParams.get('details')!.split('\n');
  expect(refLine).toBe(`${en.booking.done.reference}: ${ref}`);
  expect(areasLine.startsWith(`${en.booking.review.areas}: `)).toBe(true);
  const zoneLabels = areasLine.slice(en.booking.review.areas.length + 2).split('; ');
  expect(zoneLabels).toHaveLength(result.zones.length);

  // 4. no link of the step — and no link leaving the site — carries the service, the zones, the date or the record number
  const secrets = (extra: string[]) => [...extra, NOTE, GENERAL, 'Demo', '500000000'].filter(Boolean).map((s) => plainSpaces(s).toLowerCase());
  const linkProblems = async (words: string[]) => {
    const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter((a) => !!a.closest('main') || new URL(a.href).origin !== location.origin).map((a) => a.href));
    const plain = (h: string) => { try { return decodeURIComponent(h); } catch { return h; } };
    return hrefs.flatMap((h) => words.filter((w) => plainSpaces(plain(h)).toLowerCase().includes(w)).map((w) => `${h} ← «${w}»`));
  };
  expect(await linkProblems(secrets([service, date, ref, result.datetime.slice(0, 10), ...result.zones, ...zoneLabels]))).toEqual([]);
  expectClean((await g.problems()).filter((p) => !p.includes(`googletagmanager.com/gtm.js?id=${GTM_TEST_ID}`)), 'booking addresses');

  // 5. «My bookings»: a full page load into the account (no container there), the cards' WhatsApp links the same way
  await done.getByRole('link', { name: en.booking.done.myBookings }).click();
  await page.waitForURL(/\/en\/account\/$/);
  await page.locator('#acc-phone').fill('+971501234567');
  await page.getByRole('button', { name: en.account.login.getCode }).click();
  await page.locator('input[autocomplete="one-time-code"]').fill('1234');
  await page.getByRole('button', { name: en.account.login.submit }).click();
  const late = page.locator('[data-testid="account-record"][data-late]').first();
  const past = page.locator('[data-testid="account-record"]').filter({ has: page.getByRole('link', { name: en.account.action.review }) }).first();
  const card = async (li: typeof late) => ({ service: (await li.locator('h3').textContent())!, when: (await li.locator('p').first().textContent())! });
  const lateWa = late.getByRole('link', { name: en.common.actions.writeWhatsapp }), review = past.getByRole('link', { name: en.account.action.review });
  for (const l of [lateWa, review]) { await expect(l).toHaveAttribute('href', /^https:\/\/wa\.me\/\d*$/); await expect(l).toHaveAttribute('target', '_blank'); await expect(l).toHaveAttribute('rel', 'noopener noreferrer'); }
  const a = await card(late), b = await card(past);
  await lateWa.click();
  await review.click();
  expect(await opened()).toEqual([
    `${await lateWa.getAttribute('href')}?text=${encodeURIComponent(`${a.service}, ${a.when}`)}`,
    `${await review.getAttribute('href')}?text=${encodeURIComponent(`${en.account.action.review}: ${b.service}, ${b.when}`)}`,
  ]);
  expect(await linkProblems(secrets([a.service, a.when, b.when]))).toEqual([]);
  expect(await page.evaluate(() => 'dataLayer' in window), 'no dataLayer in the account').toBe(false);
  expect(trackers, 'no container request from the account').toHaveLength(1);

  // 6. nothing opened (an in-app browser, a popup blocker) → the same tab goes there: the visitor is never left without the action
  await page.route(/^https:\/\/wa\.me\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await page.evaluate(() => { window.open = (() => null) as typeof window.open; });
  await lateWa.click();
  await page.waitForURL(/^https:\/\/wa\.me\//);
  expect(page.url()).toBe(`https://wa.me/${new URL(page.url()).pathname.slice(1)}?text=${encodeURIComponent(`${a.service}, ${a.when}`)}`);
});

// RC-9 (Hard Reviewer): the account border is decided on the path as a host resolves it — doubled slashes and percent-escaped
// letters did not match the pattern, so such an address would have had analytics if a host served it
test('an account address is recognised by its normalised path: doubled slashes, percent-escaped letters', () => {
  for (const p of ['/ru/account/', '/en/account', '/en/account/record/9001/demo-hash/', '//ru/account/', '/ru//account/record/1/2/', '/en///account//record/1/2/', '/ru/%61ccount/', '/en/acc%6Funt/record/1/2/', '/%72u/account/'])
    expect(isPrivatePath(p), p).toBe(true);
  for (const p of ['/', '/ru/', '/en/booking/', '/ru/accounting/', '/en/services/account/', '/ru/lp/a/', '/ru/%zz/', '/de/account/'])
    expect(isPrivatePath(p), p).toBe(false);
});

// RC-9 (Hard Reviewer, stage 1b): the live host serves /ru/x/..%2Faccount/ as the account page — it decodes %2F and climbs a
// level; the browser sends such an address as written. The rule resolved neither «..» nor «.», so the container would load there.
test('an account address behind an escaped slash and a parent segment is recognised; the ordinary addresses of the site keep their side', () => {
  for (const p of ['/ru/x/..%2Faccount/', '/ru/x/%2E%2E%2Faccount/record/1/2/', '/ru/x/y/..%2F..%2Faccount/', '/en/booking/..%2Faccount/record/1/2/', '/ru/.%2Faccount/', '/x/..%2Fru/account/', '/ru/account/x/..%2F', '/ru%5Caccount/'])
    expect(isPrivatePath(p), p).toBe(true);
  for (const p of ['/ru/account/..%2Fbooking/', '/ru/account/record/..%2F..%2F..%2Fbooking/', '/ru/x/..%2Faccounting/', '/..%2F..%2F', '/..%2F..%2Fde/account/'])
    expect(isPrivatePath(p), p).toBe(false);
  // never throws, whatever the input
  for (const p of ['', '%', '%E0%A4%A', '\\', '/%00/', '/'.repeat(5000), '/..'.repeat(5000), '/ru/' + '%2F'.repeat(3000) + 'account'])
    expect(() => isPrivatePath(p), JSON.stringify(p.slice(0, 20))).not.toThrow();
  // every page of the build: private exactly when it is an account page, as before the rule learned «.» and «..»
  for (const locale of LOCALES) {
    const pages = builtPages(locale).map((p) => `/${locale}/${p}`);
    expect(pages.length, `pages of ${locale}`).toBeGreaterThan(20);
    for (const p of pages) expect(isPrivatePath(p), p).toBe(p.startsWith(`/${locale}/account/`));
    expect(pages.filter((p) => isPrivatePath(p)).length, `account pages of ${locale}`).toBe(3);
  }
});

// RC-10 (security review Ж-9). Until RC-9 these links carried opaque numbers and the wanted slot (?service=101, ?staff=201,
// &date=…&time=…) — and an ad tag reads the href of a clicked link and the address it leads to. Now they carry nothing.
test('the links that bring a choice into the booking carry nothing of it in their address (Ж-9)', async ({ page }) => {
  await seedConsent(page);
  await page.goto('/en/services/sports/', { waitUntil: 'networkidle' });
  await expect(page.locator('main a.btn-book').first()).toHaveAttribute('href', '/en/booking/');
  await page.goto('/en/team/specialist-1/', { waitUntil: 'networkidle' });
  await expect(page.locator('main a.btn-book').first()).toHaveAttribute('href', '/en/booking/');
  const slots = page.locator('main a[href*="/booking/"][href*="step="]');
  await expect(slots.first()).toBeVisible();
  for (const href of await slots.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toBe('/en/booking/?step=2');
  expect(await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!).filter((h) => /[?&](?:service|staff|date|time)=/.test(h)))).toEqual([]);
});

/**
 * RC-10 (security review Ж-9): the choice a link brings into the booking is not in the address at any moment a tag could
 * read it. Meta's pixel, Google's tag and GA4 send the page address by themselves, on every change of the history too
 * (past the triggers of the container), so /booking/?service=101 reached them, although the number is meant for GA4 only.
 * Two observers:
 *   - `page` — installed before the page's scripts: the address after every pushState / replaceState and on popstate;
 *   - `container` — the stub that answers the container request reports what a real container would see: the address and
 *     the referrer when it starts, «old → new» on every later change of the history.
 * Inside the site no observer ever sees service= / staff= / date= / time=. A link from outside necessarily opens with them:
 * the page sees that first address (and removes it), the container never does — not as the address, not as the previous
 * one, not as the referrer — and it does not come back on a reload, «Назад» or «Вперёд».
 */
const stored = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps') ?? 'null') as { serviceId: number | null; staffId: number; wantDate?: string | null; wantTime?: string | null } | null);
const checkedService = (page: Page) => page.locator('li', { has: page.locator('input[name="service"]:checked') });
const containerRan = (seen: EntrySeen[]) => seen.some((r) => r.who === 'container' && r.what === 'start');

test.describe('the choice a link brings into the booking is never in an address a tag reads (Ж-9)', () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page, { analytics: true, marketing: true }); });

  test('service page → «Book»: the bare /booking/, the service preselected, kept through F5; «Назад» returns to the service', async ({ page }) => {
    const seen = await entryProbe(page);
    await page.goto('/en/services/lfk-kinesio/', { waitUntil: 'networkidle' });
    const title = (await page.locator('h1').textContent())!.trim();
    await page.locator('main .btn-book').first().click();
    await page.waitForURL(/\/en\/booking\/$/);
    await page.getByRole('button', { name: en.body3d.panel.skip }).click();
    await page.waitForURL(/\/en\/booking\/\?step=2$/);
    await expect(checkedService(page)).toContainText(title);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(checkedService(page)).toContainText(title);
    await page.goBack(); // step 1
    await page.goBack();
    await page.waitForURL(/\/en\/services\/lfk-kinesio\/$/);
    expect(containerRan(seen), 'the container stub ran').toBe(true);
    expect(seen.filter(withChoice), 'no address with the choice, for the page or for the container').toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem('bm.bookingPreset')), 'the hand-over was taken and removed').toBeNull();
  });

  test('specialist page → «Book with the specialist» and a free window: the bare address, the specialist, the day and the time preselected; step 2 → 4, «Назад» → 3', async ({ page }) => {
    const seen = await entryProbe(page);
    await page.goto('/en/team/specialist-1/', { waitUntil: 'networkidle' });
    await page.locator('main a.btn-book').first().click();
    await page.waitForURL(/\/en\/booking\/$/);
    expect((await stored(page))?.staffId).toBe(201);
    // a free window of the same specialist: the service step, then straight to the time (R-FINAL-2), «Назад» from it → the specialist
    await page.goto('/en/team/specialist-1/', { waitUntil: 'networkidle' });
    const slot = page.locator('main a[href="/en/booking/?step=2"]').first();
    const time = (await slot.textContent())!.match(/\d{2}:\d{2}/)![0];
    await slot.click();
    await page.waitForURL(/\/en\/booking\/\?step=2$/);
    const s = (await stored(page))!;
    expect(s.staffId).toBe(201);
    expect(s.wantTime).toBe(time);
    expect(s.wantDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.locator('input[name="service"]').first().check();
    await page.getByRole('button', { name: en.common.actions.next, exact: true }).click();
    await page.waitForURL(/\/en\/booking\/\?step=4$/);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.dates button')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'))).toBe(calendarDays().indexOf(s.wantDate!));
    await page.getByRole('button', { name: en.common.actions.back, exact: true }).click();
    await page.waitForURL(/\/en\/booking\/\?step=3$/);
    expect(containerRan(seen)).toBe(true);
    expect(seen.filter(withChoice)).toEqual([]);
  });

  test('«Book again» from the account (a full page load): the bare address, the service and the specialist of the card preselected', async ({ page }) => {
    const seen = await entryProbe(page);
    await page.goto('/en/account/', { waitUntil: 'networkidle' });
    await page.locator('#acc-phone').fill('+971501234567');
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await page.locator('input[autocomplete="one-time-code"]').fill('1234');
    await page.getByRole('button', { name: en.account.login.submit }).click();
    const past = page.locator('[data-testid="account-record"]').filter({ has: page.getByRole('link', { name: en.common.actions.bookAgain }) }).first();
    const service = (await past.locator('h3').textContent())!.trim();
    const again = past.getByRole('link', { name: en.common.actions.bookAgain });
    await expect(again).toHaveAttribute('href', '/en/booking/');
    await again.click();
    await page.waitForURL(/\/en\/booking\/$/);
    await page.waitForLoadState('networkidle');
    const s = (await stored(page))!;
    expect(s.serviceId).toBeGreaterThan(0);
    expect(s.staffId).toBeGreaterThan(0);
    await page.getByRole('button', { name: en.body3d.panel.skip }).click();
    await page.waitForURL(/\/en\/booking\/\?step=2$/);
    await expect(checkedService(page)).toContainText(service);
    expect(containerRan(seen), 'the container stub ran on the booking page (never in the account)').toBe(true);
    expect(seen.filter(withChoice)).toEqual([]);
    expect(seen.filter((r) => /\/account\//.test(r.href + (r.from ?? '') + (r.referrer ?? '')) && r.who === 'container'), 'the container saw no account address either').toEqual([]);
  });

  test('a link from outside, /booking/?service=N&utm_source=x and ?staff&step=2&date&time: the choice works, the container never sees it, UTM stays', async ({ page }) => {
    const seen = await entryProbe(page);
    await page.goto('/en/booking/?service=101&utm_source=x', { waitUntil: 'networkidle' });
    expect(new URL(page.url()).search).toBe('?utm_source=x');
    expect((await stored(page))?.serviceId).toBe(101);
    expect(await page.evaluate(() => sessionStorage.getItem('bm.utm'))).toContain('"utm_source":"x"');
    await page.reload({ waitUntil: 'networkidle' }); // the cleaned address does not come back
    expect(new URL(page.url()).search).toBe('?utm_source=x');
    expect((await stored(page))?.serviceId).toBe(101);
    await page.getByRole('button', { name: en.body3d.panel.skip }).click();
    await page.waitForURL(/\/en\/booking\/\?step=2$/);
    await expect(page.locator('input[name="service"]:checked')).toHaveCount(1);
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/en/booking/' && !u.searchParams.has('step'));
    expect(new URL(page.url()).search).toBe('?utm_source=x');
    await page.goForward();
    await page.waitForURL(/\/en\/booking\/\?step=2$/);
    // the window link written out, as another site or a message would carry it
    const day = calendarDays().find(Boolean)!;
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`/en/booking/?staff=201&step=2&date=${day}&time=10:00`, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).search).toBe('?step=2');
    expect(await stored(page)).toMatchObject({ staffId: 201, wantDate: day, wantTime: '10:00' });
    const container = seen.filter((r) => r.who === 'container');
    expect(container.some((r) => r.what === 'start')).toBe(true);
    expect(container.filter(withChoice), 'the container: never, in any form').toEqual([]);
    // the page itself sees the first address — and only as the one it replaces
    expect(seen.filter((r) => r.who === 'page' && CHOICE_IN_URL.test(r.href)), 'the page never ends up on an address with the choice').toEqual([]);
  });

  test('consent given on the booking page itself: the container starts on the cleaned address', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('bm.consent')); // undo the seed of beforeEach: no choice yet
    const seen = await entryProbe(page);
    await page.goto('/en/booking/?service=101', { waitUntil: 'networkidle' });
    expect(containerRan(seen), 'no container before the choice').toBe(false);
    expect(new URL(page.url()).search).toBe('');
    await page.getByRole('button', { name: en.cookie.acceptAll }).click();
    await expect.poll(() => containerRan(seen)).toBe(true);
    expect(seen.filter((r) => r.who === 'container').filter(withChoice)).toEqual([]);
    expect((await stored(page))?.serviceId).toBe(101);
  });

  // ?service= used to stay in the address through F5 and to travel with the language switch, so a service a link had
  // brought was never offered as «a draft found». The address no longer says it: the history entry keeps a flag (no
  // numbers) and the language switch hands that flag over to the entry in the other language.
  test('a service brought by a link is not offered as «a draft found»: not after F5 on step 1, not after the language switch; the choice stays', async ({ page }) => {
    await page.goto('/en/services/lfk-kinesio/', { waitUntil: 'networkidle' });
    await page.locator('main .btn-book').first().click();
    await page.waitForURL(/\/en\/booking\/$/);
    await expect(page.getByText(en.booking.draft.restoreTitle)).toHaveCount(0);
    const service = (await stored(page))!.serviceId;
    expect(service).toBeGreaterThan(0);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(en.booking.draft.restoreTitle)).toHaveCount(0);
    expect((await stored(page))?.serviceId).toBe(service);
    await page.locator('.lang-switch a[hreflang="ru"]').first().click(); // a full page load of the same step in Russian
    await page.waitForURL(/\/ru\/booking\/$/);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByText(ru.booking.draft.restoreTitle)).toHaveCount(0);
    expect((await stored(page))?.serviceId).toBe(service);
    // the control: a later visit that no link brought does offer the saved choice — the flag belongs to the entry, not to the tab
    await page.goto('/ru/services/', { waitUntil: 'networkidle' });
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    await expect(page.getByText(ru.booking.draft.restoreTitle).first()).toBeVisible();
  });

  // The hand-over of a click lives a minute, so that a click which did not end in the booking does not surface later. A
  // link from outside is moved into the hand-over while the HTML is parsed and is taken when the page comes alive — on
  // a slow network that can be later than a minute: a hand-over made by the same document has no limit (lib/booking/preset).
  test('a slow page: the choice of a link from outside waits however long the page takes; a stale hand-over of a click is ignored', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route(/\/_next\/static\/chunks\/.*\.js$/, async (r) => { await held; await r.continue(); });
    await page.goto('/en/booking/?service=101', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).search, 'cleaned while the HTML is parsed, before any script of the app').toBe('');
    // two minutes pass before the page comes alive
    await page.evaluate(() => { const r = JSON.parse(sessionStorage.getItem('bm.bookingPreset')!); r.at -= 120_000; sessionStorage.setItem('bm.bookingPreset', JSON.stringify(r)); });
    release();
    await expect.poll(async () => (await stored(page))?.serviceId ?? null).toBe(101);
    // the control: what a click left two minutes ago (in another document) is not taken, and it is removed
    await page.evaluate(() => { sessionStorage.clear(); sessionStorage.setItem('bm.bookingPreset', JSON.stringify({ service: 102, at: Date.now() - 120_000 })); });
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    expect((await stored(page))?.serviceId ?? null).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('bm.bookingPreset'))).toBeNull();
  });

  // the other side of the time limit: the mark «this document» is put only when a choice is moved out of the address,
  // never at a click — a click that did not end in the booking is forgotten after a minute, in the same document too
  test('a click that did not end in the booking does not surface a minute later', async ({ page }) => {
    await page.goto('/en/services/lfk-kinesio/', { waitUntil: 'networkidle' });
    // the navigation is stopped the way the account border stops it: the default is prevented before the link's own handler
    await page.evaluate(() => document.addEventListener('click', (e) => { if ((e.target as Element).closest('main .btn-book')) e.preventDefault(); }, true));
    await page.locator('main .btn-book').first().click();
    expect(page.url()).toMatch(/\/en\/services\/lfk-kinesio\/$/);
    expect(await page.evaluate(() => sessionStorage.getItem('bm.bookingPreset')), 'the click handed the choice over').toContain('"service"');
    // more than a minute later, the same document: the booking is opened from the header, without a choice
    await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 120_000; });
    await page.locator('.site-header a.btn-book').first().click();
    await page.waitForURL(/\/en\/booking\/$/);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('bm.bookingPreset'))).toBeNull();
    expect((await stored(page))?.serviceId ?? null).toBeNull();
  });

  test('a new tab (Ctrl + click) opens the bare booking without the choice — the named price of the fix', async ({ page, context }) => {
    await page.goto('/en/services/lfk-kinesio/', { waitUntil: 'networkidle' });
    const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('main .btn-book').first().click({ modifiers: ['ControlOrMeta'] })]);
    await tab.waitForLoadState('networkidle');
    expect(new URL(tab.url()).pathname + new URL(tab.url()).search).toBe('/en/booking/');
    expect(await tab.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps') ?? 'null')?.serviceId ?? null)).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('bm.bookingPreset')), 'nothing is left waiting in the first tab').toBeNull();
  });
});

// RC-9 (security review Ж-1 / S-3): `?mock=<mode>` used to switch the stub for anyone — a link could make the form in a
// visitor's tab answer «request received» or fail. Without the gate's hook the parameter is neither read nor stored.
test('a visitor\'s address cannot switch the stub: ?mock=queued without the gate\'s hook → a plain booking, nothing stored', async ({ page }) => {
  test.setTimeout(120_000);
  await seedConsent(page);
  await page.goto('/en/booking/?mock=queued', { waitUntil: 'networkidle' });
  await toReview(page);
  await page.getByRole('button', { name: en.booking.review.confirm }).click();
  await page.waitForURL(/step=7/);
  await expect(page.locator('section[data-result="created"]')).toBeVisible(); // with the hook: data-result="queued" (states.spec F-01)
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('bm.mock')))).toEqual([]);
});
