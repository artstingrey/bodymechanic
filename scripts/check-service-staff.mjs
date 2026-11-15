import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-service-staff-'));
const serviceScenario = path.join(dir, 'catalog');
const staffScenario = path.join(dir, 'staff');
const release = `${staffScenario}.release`;
const cacheKeys = new Set();
const token = 'fixture-partner-token';
const staffBlock = 'section[aria-labelledby="service-specialists-title"]';
const fetchLogs = (logs) => [...logs().matchAll(/\[service-staff-fixture\] (\S+) (\S+) (\d+)/g)].map(([, ...values]) => values);
const setStaff = (scenario) => fs.writeFile(staffScenario, scenario);
const forbidden = [token, 'fixture raw upstream detail', 'Hidden Example', 'Former Example'];
const assertPublic = (text) => assert.ok(forbidden.every((value) => !text.includes(value)), 'private or filtered data in output');

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      assertPublic(logs());
      assert.doesNotMatch(logs(), /\[catalog-unhandled-rejection\]/);
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheKeys.add(key);
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: token,
    ALTEGIO_CURRENCY: 'AED',
    CATALOG_TEST_SCENARIO: serviceScenario,
    SERVICE_STAFF_TEST_SCENARIO: staffScenario,
  } });
}

async function read(origin, url, status, headers) {
  const response = await fetch(origin + url, { headers });
  assert.equal(response.status, status, url);
  const text = await response.text();
  assertPublic(text);
  return text;
}

async function verifyPhotos(page, locale) {
  const block = page.locator(staffBlock);
  const cards = block.locator('.staff');
  await expect(cards.locator('b')).toHaveText(['Alex Example', 'Sam Example']);
  const portrait = cards.first().getByRole('img', { name: 'Alex Example' });
  await portrait.scrollIntoViewIfNeeded();
  await expect.poll(() => portrait.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last().locator('.ph')).toBeVisible();
  const links = cards.locator('b a');
  await expect(links).toHaveText(['Alex Example', 'Sam Example']);
  await expect(links.nth(0)).toHaveAttribute('href', `/${locale}/team/staff-91601/`);
  await expect(links.nth(1)).toHaveAttribute('href', `/${locale}/team/staff-91602/`);
  await expect(cards.locator('.cap')).toHaveCount(0);
  assert.equal(await block.locator('.home-team-photo').first().evaluate((el) => getComputedStyle(el).aspectRatio), '4 / 4.6');
}

let browser;
try {
  await fs.writeFile(serviceScenario, 'service-detail');
  await setStaff('500');
  browser = await chromium.launch({ channel: 'chrome' });
  await run(async (origin, logs) => {
    const serviceJson = await read(origin, '/api/catalog/services/sports', 200);
    assert.equal(JSON.parse(serviceJson).data.service.id, 13982355);
    assert.deepEqual(Object.keys(JSON.parse(serviceJson).data).sort(), ['category', 'service']);
    assert.match(await read(origin, '/ru/services/service-94999/', 404), /container page nf/);
    assert.match(await read(origin, '/en/services/not-in-catalog/', 404), /container page nf/);
    const demo = await read(origin, '/en/services/manual/', 200);
    assert.match(demo, /\/en\/team\/specialist-\d+\//);
    assert.deepEqual(fetchLogs(logs), [], 'unresolved slugs, detail API and demo pages must bypass filtered staff');

    const context = await browser.newContext({ viewport: { width: 390, height: 840 } });
    try {
      const unexpectedRequests = [];
      await context.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
        necessary: true, analytics: false, marketing: false, at: 'gate',
      })));
      await context.route(/api\.alteg\.io|\/api\/catalog\//, async (route) => {
        unexpectedRequests.push(route.request().url());
        await route.abort();
      });
      await context.route('https://images.example.test/**', (route) => {
        assert.equal(route.request().headers().referer, undefined);
        assert.equal(route.request().headers().authorization, undefined);
        return route.request().url().endsWith('broken.webp')
          ? route.fulfill({ status: 404 })
          : route.fulfill({ path: 'public/photos/services/classic-640.webp', contentType: 'image/webp' });
      });

      const page = await context.newPage();
      const block = page.locator(staffBlock);
      const heading = page.locator('.svc-hero h1');
      await page.goto(`${origin}/en/services/sports/`);
      await expect(heading).toHaveText('Sports massage');
      await expect(block.getByRole('status')).toHaveText('We couldn’t load the specialists for this service.');
      const retry = block.getByRole('button', { name: 'Try again' });
      await expect(retry).toBeVisible();
      await expect(block.locator('.staff')).toHaveCount(0);

      await setStaff('slow');
      await retry.focus();
      await retry.press('Enter');
      await expect(block.getByRole('status')).toHaveText('Loading specialists…');
      await expect(retry).toHaveAttribute('aria-disabled', 'true');
      await expect(heading).toBeVisible();
      await fs.writeFile(release, '');
      await expect(block.locator('h2')).toBeFocused();
      await verifyPhotos(page, 'en');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

      await fs.unlink(release);
      await page.setViewportSize({ width: 1280, height: 840 });
      await page.goto(`${origin}/ru/services/sports/`, { waitUntil: 'commit' });
      await expect(heading).toHaveText('Спортивный массаж из каталога');
      await expect(block.getByRole('status')).toHaveText('Загружаем специалистов…');
      await expect(block.locator('.staff')).toHaveCount(0);
      const parallel = Array.from({ length: 4 }, () => read(origin, '/ru/services/sports/', 200));
      await expect.poll(() => fetchLogs(logs).filter(([, locale]) => locale === 'ru-RU').length).toBe(1);
      await fs.writeFile(release, '');
      const samePageResponses = await Promise.all(parallel);
      assert.ok(samePageResponses.every((text) => text.includes('Alex Example')));
      await verifyPhotos(page, 'ru');
      assert.equal(await block.evaluate((el) => getComputedStyle(el).gridColumn), '1 / -1');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

      await setStaff('success');
      await page.goto(`${origin}/ru/services/service-91201/`);
      await expect(block.locator('.staff b')).toHaveText(['Taylor Example']);
      await page.goto(`${origin}/ru/services/service-91204/`);
      await expect(block.getByRole('status')).toHaveText('Для этой услуги пока нет специалистов.');
      await expect(block.locator('button, .staff')).toHaveCount(0);
      await page.goto(`${origin}/ru/services/sports/`);
      await expect(block.locator('.staff b')).toHaveText(['Alex Example', 'Sam Example']);
      assert.deepEqual(unexpectedRequests, []);
    } finally {
      await context.close();
    }
    assert.match(await read(origin, '/en/services/sports/', 200, { RSC: '1' }), /Alex Example/);
    assert.deepEqual(fetchLogs(logs), [
      ['500', 'en-US', '13982355'], ['slow', 'en-US', '13982355'], ['slow', 'ru-RU', '13982355'],
      ['success', 'ru-RU', '91201'], ['success', 'ru-RU', '91204'],
    ], 'filtered staff loads share the cache per service and locale');
  });

  await setStaff('429');
  await run(async (origin, logs) => {
    const url = '/en/services/sports/';
    assert.match(await read(origin, url, 200), /We couldn’t load the specialists/);
    await setStaff('success');
    assert.match(await read(origin, url, 200), /We couldn’t load the specialists/);
    assert.deepEqual(fetchLogs(logs), [['429', 'en-US', '13982355']]);
    await delay(2100);
    assert.match(await read(origin, url, 200), /Alex Example/);
    assert.deepEqual(fetchLogs(logs), [['429', 'en-US', '13982355'], ['success', 'en-US', '13982355']]);
  });

  console.log('Service staff: filtered assignments, localized streaming states, photos, retries and cache isolation OK');
} finally {
  await browser?.close();
  for (const key of cacheKeys) await fs.rm(path.join('.next/cache/fetch-cache', key), { force: true });
  for (const file of [serviceScenario, staffScenario, release]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
