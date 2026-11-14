import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const token = 'fixture-partner-token';
const privateValues = [token, 'fixture raw upstream detail', 'https://api.alteg.io/api/v1/private'];
const section = 'section.section.home-sec[aria-labelledby="services-title"]';
const longTitle = 'Терапевтический массаж с очень длинным названием для проверки переноса строк';
const cacheDir = path.resolve('.next/cache/fetch-cache');
const shots = path.resolve('e2e/shots/home-services');
const shotStyle = '.site-header, .fab-wrap { visibility: hidden !important; }';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-home-services-'));
const scenario = path.join(dir, 'scenario');
const release = `${scenario}.release`;
const written = new Set();
const setScenario = (value) => fs.writeFile(scenario, value);
const fixtureEnv = (currency = 'AED') => ({
  ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
  ALTEGIO_PARTNER_TOKEN: token,
  ALTEGIO_CURRENCY: currency,
  CATALOG_TEST_SCENARIO: scenario,
});

function run(check, env = fixtureEnv()) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      assert.ok(privateValues.every((value) => !logs().includes(value)), 'private values in server logs');
      assert.doesNotMatch(logs(), /\[catalog-unhandled-rejection\]/);
    } finally {
      for (const match of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) {
        written.add(path.join(cacheDir, match[1]));
      }
    }
  }, { env, preload });
}

async function home(origin, locale = 'en') {
  const response = await fetch(`${origin}/${locale}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/);
  const html = await response.text();
  assert.ok(privateValues.every((value) => !html.includes(value)), 'private values in HTML or RSC');
  return html;
}

async function browserPage(browser, viewport, check) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 768 });
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, analytics: false, marketing: false, at: 'gate',
  })));
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.includes('images.example.test')) failures.push(message.text());
    if (message.type() === 'warning' && /hydrat/i.test(message.text())) failures.push(message.text());
  });
  await page.route(/api\.alteg\.io|\/api\/catalog\/services/, async (route) => {
    failures.push(`Unexpected browser request: ${route.request().url()}`);
    await route.abort();
  });
  await page.route('https://images.example.test/**', async (route) => {
    assert.equal(route.request().headers().authorization, undefined);
    assert.equal(route.request().headers().referer, undefined);
    if (route.request().url().endsWith('broken.webp')) return route.fulfill({ status: 404 });
    await route.fulfill({ path: 'public/photos/services/sports-640.webp' });
  });
  try {
    await check(page, page.locator(section));
    assert.deepEqual(failures, []);
  } finally {
    await page.close();
  }
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  await fs.mkdir(shots, { recursive: true });
  const env = fixtureEnv();
  await setScenario('500');
  await run(async (origin, logs) => {
    await browserPage(browser, { width: 1280, height: 850 }, async (page, block) => {
      // Exercise the production animation path, which normally skips WebDriver.
      await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
      await page.goto(`${origin}/en/`);
      const retry = block.getByRole('button', { name: 'Try again' });
      await expect(retry).toBeVisible();
      await expect(page.locator('#hero-title, #team-title, #form-title')).toHaveCount(3);
      await block.screenshot({ path: path.join(shots, 'error.png'), style: shotStyle });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

      await setScenario('home-slow');
      await retry.focus();
      await retry.press('Enter');
      await expect(block.getByText('Loading services…')).toBeVisible();
      await expect(retry).toBeFocused();
      await expect(retry).toHaveAttribute('aria-disabled', 'true');
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await fs.writeFile(release, '');
      await expect(block.locator('article')).toHaveCount(5);
      await expect(block.locator('h2')).toBeFocused();
      const photo = block.locator('.photo').first();
      await expect.poll(() => photo.evaluate((el) => getComputedStyle(el).clipPath)).toContain('inset(8%');
      await photo.scrollIntoViewIfNeeded();
      await expect.poll(() => photo.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
      await expect(page.locator('#qf-service option[value="101"]')).toHaveCount(1);
      await expect(page.locator('#qf-service option[value^="9120"]')).toHaveCount(0);
      await expect(page.locator('.demo-notice')).toBeVisible();
    });

    const en = await home(origin);
    const ru = await home(origin, 'ru');
    for (const html of [en, ru]) {
      assert.match(html, /<h3[^>]*>Терапевтический массаж/);
      assert.match(html, /<h3[^>]*>Zero price massage/);
    }
    assert.match(en, /<h3[^>]*>Range massage/);
    assert.match(ru, /<h3[^>]*>Массаж с диапазоном цен/);
    const api = await fetch(`${origin}/api/catalog/services?locale=ru`);
    assert.equal(api.status, 200);
    const { data: { services } } = await api.json();
    assert.deepEqual(services.map(({ id }) => id), [91201, 91202, 91203, 91204, 91205]);
    assert.equal(services[1].title, 'Массаж с диапазоном цен');
    assert.deepEqual(logs().match(/\[catalog-fixture\] [^\r\n]+/g), [
      '[catalog-fixture] 500 en-US', '[catalog-fixture] home-slow en-US', '[catalog-fixture] home-slow ru-RU',
    ], 'home and API share a cache entry for each locale');

    for (const width of [320, 390, 768, 1280]) {
      await browserPage(browser, { width, height: 850 }, async (page, block) => {
        const locale = width === 390 || width === 1280 ? 'en' : 'ru';
        await page.goto(`${origin}/${locale}/`);
        await expect(block.locator('h2')).toHaveText(locale === 'ru'
          ? 'Массаж и восстановление для вашего ритма' : 'Massage and recovery that keep up with you');
        const cards = block.locator('article');
        await expect(cards.locator('h3')).toHaveText([
          longTitle, locale === 'ru' ? 'Массаж с диапазоном цен' : 'Range massage',
          'Minimum massage', 'Zero price massage', 'Unknown price massage',
        ]);
        await expect(block.locator('a, .go, .badge')).toHaveCount(0);
        await expect(block.locator('article .d')).toHaveCount(1);
        await expect(cards.first().locator('.head + .d')).toHaveText(locale === 'ru'
          ? 'Массаж для восстановления после нагрузки.' : 'Massage for post-exercise recovery.');
        const prices = cards.locator('dd:first-of-type');
        const priceAt = (i) => cards.nth(i).locator('dd').first();
        await expect(priceAt(0)).toHaveText(/120/);
        await expect(priceAt(1)).toHaveText(/80\s*–\s*160/);
        await expect(priceAt(2)).toHaveText(/^(From|От)\s+.*(55[,.]5)/);
        await expect(priceAt(3)).toHaveText(/^(?:AED\s+)?0(?:\s+AED)?$/);
        await expect(priceAt(4)).toHaveText(locale === 'ru' ? 'Стоимость уточняется' : 'Price to be confirmed');
        await expect(prices).toHaveCount(6);
        await expect(cards.first().locator('dd').nth(1)).toHaveText(/100\s+(мин|min)/);
        await cards.first().scrollIntoViewIfNeeded();
        const photo = cards.first().getByRole('img', { name: longTitle });
        await expect.poll(() => photo.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
        await expect(cards.nth(1).locator('.ph')).toBeVisible();
        await expect(cards.nth(4).locator('.ph')).toBeAttached();
        assert.equal(await block.locator('.photo').first().evaluate((el) => getComputedStyle(el).aspectRatio), '4 / 5');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await cards.first().locator('h3').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        await block.screenshot({ path: path.join(shots, `${locale}-${width}.png`), style: shotStyle });

        const track = block.locator('.track');
        const next = block.locator('.arr button').last();
        const prev = block.locator('.arr button').first();
        await expect(prev).toHaveAttribute('aria-disabled', 'true');
        await next.focus();
        await next.press('Enter');
        await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await prev.press('Space');
        await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBe(0);
        if (width === 390) {
          await track.scrollIntoViewIfNeeded();
          const box = await track.boundingBox();
          const client = await page.context().newCDPSession(page);
          const y = Math.round(box.y + box.height / 2);
          await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
          for (const x of [250, 200, 150, 100, 50]) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
          }
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
          await client.detach();
        }
      });
    }
  }, env);

  const [englishEntry] = written;
  assert.equal(written.size, 2);
  for (const entry of written) assert.equal(JSON.parse(await fs.readFile(entry, 'utf8')).revalidate, 14_400);
  const stale = new Date(Date.now() - 14_401_000);
  await fs.utimes(englishEntry, stale, stale);
  await setScenario('empty');
  await run(async (origin, logs) => {
    assert.ok((await home(origin)).includes(longTitle));
    for (let i = 0; i < 30 && !logs().includes('[catalog-cache-write]'); i++) await delay(100);
    await browserPage(browser, { width: 390, height: 850 }, async (page, block) => {
      await page.goto(`${origin}/en/`);
      await expect(block.getByText('No services are currently listed.')).toBeVisible();
      await expect(block.locator('.car, button')).toHaveCount(0);
    });
    assert.match(await home(origin, 'ru'), /<h3[^>]*>Массаж с диапазоном цен/);
    assert.equal((logs().match(/\[catalog-fixture\]/g) ?? []).length, 1);
  }, env);

  await setScenario('home-single');
  await run(async (origin) => {
    await browserPage(browser, { width: 320, height: 850 }, async (page, block) => {
      await page.goto(`${origin}/ru/`);
      await expect(block.locator('article')).toHaveCount(1);
      await expect(block.locator('dd')).toHaveText(['Стоимость уточняется', /100\s+мин/]);
      await expect(block.locator('.arr')).toHaveCount(0);
    });
  }, fixtureEnv(''));

  await fs.unlink(release);
  await setScenario('home-slow');
  await run(async (origin) => {
    await browserPage(browser, { width: 390, height: 850 }, async (page, block) => {
      await page.goto(`${origin}/en/`, { waitUntil: 'commit' });
      await expect(block.getByText('Loading services…')).toBeVisible();
      await expect(page.locator('#hero-title, #team-title, #form-title')).toHaveCount(3);
      await expect(block.locator('article')).toHaveCount(0);
      await fs.writeFile(release, '');
      await expect(block.locator('article')).toHaveCount(5);
    });
  });
  console.log('Home services: streaming, retry, per-locale shared cache, localized cards and carousel at 320/390/768/1280: OK');
} finally {
  await browser?.close();
  await Promise.all([...written, scenario, release].map((file) => fs.unlink(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  })));
  await fs.rmdir(dir);
}
