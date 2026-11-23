import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-prices-'));
const scenario = path.join(directory, 'scenario');
const release = `${scenario}.release`;
const cacheFiles = new Set();
const token = 'fixture-partner-token';

async function run(check, currency = 'USD', businessToken = '') {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      assert.doesNotMatch(logs(), /fixture-partner-token|fixture raw upstream detail|\[catalog-unhandled-rejection\]/);
    } finally {
      for (const [, entry] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) {
        cacheFiles.add(path.resolve('.next/cache/fetch-cache', entry));
      }
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: token,
    ALTEGIO_BUSINESS_TOKEN: businessToken,
    ALTEGIO_CURRENCY: currency,
    CATALOG_TEST_SCENARIO: scenario,
  } });
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const browserRequests = [];
  const pageErrors = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'api.alteg.io' || url.pathname.startsWith('/api/catalog/services')) {
      browserRequests.push(request.url());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('https://images.example.test/**', (route) => route.fulfill({ status: 404 }));
  const tables = page.locator('.price-table');
  const groups = page.locator('main .page-sec h2');
  const cta = page.locator('main .page-cta a');

  await fs.writeFile(scenario, '500');
  await run(async (origin, logs) => {
    const response = await page.goto(`${origin}/en/prices/`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /\bno-store\b/);
    assert.doesNotMatch(await response.text(), /fixture-partner-token|fixture raw upstream detail/);
    await expect(page.getByRole('status')).toHaveText('We couldn’t load the prices.');
    await expect(tables).toHaveCount(0);
    await expect(cta).toHaveAttribute('href', '/en/booking/');

    const retry = page.getByRole('button', { name: 'Try again' });
    await fs.writeFile(scenario, 'catalog-list-slow');
    await retry.focus();
    await retry.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Loading prices…');
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await fs.writeFile(release, '');
    await expect(groups).toHaveText(['Massage', 'Recovery', 'Uncategorized']);
    await expect(page.getByRole('heading', { level: 1, name: 'Prices' })).toBeFocused();
    await expect(tables.nth(0).locator('tbody a')).toHaveText(['First massage', 'Second massage']);
    await expect(tables.nth(1).locator('tbody a')).toHaveText(['Mobility session']);
    await expect(tables.nth(2).locator('tbody a')).toHaveText(['Uncategorized', 'Missing category']);

    await fs.unlink(release);
    await page.goto(`${origin}/ru/prices/`, { waitUntil: 'commit' });
    await expect(page.getByRole('status')).toHaveText('Загружаем цены…');
    await expect(tables).toHaveCount(0);
    await fs.writeFile(release, '');
    await expect(groups).toHaveText(['Массаж', 'Восстановление', 'Без категории']);
    await expect(tables.nth(0).locator('tbody a')).toHaveText(['Первый массаж', 'Второй массаж']);
    await expect(tables.nth(1).locator('tbody a')).toHaveText(['Тренировка']);
    await expect(tables.nth(2).locator('tbody a')).toHaveText(['Без категории', 'Исчезнувшая категория']);
    await page.locator('header a[hreflang="en"]').first().click();
    await expect(page).toHaveURL(`${origin}/en/prices/`);
    await expect(groups).toHaveText(['Massage', 'Recovery', 'Uncategorized']);
    await page.locator('header a[hreflang="ru"]').first().click();
    await expect(page).toHaveURL(`${origin}/ru/prices/`);
    await expect(groups).toHaveText(['Массаж', 'Восстановление', 'Без категории']);
    assert.deepEqual(logs().match(/\[catalog-fixture\] [^\r\n]+/g), [
      '[catalog-fixture] 500 en-US', '[catalog-fixture] catalog-list-slow en-US', '[catalog-fixture] catalog-list-slow ru-RU',
    ]);
  });

  await fs.writeFile(scenario, 'empty');
  await run(async (origin) => {
    for (const [locale, empty] of [['ru', 'Список услуг пока пуст.'], ['en', 'No services are currently listed.']]) {
      await page.goto(`${origin}/${locale}/prices/`);
      await expect(page.getByText(empty)).toBeVisible();
      await expect(tables).toHaveCount(0);
      await expect(page.locator('main button')).toHaveCount(0);
    }
  });

  await fs.writeFile(scenario, 'service-detail');
  await run(async (origin) => {
    for (const [locale, columns, sports, from, unknown, minuteUnit] of [
      ['ru', ['Услуга', 'Цена', 'Длительность'], 'Спортивный массаж из каталога', 'От', 'Стоимость уточняется', 'мин'],
      ['en', ['Service', 'Price', 'Duration'], 'Sports massage', 'From', 'Price to be confirmed', 'min'],
    ]) {
      const pricesUrl = `${origin}/${locale}/prices/`;
      const listPath = `/${locale}/services/`;
      const slugs = ['sports', 'service-91201', 'service-91202', 'service-91203', 'service-91204'];
      const row = (slug) => tables.locator('tbody tr').filter({ has: page.locator(`a[href="${listPath}${slug}/"]`) });
      const price = (slug) => row(slug).locator('.price-table__price');
      const duration = (slug) => row(slug).locator('.price-table__duration');
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.goto(pricesUrl);
      await expect(tables.first().locator('thead th')).toHaveText(columns);
      await expect(row('sports').locator('td')).toHaveCount(2);
      await expect(row('sports').locator('a')).toHaveText(sports);
      await expect(price('sports')).toHaveText(/80\s*–\s*160/);
      await expect(price('sports')).toContainText('USD');
      await expect(price('service-91201')).toHaveText(/^(?:USD\s+0|0\s+USD)$/);
      await expect(price('service-91202')).toHaveText(new RegExp(`^${from}\\s+(?:USD\\s+55[,.]5|55[,.]5\\s+USD)$`));
      await expect(price('service-91203')).toHaveText(/^(?:USD\s+125|125\s+USD)$/);
      await expect(price('service-91204')).toHaveText(unknown);
      await expect(duration('sports')).toHaveText(`75 ${minuteUnit}`);
      await expect(duration('service-91201')).toHaveText(`90 ${minuteUnit}`);
      await expect(duration('service-91202')).toBeEmpty();

      const longTitle = row('service-91201').locator('th');
      await expect(longTitle).toBeVisible();
      const desktopHeight = await longTitle.evaluate((cell) => cell.getBoundingClientRect().height);
      await page.setViewportSize({ width: 320, height: 850 });
      await expect(duration('sports')).toBeVisible();
      await expect.poll(() => longTitle.evaluate((cell) => cell.getBoundingClientRect().height)).toBeGreaterThan(desktopHeight);
      assert.ok(await page.locator('.table-wrap').evaluateAll((wraps) => wraps.every((el) => el.scrollWidth <= el.clientWidth)));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      const expected = new Map(await Promise.all(slugs.map(async (slug) => [slug, {
        title: await row(slug).locator('a').innerText(),
        price: await price(slug).innerText(),
        duration: await duration(slug).innerText(),
      }])));
      const serviceCount = await tables.locator('tbody tr').count();
      await page.goto(origin + listPath);
      await expect(page.locator('main .card-grid article')).toHaveCount(serviceCount);
      for (const [slug, facts] of expected) {
        const card = page.locator('main .card-grid article').filter({ has: page.locator(`a[href="${listPath}${slug}/"]`) });
        await expect(card.locator('h2')).toHaveText(facts.title);
        await expect(card.locator('dd').first()).toHaveText(facts.price);
        if (facts.duration) await expect(card.locator('dd').nth(1)).toHaveText(facts.duration);
      }

      for (const slug of ['sports', 'service-91201']) {
        await page.goto(pricesUrl);
        await row(slug).locator('a').click();
        await expect(page).toHaveURL(`${origin}${listPath}${slug}/`);
        await expect(page.locator('.svc-hero h1')).toHaveText(expected.get(slug).title);
        await expect(page.locator('.svc-hero dd').first()).toHaveText(expected.get(slug).price);
        await expect(page.locator('.svc-hero dd').nth(1)).toHaveText(expected.get(slug).duration);
      }

      await page.goto(pricesUrl);
      await expect(cta).toHaveAttribute('href', `/${locale}/booking/`);
      const bookingPage = await browser.newPage();
      try {
        await bookingPage.goto(pricesUrl);
        await bookingPage.locator('main .page-cta a').click();
        await expect(bookingPage).toHaveURL(`${origin}/${locale}/booking/`);
      } finally {
        await bookingPage.close();
      }
    }
  }, 'USD', 'fixture-business-token');

  await run(async (origin) => {
    for (const [locale, unknown] of [['ru', 'Стоимость уточняется'], ['en', 'Price to be confirmed']]) {
      await page.goto(`${origin}/${locale}/prices/`);
      const prices = tables.locator('.price-table__price');
      await expect(prices).toHaveCount(11);
      await expect(prices).toHaveText(Array(11).fill(unknown));
      await expect(page.locator('main .page-head .lead')).not.toContainText(/AED|USD/);
      for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) {
        await expect(page.locator(selector)).toHaveAttribute('content', /^(?!.*\b(?:AED|USD)\b).+$/);
      }
    }
  }, '');

  assert.deepEqual(browserRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log('Prices: RU/EN, category order, price and duration, mobile layout, navigation, loading, empty catalog and retry: OK');
} finally {
  await browser?.close();
  await Promise.all([...cacheFiles, scenario, release].map((file) => fs.rm(file, { force: true })));
  await fs.rmdir(directory);
}

