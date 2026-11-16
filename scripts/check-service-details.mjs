import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-service-details-'));
const scenario = path.join(dir, 'scenario');
const setScenario = (value) => fs.writeFile(scenario, value);
const cacheEntries = new Set();
const token = 'fixture-partner-token';
const paths = {
  api: (slug, query = '') => `/api/catalog/services/${slug}${query}`,
  page: (locale, slug) => `/${locale}/services/${slug}/`,
};
const newPins = [
  [13982356, 'classic', 'Classic massage'],
  [13982358, 'thai', 'Thai massage'],
  [13982379, 'sports-infrared', 'Sports massage with infrared capsule'],
  [13982380, 'classic-infrared', 'Classic massage with infrared capsule'],
  [13982351, 'full-complex', 'Ice bath after massage'],
  [13983057, 'lfk-kinesio', 'Functional training and mobility'],
];

function run(check, currency = 'AED') {
  const env = {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: token,
    ALTEGIO_CURRENCY: currency,
    CATALOG_TEST_SCENARIO: scenario,
  };
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      assertPublic(logs());
      assert.doesNotMatch(logs(), /\[catalog-unhandled-rejection\]|\[staff-fixture\]/);
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheEntries.add(key);
    }
  }, { env, preload });
}

function assertPublic(text) {
  for (const value of [token, 'fixture raw upstream detail']) assert.ok(!text.includes(value), 'private value in output');
}

async function request(origin, pathname, expected, headers, redirect = 'manual') {
  const response = await fetch(origin + pathname, { redirect, headers });
  assert.equal(response.status, expected, pathname);
  const text = await response.text();
  assertPublic(text);
  return { text, headers: response.headers };
}

async function detail(origin, slug, locale, status, code) {
  const { text, headers } = await request(origin, paths.api(slug, locale), status);
  assert.equal(headers.get('cache-control'), 'no-store');
  const json = JSON.parse(text);
  if (code) assert.equal(json.error.code, code);
  return { json, headers };
}

async function checkNotFound(origin, pathname, headers) {
  const { text } = await request(origin, pathname, 404, headers);
  assert.ok(text.includes('container page nf'), `Missing branded 404 content for ${pathname}`);
}
const calls = (logs) => (logs().match(/\[catalog-fixture\]/g) ?? []).length;

async function browserChecks(origin) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 820 } });
    const unexpectedRequests = [];
    await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
      necessary: true, analytics: false, marketing: false, at: 'gate',
    })));
    await page.route(/api\.alteg\.io|\/api\/catalog\//, async (route) => {
      unexpectedRequests.push(route.request().url());
      await route.abort();
    });
    await page.route('https://images.example.test/**', async (route) => {
      assert.equal(route.request().headers().referer, undefined);
      assert.equal(route.request().headers().authorization, undefined);
      return route.request().url().endsWith('broken.webp')
        ? route.fulfill({ status: 404 })
        : route.fulfill({ path: 'public/photos/services/classic-640.webp', contentType: 'image/webp' });
    });
    const hero = page.locator('.svc-hero');
    const heading = hero.locator('h1');
    const facts = hero.locator('dd');
    const sections = page.locator('.doc-sections');
    const sectionHeadings = page.locator('.doc-sections > section > h2');
    const sectionHeadingsByLocale = new Map();
    const wideSections = page.locator('.doc-sections > .doc-sections__wide');
    async function checkSectionVisibility(locale) {
      await expect(sections.locator(':scope > section[hidden]')).toHaveCount(1);
      const visibleSections = sections.locator(':scope > section:visible');
      await expect(visibleSections).toHaveCount(1);
      await expect(visibleSections).toHaveAttribute('aria-labelledby', 'service-specialists-title');
      await expect(sectionHeadings).toHaveCount(2);
      await expect(wideSections).toHaveCount(2);
      const faq = sectionHeadings.filter({ hasText: locale === 'ru' ? 'Вопросы по услуге' : 'Questions about this service' });
      await expect(faq).toHaveCount(0);
    }
    const missingPage = await page.goto(origin + paths.page('ru', 'service-94999'));
    assert.equal(missingPage.status(), 404);
    await expect(page.locator('main .nf')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    const localized = [
      ['ru', 'Спортивный массаж из каталога', 'Описание из каталога.', 'Массаж из каталога'],
      ['en', 'Sports massage', 'Massage for people who train: before a session, after a race and between workouts.', 'Catalog massage'],
    ];
    await page.goto(`${origin}${paths.page('ru', 'sports')}?ref=test`);
    for (const [locale, title, description, category] of localized) {
      await expect(heading).toHaveText(title);
      await expect(hero.locator('.hero-lead')).toHaveText(description);
      await expect(hero.locator('.eyebrow')).toHaveText(category);
      await expect(facts).toHaveText([/80\s*–\s*160.*AED|AED.*80\s*–\s*160/, '']);
      await expect(hero.locator('.badge, img')).toHaveCount(0);
      await expect(hero.locator('.svc-hero__photo .ph')).toBeVisible();
      await checkSectionVisibility(locale);
      sectionHeadingsByLocale.set(locale, await sectionHeadings.allTextContents());
      await expect(wideSections.first().getByRole('status')).toHaveText(locale === 'ru'
        ? 'Для этой услуги пока нет специалистов.' : 'No specialists are currently listed for this service.');
      await expect(page.locator('.doc-sections .staff')).toHaveCount(0);
      await expect(page.locator('.demo-notice')).toHaveCount(0);
      const cta = hero.getByRole('link', { name: locale === 'ru' ? 'Записаться' : 'Book' });
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute('href', `/${locale}/booking/`);
      if (locale === 'ru') {
        await page.getByRole('link', { name: /^EN\./ }).click();
        await expect(page).toHaveURL(`${origin}${paths.page('en', 'sports')}?ref=test`);
      }
    }

    for (const [locale, width] of [['en', 1280], ['ru', 320], ['en', 320]]) {
      await page.setViewportSize({ width, height: 820 });
      await page.goto(origin + paths.page(locale, 'service-91201'));
      await expect(heading).toHaveText(/длинным названием|very long service title/);
      await expect(hero.locator('.eyebrow, .hero-lead, .badge')).toHaveCount(0);
      await checkSectionVisibility(locale);
      await expect(sectionHeadings).toHaveText(sectionHeadingsByLocale.get(locale));
      await expect(page.locator('.doc-sections > section > .todo')).toHaveCount(0);
      await expect(wideSections.first().getByRole('status')).toBeVisible();
      await expect(wideSections.last().locator(`a[href^="/${locale}/journal/"]`)).toHaveCount(2);
      await expect(page.locator('.doc-sections .staff')).toHaveCount(0);
      await expect(facts).toHaveText([/^(?:AED\s+)?0(?:\s+AED)?$/, /90\s+(мин|min)/]);
      await expect.poll(() => hero.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.ok(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth));
      const [photoBox, textBox] = await Promise.all([hero.locator('.svc-hero__photo').boundingBox(), hero.locator('.svc-hero__text').boundingBox()]);
      assert.ok(width === 320 ? textBox.y < photoBox.y : photoBox.x < textBox.x, 'hero order');
    }
    for (const [slug, price] of [['service-91202', /From\s+AED\s+55\.5/], ['service-91203', /AED\s+125/], ['service-91204', 'Price to be confirmed']]) {
      await page.goto(origin + paths.page('en', slug));
      await expect(facts).toHaveText([price, '']);
    }
    for (const section of ['services', 'prices']) {
      for (const [slug, title] of [['sports', 'Sports massage'], ['lfk-kinesio', 'Functional training and mobility']]) {
        await page.goto(`${origin}/en/${section}/`);
        const serviceLink = page.locator(`main a[href="${paths.page('en', slug)}"]`).first();
        await expect(serviceLink).toBeVisible();
        await expect(page.locator(`main a[href="${paths.page('en', 'manual')}"]`)).toHaveCount(0);
        await serviceLink.click();
        await expect(page).toHaveURL(origin + paths.page('en', slug));
        await expect(heading).toHaveText(title);
        await expect(hero.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/en/booking/');
      }
    }
    await page.goto(origin + paths.page('en', 'manual'));
    const demoCta = hero.getByRole('link', { name: 'Book', exact: true });
    await expect(demoCta).toHaveAttribute('href', '/en/booking/');
    await expect(hero.locator('.facts .badge')).toHaveCount(0);
    await checkSectionVisibility('en');
    await expect(wideSections.first().locator('.staff a[href^="/en/team/"]').first()).toBeVisible();
    await demoCta.click();
    await expect(page).toHaveURL(`${origin}/en/booking/`);
    await expect(page.locator('.booking[data-ready="true"] #st1')).toBeVisible();
    assert.deepEqual(unexpectedRequests, []);
  } finally {
    await browser.close();
  }
}

try {
  await setScenario('500');
  await run(async (origin, logs) => {
    for (const query of ['?locale=de', '?locale=', '?locale=ru&locale=en', '?locationId=5', '?locale=en&extra=1']) {
      await detail(origin, 'sports', query, 400, 'INVALID_QUERY');
    }
    for (const slug of ['unknown', 'service-0', 'service-001', 'service-9007199254740992', 'service-13982355', 'manual']) {
      await detail(origin, slug, '', 404, 'SERVICE_NOT_FOUND');
    }
    assert.equal(calls(logs), 0);
    for (const pathname of ['/en/services/no-such-service', '/ru/services/no-such-service/', '/en/services/service-13982355/']) {
      await checkNotFound(origin, pathname);
    }
    await detail(origin, 'sports', '', 503, 'CATALOG_UNAVAILABLE');
    const failure = await request(origin, paths.page('en', 'sports'), 200);
    assert.match(failure.text, /Service temporarily unavailable/);
    assert.doesNotMatch(failure.text, /class="svc-hero"|application\/ld\+json|Sports massage/);
    assert.match(failure.headers.get('cache-control'), /no-store/);
    const demo = await request(origin, paths.page('en', 'manual'), 200);
    assert.match(demo.text, /class="svc-hero"/);

    await setScenario('service-detail');
    const knownSlugs = ['sports', 'service-91201', 'service-91202', 'service-91203', 'service-91204'];
    for (const locale of ['en', 'ru']) {
      const useQuery = locale === 'en' ? '' : '?locale=ru';
      const titles = locale === 'en' ? ['Sports massage', 'Massage with a very long service title']
        : ['Спортивный массаж из каталога', 'Массаж с очень длинным названием'];
      const ids = new Set();
      for (const [index, slug] of knownSlugs.entries()) {
        const pathname = paths.page(locale, slug);
        const { json } = await detail(origin, slug, useQuery, 200);
        assert.deepEqual(json.meta, { source: 'altegio', locale });
        const { service, category } = json.data;
        assert.equal(service.slug, slug);
        assert.equal(service.id, index === 0 ? 13982355 : 91200 + index);
        assert.ok(!ids.has(service.id));
        ids.add(service.id);
        if (index === 0) {
          assert.equal(service.title, locale === 'en' ? 'Sports massage from CRM' : 'Спортивный массаж из каталога');
          assert.deepEqual(category, { id: 20, title: locale === 'en' ? 'Catalog massage' : 'Массаж из каталога' });
        } else assert.equal(category, null);
        if (index > 1) continue;
        const query = '?ref=a%20b&tag=1&tag=2';
        const redirect = await request(origin, pathname.slice(0, -1) + query, 308);
        const redirectUrl = new URL(redirect.headers.get('location'), origin);
        assert.equal(redirectUrl.origin + redirectUrl.pathname, origin + pathname);
        assert.deepEqual([...redirectUrl.searchParams], [...new URLSearchParams(query)]);
        const { text: html, headers } = await request(origin, pathname, 200);
        assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.match(headers.get('cache-control'), /no-store/);
        const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
        assert.equal(new URL(canonical).pathname, pathname);
        for (const [lang, actualLocale] of [['ru', 'ru'], ['en', 'en'], ['x-default', 'en']]) {
          assert.ok(html.includes(`hrefLang="${lang}" href="${new URL(canonical).origin}${paths.page(actualLocale, slug)}"`));
        }
        const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) => JSON.parse(match[1]));
        assert.deepEqual(ld.map((node) => node['@type']), ['Service', 'BreadcrumbList']);
        assert.ok(ld[0].name.startsWith(titles[index]));
        assert.equal(ld[0].url, canonical);
        assert.equal(ld[0].serviceType, category?.title);
        assert.equal(ld[0].offers, undefined);
        assert.equal(ld[1].itemListElement.at(-1).item, canonical);
        assert.equal(ld[1].itemListElement.at(-1).name, ld[0].name);
        const title = html.match(/<title>(.*?)<\/title>/s)[1];
        assert.ok(title.startsWith(ld[0].name));
        const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
        if (ld[0].description) assert.equal(description, ld[0].description);
        assert.doesNotMatch(description, /AED|онлайн-запис|book online/i);
        const rsc = await request(origin, pathname, 200, { RSC: '1' }, 'follow');
        assert.match(rsc.headers.get('content-type'), /text\/x-component/);
        assert.ok(rsc.text.includes(titles[index]));
      }
      for (const [id, slug, englishTitle] of newPins) {
        const { json } = await detail(origin, slug, useQuery, 200);
        assert.equal(json.data.service.id, id);
        assert.equal(json.data.service.slug, slug);
        assert.ok(!ids.has(id));
        ids.add(id);
        const pathname = paths.page(locale, slug);
        const { text } = await request(origin, pathname, 200);
        const canonical = text.match(/<link rel="canonical" href="([^"]+)"/)[1];
        assert.equal(new URL(canonical).pathname, pathname);
        const serviceLd = JSON.parse(text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
        assert.equal(serviceLd.name, locale === 'en' ? englishTitle : json.data.service.title);
        assert.equal(serviceLd.url, canonical);
        assert.match(text, new RegExp(`<a(?=[^>]*class="btn btn--primary btn-book")(?=[^>]*href="/${locale}/booking/")[^>]*>`));
        await detail(origin, `service-${id}`, useQuery, 404, 'SERVICE_NOT_FOUND');
        await checkNotFound(origin, paths.page(locale, `service-${id}`));
      }
      await detail(origin, 'service-94999', useQuery, 404, 'SERVICE_NOT_FOUND');
      await checkNotFound(origin, paths.page(locale, 'service-94999'));
      await checkNotFound(origin, paths.page(locale, 'service-94999'), { 'User-Agent': 'Twitterbot' });
    }
    assert.equal(calls(logs), 4, 'two failures and one shared catalog load per locale');
    const sitemap = (await request(origin, '/sitemap.xml', 200)).text;
    for (const locale of ['en', 'ru']) {
      for (const slug of ['sports', ...newPins.map(([, slug]) => slug)]) {
        assert.ok(sitemap.includes(`${paths.page(locale, slug)}</loc>`), slug);
      }
    }
    assert.doesNotMatch(sitemap, /service-13982355|service-91201/);
    await browserChecks(origin);
  });

  await setScenario('429');
  await run(async (origin) => {
    const { headers } = await detail(origin, 'sports', '', 503, 'UPSTREAM_RATE_LIMITED');
    assert.match(headers.get('retry-after'), /^[1-5]$/);
  });

  await setScenario('empty');
  await run(async (origin) => {
    // The cold page must keep HTTP 404 while it waits for a fresh upstream response.
    await checkNotFound(origin, paths.page('en', 'sports'));
    await detail(origin, 'sports', '', 404, 'SERVICE_NOT_FOUND');
  });

  await setScenario('service-detail-renamed');
  await run(async (origin) => {
    const { json } = await detail(origin, 'service-91201', '', 200);
    assert.equal(json.data.service.slug, 'service-91201');
    assert.equal(json.data.service.title, 'Renamed in CRM');
    assert.equal(json.data.service.currency, null);
    const { text } = await request(origin, paths.page('en', 'service-91201'), 200);
    assert.match(text, /Renamed in CRM/);
    assert.match(text, /Price to be confirmed/);
  }, '');
  console.log('Service detail production checks: API, RU/EN pages, HTTP 404, SEO, photos, links, booking and upstream recovery OK');
} finally {
  for (const key of cacheEntries) await fs.rm(path.join('.next/cache/fetch-cache', key), { force: true });
  await fs.rm(scenario, { force: true });
  await fs.rmdir(dir);
}
