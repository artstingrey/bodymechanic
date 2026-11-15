import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const token = 'fixture-partner-token';
const privateValues = [token, 'fixture raw upstream detail', 'https://api.alteg.io/api/v1/private'];
const cacheDir = path.resolve('.next/cache/fetch-cache');
const shots = path.resolve('e2e/shots/home-team');
const section = 'section.section--surface.home-sec[aria-labelledby="team-title"]';
const endpoint = '/api/catalog/staff';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-home-team-'));
const staffScenario = path.join(dir, 'staff');
const servicesScenario = path.join(dir, 'services');
const written = new Set();
const release = (scenario) => fs.writeFile(`${scenario}.release`, '');
const setStaff = (value) => fs.writeFile(staffScenario, value);
const setServices = (value) => fs.writeFile(servicesScenario, value);
const longName = 'Александра с очень длинным именем для проверки переноса строк';
const names = [longName, 'Taylor Example', 'Sam Example', 'Robin Example', 'Casey Example', 'Jamie Example'];
const image = (file) => `https://images.example.test/${file}`;
const dataFor = (locale) => ({
  staff: [
    { id: 91216, name: names[0], specialization: locale === 'ru' ? 'Специализация RU' : 'Specialization EN',
      position: 'Job title', imageUrl: image('portrait.webp') },
    { id: 91214, name: names[1], specialization: null, position: 'Therapist', imageUrl: image('broken.webp') },
    { id: 91212, name: names[2], specialization: null, position: null, imageUrl: null },
    { id: 91211, name: names[3], specialization: null, position: null, imageUrl: null },
    { id: 91213, name: names[4], specialization: null, position: null, imageUrl: image('no-master.png') },
    { id: 91215, name: names[5], specialization: null, position: null, imageUrl: null },
  ],
});

const fixtureEnv = () => ({
  ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
  ALTEGIO_PARTNER_TOKEN: token,
  ALTEGIO_CURRENCY: 'AED',
  CATALOG_TEST_SCENARIO: servicesScenario,
  STAFF_TEST_SCENARIO: staffScenario,
});

function checkPrivacy(text) {
  assert.ok(privateValues.every((value) => !text.includes(value)), 'private upstream detail is public');
}

function run(check, env = fixtureEnv()) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      checkPrivacy(logs());
      assert.doesNotMatch(logs(), /\[catalog-unhandled-rejection\]/);
    } finally {
      for (const match of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) {
        written.add(path.join(cacheDir, match[1]));
      }
    }
  }, { env, preload });
}

async function api(origin, query, status, expected) {
  const response = await fetch(origin + endpoint + query, { redirect: 'manual' });
  assert.equal(response.status, status, query);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  checkPrivacy(text);
  const json = JSON.parse(text);
  if (status === 200) assert.deepEqual(json, expected);
  else {
    assert.deepEqual(Object.keys(json), ['error']);
    assert.deepEqual(Object.keys(json.error).sort(), ['code', 'message']);
    assert.equal(json.error.code, expected);
    assert.equal(typeof json.error.message, 'string');
  }
  return response.headers;
}

const expected = (locale, data = dataFor(locale)) => ({ data, meta: { source: 'altegio', locale } });
const calls = (logs, marker) => logs().split('\n').filter((line) => line.includes(`[${marker}-fixture]`));
const staffCalls = (logs) => calls(logs, 'staff');

async function home(origin, locale) {
  const response = await fetch(`${origin}/${locale}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const html = await response.text();
  checkPrivacy(html);
  return html;
}

async function browserPage(browser, width, check) {
  const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 768 });
  const failures = [];
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, analytics: false, marketing: false, at: 'gate',
  })));
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.includes('images.example.test')) failures.push(message.text());
    if (message.type() === 'warning' && /hydrat/i.test(message.text())) failures.push(message.text());
  });
  await page.route(/api\.alteg\.io|\/api\/catalog\//, async (route) => {
    failures.push(`Unexpected browser request: ${route.request().url()}`);
    await route.abort();
  });
  await page.route('https://images.example.test/**', async (route) => {
    assert.equal(route.request().headers().authorization, undefined);
    assert.equal(route.request().headers().referer, undefined);
    if (route.request().url().endsWith('broken.webp')) return route.fulfill({ status: 404 });
    if (!route.request().url().endsWith('live.webp')) {
      return route.fulfill({
        contentType: 'image/svg+xml',
        // A synthetic portrait keeps the image fixture independent of site content.
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 460"><rect width="400" height="460" fill="#d9d2de"/><circle cx="200" cy="158" r="70" fill="#675779"/><ellipse cx="200" cy="405" rx="144" ry="147" fill="#675779"/></svg>',
      });
    }
    await route.fulfill({ path: 'public/photos/services/sports-640.webp' });
  });
  try {
    await check(page, page.locator(section));
    assert.deepEqual(failures, []);
  } finally {
    await page.close();
  }
}

const screenshot = (block, file) => block.screenshot({
  path: path.join(shots, `${file}.png`),
  style: '.site-header, .fab-wrap { visibility: hidden !important; }',
});

let browser;
try {
  const env = fixtureEnv();
  await run((origin) => api(origin, '', 503, 'CATALOG_UNAVAILABLE'),
    { ...env, ALTEGIO_LOCATION_ID: ' ', ALTEGIO_PARTNER_TOKEN: ' ' });
  await run(async (origin, logs) => {
    for (const query of ['?locale=de', '?locale=', '?locale=ru&locale=en', '?locationId=5', '?locale=ru&path=other']) {
      await api(origin, query, 400, 'INVALID_QUERY');
    }
    assert.equal(staffCalls(logs).length, 0);
    for (const [scenario, status, code] of [
      ['401', 503, 'CATALOG_UNAVAILABLE'], ['403', 503, 'CATALOG_UNAVAILABLE'],
      ['invalid-json', 502, 'UPSTREAM_INVALID_RESPONSE'], ['timeout', 504, 'UPSTREAM_TIMEOUT'],
      ...['rejected', 'invalid-schema', 'invalid-member', 'invalid-id', 'unsafe-id', 'string-id', 'blank-name',
        'invalid-name', 'duplicate-id'].map((scenario) => [scenario, 502, 'UPSTREAM_INVALID_RESPONSE']),
    ]) {
      await setStaff(scenario);
      await api(origin, '', status, code);
    }
    await setStaff('429');
    const headers = await api(origin, '?locale=ru', 503, 'UPSTREAM_RATE_LIMITED');
    assert.equal(headers.get('retry-after'), '5');
    await setStaff('success');
    const count = staffCalls(logs).length;
    await api(origin, '?locale=ru', 503, 'UPSTREAM_RATE_LIMITED');
    assert.equal(staffCalls(logs).length, count);
    assert.doesNotMatch(logs(), /\[catalog-cache-write\]/);
  }, env);
  console.log('Staff API validation, safe errors, timeout and rate limit: OK');

  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  await fs.mkdir(shots, { recursive: true });
  await setStaff('500');
  await setServices('home');
  await run(async (origin, logs) => {
    await browserPage(browser, 1280, async (page, block) => {
      await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
      await page.goto(`${origin}/en/`);
      const retry = block.getByRole('button', { name: 'Try again' });
      await expect(retry).toBeVisible();
      await expect(block.locator('.car, .team-intro')).toHaveCount(0);
      await expect(page.locator('[aria-labelledby="services-title"] article')).toHaveCount(5);
      await expect(page.locator('#hero-title, #form-title')).toHaveCount(2);

      // A completed services reveal must not be armed again by refreshing the team.
      const servicePhoto = page.locator('[aria-labelledby="services-title"] .photo').first();
      await servicePhoto.scrollIntoViewIfNeeded();
      await expect.poll(() => servicePhoto.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
      await setStaff('home-slow');
      await retry.focus();
      await retry.press('Enter');
      await expect(block.getByText('Loading the team…')).toBeVisible();
      await expect(retry).toBeFocused();
      await expect(retry).toHaveAttribute('aria-disabled', 'true');
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await release(staffScenario);
      await expect(block.locator('.staff')).toHaveCount(names.length);
      await expect(block.locator('h2')).toBeFocused();
      const photo = block.locator('.home-team-photo').first();
      await expect.poll(() => photo.evaluate((el) => getComputedStyle(el).clipPath)).toContain('inset(8%');
      assert.equal(await servicePhoto.evaluate((el) => getComputedStyle(el).clipPath), 'none', 'team refresh reset service reveals');
      await photo.scrollIntoViewIfNeeded();
      await expect.poll(() => photo.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
      await expect(page.locator('#qf-service option[value="101"]')).toHaveCount(0);
      await expect(page.locator('#qf-service option[value^="912"]')).toHaveCount(5);
      await expect(page.locator('[aria-labelledby="form-title"] select[name="staff"] option')).toHaveCount(1);
      await expect(page.locator('.demo-notice')).toBeVisible();
    });
    for (const locale of ['en', 'ru']) {
      const html = await home(origin, locale);
      const nameLinks = [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
        .filter(([, , name]) => names.includes(name)).map(([, href, name]) => ({ href, name }));
      assert.deepEqual(nameLinks, dataFor(locale).staff.map(({ id, name }) => ({ href: `/${locale}/team/staff-${id}/`, name })),
        'server-rendered name links');
      assert.ok(!html.includes('Hidden Example') && !html.includes('Dismissed Example'));
      await api(origin, `?locale=${locale}`, 200, expected(locale));
      const service = await fetch(`${origin}/api/catalog/services?locale=${locale}`);
      assert.equal(service.status, 200);
      assert.equal((await service.json()).data.services.length, 5);
    }
    await api(origin, '', 200, expected('en'));
    assert.deepEqual(staffCalls(logs), ['[staff-fixture] 500 en-US', '[staff-fixture] home-slow en-US', '[staff-fixture] home-slow ru-RU']);
    assert.equal(calls(logs, 'catalog').length, 2, 'one services request per locale');

    for (const width of [320, 390, 768, 1280]) {
      await browserPage(browser, width, async (page, block) => {
        const locale = width === 390 || width === 1280 ? 'en' : 'ru';
        await page.goto(`${origin}/${locale}/`);
        await expect(block.locator('h2')).toHaveText(locale === 'en' ? 'People you can trust' : 'Люди, которым вы доверяете');
        const cards = block.locator('.staff');
        await expect(cards.locator('b')).toHaveText(names);
        await expect(cards.locator('.cap')).toHaveCount(0);
        await expect(block.locator('.sec-head a')).toHaveAttribute('href', '#');
        await expect(block.locator('.team-intro p')).toHaveText(locale === 'en'
          ? 'Meet our specialists and choose who you’d like to book with.'
          : 'Познакомьтесь со специалистами студии и выберите того, к кому хотите записаться.');
        await expect(block.locator('.team-intro a')).toHaveAttribute('href', '#');
        assert.equal(await block.locator('.team-intro').evaluate((el) => el.scrollWidth <= el.clientWidth
          && el.getBoundingClientRect().right <= el.parentElement.getBoundingClientRect().right + 1), true);
        const nameLinks = cards.locator('b a');
        await expect(nameLinks).toHaveText(names);
        for (const [index, { id }] of dataFor(locale).staff.entries()) {
          await expect(nameLinks.nth(index)).toHaveAttribute('href', `/${locale}/team/staff-${id}/`);
        }
        await expect(block.locator('a:not([href="#"]), .go, .badge')).toHaveCount(names.length);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await cards.first().locator('b').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        await cards.first().scrollIntoViewIfNeeded();
        const photo = cards.first().getByRole('img', { name: longName });
        await expect(photo).toHaveAttribute('loading', 'lazy');
        await expect.poll(() => photo.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
        assert.equal(await cards.first().locator('.home-team-photo').evaluate((el) => getComputedStyle(el).aspectRatio), '4 / 4.6');
        await cards.nth(1).scrollIntoViewIfNeeded();
        await expect(cards.nth(1).locator('.ph')).toBeVisible();
        await expect(cards.nth(3).locator('.ph')).toBeAttached();

        const track = block.locator('.track');
        const scrollLeft = () => track.evaluate((el) => el.scrollLeft);
        await track.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
        await expect.poll(scrollLeft).toBe(0);
        const [prev, next] = await block.locator('.arr button').all();
        await expect(prev).toHaveAttribute('aria-disabled', 'true');
        await screenshot(block, `${locale}-${width}`);
        await next.focus();
        await next.press('Enter');
        await expect.poll(scrollLeft).toBeGreaterThan(0);
        if (width === 390) {
          await expect.poll(scrollLeft).toBeGreaterThan(300);
          await screenshot(block, 'en-390-portrait');
        }
        await expect(prev).not.toHaveAttribute('aria-disabled', 'true');
        await prev.press('Space');
        await expect.poll(scrollLeft).toBe(0);
        if (width === 390) {
          const box = await track.boundingBox();
          const client = await page.context().newCDPSession(page);
          const y = Math.round(box.y + box.height / 2);
          await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
          for (const x of [250, 200, 150, 100, 50]) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
          }
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect.poll(scrollLeft).toBeGreaterThan(0);
          await client.detach();
        }
      });
    }
  }, env);
  console.log('HomeTeam states, retry focus, motion, photos and carousel in RU/EN: OK');

  assert.equal(written.size, 4);
  let englishEntry;
  for (const file of written) {
    const entry = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(entry.revalidate, 14_400);
    const data = JSON.parse(entry.data.body);
    if (data.staff?.[0].specialization === 'Specialization EN') englishEntry = file;
  }
  assert.ok(englishEntry);
  const stale = new Date(Date.now() - 14_401_000);
  await fs.utimes(englishEntry, stale, stale);
  const previousWrite = (await fs.stat(englishEntry)).mtimeMs;
  await setStaff('500');
  await run(async (origin, logs) => {
    const burst = (data) => Promise.all(Array.from({ length: 12 }, () => api(origin, '', 200, expected('en', data))));
    await burst(dataFor('en'));
    await expect.poll(logs).toContain("code: 'CATALOG_UNAVAILABLE'");
    assert.equal(staffCalls(logs).length, 1);
    assert.equal((await fs.stat(englishEntry)).mtimeMs, previousWrite);
    await setStaff('empty');
    await burst(dataFor('en'));
    await expect.poll(logs).toContain('[catalog-cache-write]');
    await api(origin, '', 200, expected('en', { staff: [] }));
    await api(origin, '?locale=ru', 200, expected('ru'));
    assert.equal(staffCalls(logs).length, 2);
    await browserPage(browser, 390, async (page, block) => {
      await page.goto(`${origin}/en/`);
      await expect(block.getByText('No specialist profiles are currently listed.')).toBeVisible();
      await expect(block.locator('.car, .team-intro, button')).toHaveCount(0);
      await screenshot(block, 'empty');
    });
  }, env);

  await setStaff('home-single');
  await setServices('home-slow');
  await run(async (origin, logs) => {
    await browserPage(browser, 320, async (page, block) => {
      await page.goto(`${origin}/en/`, { waitUntil: 'commit' });
      const services = page.locator('[aria-labelledby="services-title"]');
      await expect(services.getByText('Loading services…')).toBeVisible();
      await expect(block.locator('.staff')).toHaveCount(1);
      await expect(block.locator('.team-intro a')).toHaveAttribute('href', '#');
      await expect(block.locator('.arr button')).toHaveCount(2);
      await release(servicesScenario);
      await expect(services.locator('article')).toHaveCount(5);
    });
    assert.equal(staffCalls(logs).length, 1);
  });

  await fs.unlink(`${staffScenario}.release`);
  await setStaff('home-slow');
  await setServices('success');
  await run(async (origin, logs) => {
    await browserPage(browser, 390, async (page, block) => {
      await page.goto(`${origin}/en/`, { waitUntil: 'commit' });
      await expect(block.getByText('Loading the team…')).toBeVisible();
      await expect(page.locator('[aria-labelledby="services-title"] article')).toHaveCount(2);
      await expect(page.locator('#hero-title, #form-title')).toHaveCount(2);
      const pending = Array.from({ length: 12 }, () => api(origin, '', 200, expected('en')));
      await release(staffScenario);
      await Promise.all(pending);
      await expect(block.locator('.staff')).toHaveCount(names.length);
    });
    assert.equal(staffCalls(logs).length, 1, 'cold API and Server Component should share one request');
    for (const route of ['team/', 'team/specialist-1/', 'services/manual/', 'services/service-42/', 'lp/a/', 'lp/b/', 'booking/']) {
      const response = await fetch(`${origin}/en/${route}`);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.ok(names.every((name) => !html.includes(name)), route);
    }
    assert.equal(staffCalls(logs).length, 1, 'other routes should not load staff');
  });
  console.log('Staff cache: 14400 seconds, separate locales and resources, shared cold requests and stale recovery: OK');

  await setStaff('500');
  await setServices('empty');
  await run((origin) => browserPage(browser, 1280, async (page, block) => {
    await page.goto(`${origin}/en/`);
    await expect(block.getByRole('button', { name: 'Try again' })).toBeVisible();
    await screenshot(block, 'error');
  }));
} finally {
  await browser?.close();
  await Promise.all([...written, staffScenario, servicesScenario, `${staffScenario}.release`, `${servicesScenario}.release`]
    .map((file) => fs.unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; })));
  await fs.rmdir(dir);
}
