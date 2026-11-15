import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-services-list-'));
const scenario = path.join(dir, 'scenario');
const release = `${scenario}.release`;
const cacheFiles = new Set();
const token = 'fixture-partner-token';

function run(check) {
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
    ALTEGIO_CURRENCY: 'AED',
    CATALOG_TEST_SCENARIO: scenario,
  } });
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const browserRequests = [];
  const pageErrors = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'api.alteg.io' || url.pathname.startsWith('/api/catalog/services')) {
      browserRequests.push(request.url());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const cards = page.locator('main .card-grid article');
  const titles = cards.locator('h2');
  const categories = page.locator('main .list-bar .chip');
  await fs.writeFile(scenario, '500');
  await run(async (origin, logs) => {
    const response = await page.goto(`${origin}/en/services/`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['cache-control'], /\bno-store\b/);
    assert.ok(!(await response.text()).includes(token));
    await expect(page.getByText(/We couldn’t load the\s+services/)).toBeVisible();
    await expect(cards).toHaveCount(0);
    const retry = page.getByRole('button', { name: 'Try again' });
    await fs.writeFile(scenario, 'catalog-list-slow');
    await retry.focus();
    await retry.press('Enter');
    await expect(page.getByText('Loading services…')).toBeVisible();
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await fs.writeFile(release, '');
    const englishTitles = ['First massage', 'Uncategorized', 'Second massage', 'Missing category'];
    await expect(titles).toHaveText(englishTitles);
    await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeFocused();
    await expect(categories).toHaveText(['All categories', 'Massage', 'Empty category', 'Recovery']);
    await expect(cards.locator('.badge, dl')).toHaveCount(0);

    await page.goto(`${origin}/en/services/?category=30`);
    await expect(titles).toHaveText(['First massage', 'Second massage']);
    await page.goto(`${origin}/en/services/?category=20`);
    await expect(titles).toHaveCount(0);
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    await page.goto(`${origin}/en/services/?category=99`);
    await expect(titles).toHaveText(englishTitles);

    await fs.unlink(release);
    await page.goto(`${origin}/ru/services/`, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: 'Услуги', level: 1 })).toBeVisible();
    await expect(page.locator('main [role="status"]')).toHaveText('Загружаем услуги…');
    await expect(cards).toHaveCount(0);
    await fs.writeFile(release, '');
    await expect(titles).toHaveText(['Первый массаж', 'Без категории', 'Второй массаж', 'Исчезнувшая категория']);
    await expect(categories).toHaveText(['Все категории', 'Массаж', 'Пустая категория', 'Восстановление']);
    for (let index = 0; index < 3; index++) {
      await expect(categories.nth(index + 1)).toHaveAttribute('href',
        `/ru/services/?category=${[30, 20, 10][index]}`);
    }
    assert.deepEqual(logs().match(/\[catalog-fixture\] [^\r\n]+/g), [
      '[catalog-fixture] 500 en-US', '[catalog-fixture] catalog-list-slow en-US', '[catalog-fixture] catalog-list-slow ru-RU',
    ]);
  });

  await fs.writeFile(scenario, 'empty');
  await run(async (origin) => {
    await page.goto(`${origin}/en/services/`);
    await expect(page.getByText('No services are currently listed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(cards).toHaveCount(0);
  });
  assert.deepEqual(browserRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log('Services list: RU/EN, order, category IDs, streaming, empty catalog, retry and server-only CRM requests: OK');
} finally {
  await browser?.close();
  await Promise.all([...cacheFiles, scenario, release].map((file) => fs.rm(file, { force: true })));
  await fs.rmdir(dir);
}
