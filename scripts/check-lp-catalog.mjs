import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import en from '../messages/en.json' with { type: 'json' };
import ru from '../messages/ru.json' with { type: 'json' };
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-lp-catalog-'));
const scenarioFile = path.join(directory, 'scenario');
const release = `${scenarioFile}.release`;
const token = 'fixture-partner-token';
const ids = ['13982355', '13982356', '13982353', '13982363', '13983057'];
const locales = {
  ru: { messages: ru, language: 'ru-RU', viewport: { width: 390, height: 844 }, crop: 'band',
    sale: ['64–128 USD', '100,4 USD', '0 USD', 'От 79,2 USD'],
    original: ['80–160 USD', '125,5 USD', '0 USD', 'От 99 USD'] },
  en: { messages: en, language: 'en-US', viewport: { width: 1280, height: 850 }, crop: 'tall',
    sale: ['USD 64–128', 'USD 100.4', 'USD 0', 'From USD 79.2'],
    original: ['USD 80–160', 'USD 125.5', 'USD 0', 'From USD 99'] },
};

async function run(scenario, check, currency = 'USD') {
  await fs.writeFile(scenarioFile, scenario);
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      assert.doesNotMatch(logs(), /fixture-partner-token|fixture raw upstream detail|\[catalog-unhandled-rejection\]/);
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) {
        await fs.rm(path.resolve('.next/cache/fetch-cache', key), { force: true });
      }
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: token,
    ALTEGIO_CURRENCY: currency,
    CATALOG_TEST_SCENARIO: scenarioFile,
  } });
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const browserRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'api.alteg.io' || url.pathname.startsWith('/api/catalog/services')) {
      browserRequests.push(url.href);
    }
  });
  await page.route('https://images.example.test/live.webp', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"/>',
  }));
  await page.route('https://images.example.test/broken.webp', (route) => route.fulfill({ status: 404 }));
  const section = page.locator('[aria-labelledby="lp-services"]');
  const cards = section.locator('.lp-card');
  const hero = page.locator('.lp-hero');
  const photo = hero.locator('picture img');
  const cardIds = () => cards.evaluateAll((elements) => elements.map((card) => card.dataset.serviceId));
  const snapshot = () => hero.evaluate((element) => {
    return ['#lp-h1', '.lp-copy > .sub', '.lp-media', '#lp-f1'].map((selector) => {
      const { x, y, width, height } = element.querySelector(selector).getBoundingClientRect();
      return [x, y, width, height];
    });
  });

  await run('lp-slow', async (origin, logs) => {
    for (const [locale, { messages, language, viewport, crop, sale, original }] of Object.entries(locales)) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/${locale}/lp/a/`, { waitUntil: 'commit' });
      await expect(section.getByRole('status')).toHaveText(messages.home.services.loading);
      await expect(hero.locator('#lp-h1')).toHaveText(messages.lp.h1.a1);
      await expect(hero.locator('.lp-copy > .sub')).toHaveText(messages.lp.a.sub);
      await expect(photo).toHaveAttribute('fetchpriority', 'high');
      await expect(page.locator('link[rel="preload"][as="image"][fetchpriority="high"][imagesrcset*="/lp/a-"]')).toHaveCount(3);
      await expect.poll(() => photo.evaluate((img) => img.naturalWidth > 1 && img.currentSrc)).toMatch(new RegExp(`/lp/a-${crop}-.*\\.avif$`));
      await page.evaluate(() => document.fonts.ready);
      const before = await snapshot();

      await fs.writeFile(release, '');
      await expect(cards).toHaveCount(5);
      assert.deepEqual(await cardIds(), ids);
      assert.deepEqual(await snapshot(), before);
      const pricedCards = [0, 1, 2, 4];
      for (const [i, cardIndex] of pricedCards.entries()) {
        await expect(cards.nth(cardIndex).locator('dd .price')).toHaveText(sale[i]);
        await expect(cards.nth(cardIndex).locator('dd s')).toHaveText(original[i]);
      }
      await expect(cards.nth(3).locator('dd')).toHaveText(messages.home.services.priceUnknown);
      await expect(cards.nth(3).locator('s')).toHaveCount(0);
      await expect(cards.nth(0).locator('h3')).toHaveText(locale === 'ru' ? 'Спортивный массаж из CRM' : 'Sports massage');
      await expect(cards.nth(0).locator('.bd p')).toHaveText(locale === 'ru' ? 'Описание из CRM.' : en.home.services.cards['13982355'].description);
      await expect(cards.nth(0).locator('dd').nth(1)).toHaveText(locale === 'ru' ? '75 мин' : '75 min');
      await expect(cards.nth(1).locator('dt')).toHaveCount(1);
      const loadedPhoto = cards.nth(0).locator('img');
      await loadedPhoto.scrollIntoViewIfNeeded();
      await expect(loadedPhoto).toHaveAttribute('referrerpolicy', 'no-referrer');
      await expect.poll(() => loadedPhoto.evaluate((img) => img.naturalWidth)).toBe(400);
      const unavailable = messages.home.services.photoUnavailable;
      await cards.nth(1).scrollIntoViewIfNeeded();
      await expect(cards.nth(1).getByRole('img', { name: unavailable })).toBeVisible();
      await expect(cards.nth(2).getByRole('img', { name: unavailable })).toBeVisible();
      await expect(cards.nth(3).getByRole('img', { name: unavailable })).toBeVisible();

      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 850 });
        assert.deepEqual(await cards.evaluateAll((elements) => elements.flatMap((card) => {
          const bounds = card.getBoundingClientRect();
          const content = card.querySelectorAll('.bd h3, .bd p, dl, dt, dd, .price, s');
          return Array.from(content).some((element) => element.getBoundingClientRect().right > bounds.right + 1 ||
            element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) ? [card.dataset.serviceId] : [];
        })), [], `${locale} ${width}px card overflow`);
      }

      const response = await fetch(`${origin}/api/catalog/services?locale=${locale}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.services.length, 6);
      assert.equal(logs().split(`[catalog-fixture] lp-slow ${language}`).length - 1, 1);
      await fs.unlink(release);
    }
    for (const locale of Object.keys(locales)) {
      await page.goto(`${origin}/${locale}/lp/b/`);
      await expect(cards).toHaveCount(3);
      await expect(section.locator('[data-service-id]')).toHaveCount(0);
    }
    assert.equal(logs().match(/\[catalog-fixture\]/g)?.length, 2);
  });

  await run('lp-missing', async (origin) => {
    for (const [locale, { messages }] of Object.entries(locales)) {
      await page.goto(`${origin}/${locale}/lp/a/`);
      await expect(cards).toHaveCount(4);
      assert.deepEqual(await cardIds(), ids.filter((id) => id !== '13982363'));
      await expect(section.locator('dd')).toHaveText([
        messages.home.services.priceUnknown, locale === 'ru' ? '75 мин' : '75 min',
        ...Array(3).fill(messages.home.services.priceUnknown),
      ]);
      await expect(cards.locator('s')).toHaveCount(0);
    }
  }, '');

  for (const [scenario, state] of [['empty', 'empty'], ['lp-unlisted', 'empty'], ['500', 'errorLoad']]) {
    await run(scenario, async (origin) => {
      for (const [locale, { messages }] of Object.entries(locales)) {
        await page.goto(`${origin}/${locale}/lp/a/`);
        await expect(section.getByRole('status')).toHaveText(messages.home.services[state]);
        await expect(cards).toHaveCount(0);
        await expect(hero.locator('#lp-h1')).toBeVisible();
      }
    });
  }
  assert.deepEqual(browserRequests, []);
  console.log('Landing A catalog: RU/EN order, prices, fallbacks, shared cache and responsive hero: OK');
} finally {
  await browser?.close();
  await fs.rm(directory, { recursive: true, force: true });
}
