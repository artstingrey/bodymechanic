import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, webkit } from '@playwright/test';
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
    original: ['80–160 USD', '125,5 USD', '0 USD', 'От 99 USD'],
    outsideOffer: '−20% на первый визит: Комбинированный массаж с инфракрасной капсулой · 100,4–199,6 USD вместо 125,5–249,5 USD',
    neutralOffer: '−20% на первый визит · стоимость уточняется' },
  en: { messages: en, language: 'en-US', viewport: { width: 1280, height: 850 }, crop: 'tall',
    sale: ['USD 64–128', 'USD 100.4', 'USD 0', 'From USD 79.2'],
    original: ['USD 80–160', 'USD 125.5', 'USD 0', 'From USD 99'],
    outsideOffer: '20% off your first visit: Massage with an infrared capsule and stretching · USD 100.4–199.6 instead of USD 125.5–249.5',
    neutralOffer: '20% off your first visit · price to be confirmed' },
};
const layouts = [
  { width: 390, height: 844, slot: '.lp-media' },
  { width: 390, height: 650, slot: '.lp-media' },
  { width: 375, height: 548, slot: '.lp-copy' },
  { width: 768, height: 960, slot: '.lp-copy' },
  { width: 1280, height: 850, slot: '.lp-copy' },
];

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

async function checkCatalog(browser, variant, isChrome) {
  const page = await browser.newPage({ reducedMotion: 'reduce', hasTouch: true });
  const mapUrl = /^https:\/\/www\.google\.com\/maps\/embed\?pb=.*HDS%20Tower/;
  await page.route(mapUrl, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>HDS Tower</title><p>HDS Tower</p>',
  }));
  const browserRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['api.alteg.io', 'images.example.test'].includes(url.hostname) || url.pathname.startsWith('/api/catalog/services')) {
      browserRequests.push(url.href);
    }
  });
  await page.route('https://images.example.test/**', (route) => route.abort());
  const section = page.locator('[aria-labelledby="lp-services"]');
  const cards = section.locator('.lp-card');
  const carousel = section.locator('.car');
  const track = carousel.locator('.track');
  const hero = page.locator('.lp-hero');
  const photo = hero.locator('picture img');
  const heroOffers = hero.locator('.offer-pill');
  const finalOffer = page.locator('.lp-final .lbl');
  const expectOffer = async (text) => {
    await expect(heroOffers).toHaveText([text, text]);
    await expect(finalOffer).toHaveText(text);
  };
  const cardIds = () => cards.evaluateAll((elements) => elements.map((card) => card.dataset.serviceId));
  const snapshot = () => hero.evaluate((element) => {
    return ['#lp-h1', '.lp-copy > .sub', '.lp-media'].map((selector) => {
      const { x, y, width, height } = element.querySelector(selector).getBoundingClientRect();
      return [x, y, width, height];
    });
  });

  await run('lp-slow', async (origin, logs) => {
    for (const [locale, { messages, language, viewport, crop, sale, original, neutralOffer }] of Object.entries(locales)) {
      await page.setViewportSize(viewport);
      if (!isChrome) await fs.writeFile(release, '');
      await page.goto(`${origin}/${locale}/lp/${variant}/`, { waitUntil: isChrome ? 'commit' : 'load' });
      if (isChrome) {
        await expect(section.getByRole('status')).toHaveText(messages.home.services.loading);
        await expectOffer(neutralOffer);
      }
      await expect(hero.locator('#lp-h1')).toHaveText(messages.lp.h1[variant + '1']);
      await expect(hero.locator('.lp-copy > .sub')).toHaveText(messages.lp[variant].sub);
      await expect(page).toHaveTitle(messages.lp[variant].seo.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', messages.lp[variant].seo.description);
      assert.equal(new URL(await page.locator('meta[property="og:image"]').getAttribute('content')).pathname, `/og/og-lp-${variant}-${locale}.png`);
      await expect(photo).toHaveAttribute('fetchpriority', 'high');
      await expect(page.locator(`link[rel="preload"][as="image"][fetchpriority="high"][imagesrcset*="/lp/${variant}-"]`)).toHaveCount(3);
      const format = isChrome ? 'avif' : '(?:avif|webp)';
      await expect.poll(() => photo.evaluate((img) => img.naturalWidth > 1 && img.currentSrc)).toMatch(new RegExp(`/lp/${variant}-${crop}-.*\\.${format}$`));
      if (isChrome) {
        await page.evaluate(() => document.fonts.ready);
        const before = await snapshot();
        await fs.writeFile(release, '');
        await expect(cards).toHaveCount(5);
        assert.deepEqual(await snapshot(), before);
      }
      await expect(cards).toHaveCount(5);
      assert.deepEqual(await cardIds(), ids);
      await expect(page.getByText(/Иллюстративное фото|Illustrative photo/i)).toHaveCount(0);
      await expect(finalOffer).not.toHaveText(neutralOffer);
      const selected = (await finalOffer.textContent()).replace(/\s+/g, ' ').trim();
      await expectOffer(selected);
      assert.match(selected, /USD/);
      const colors = await cards.evaluateAll((elements) => elements.map((card) => getComputedStyle(card).backgroundColor));
      assert.equal(new Set(colors.slice(0, 3)).size, 3);
      assert.deepEqual(colors.slice(3), [colors[0], colors[0]]);
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
      await expect.poll(() => loadedPhoto.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
      for (const [index, name] of ['sports-massage', 'classic-massage', 'ice-bath', 'infrared-capsule', 'functional-training'].entries()) {
        await expect(cards.nth(index).locator('img')).toHaveAttribute('src', `/photos/website-services/${name}-640.webp`);
      }

      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 850 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(await cards.evaluateAll((elements) => elements.flatMap((card) => {
          const bounds = card.getBoundingClientRect();
          const content = card.querySelectorAll('.bd h3, .bd p, dl, dt, dd, .price, s');
          return Array.from(content).flatMap((element) => {
            const outside = element.getBoundingClientRect().right - bounds.right;
            const overflow = element.scrollWidth - element.clientWidth;
            return outside > 1 || overflow > 1 && element.clientWidth > 0
              ? [{ id: card.dataset.serviceId, tag: element.tagName, outside, overflow }] : [];
          });
        })), [], `${locale} ${width}px card overflow`);
        await expect.poll(async () => track.evaluate((el) => {
          el.scrollTo({ left: 0, behavior: 'instant' });
          return el.scrollLeft;
        }), { message: `${locale} ${width}px carousel starts at the first card` }).toBe(0);
        const prev = carousel.getByRole('button', { name: messages.a11y.carousel.prev });
        const next = carousel.getByRole('button', { name: messages.a11y.carousel.next });
        const progress = carousel.locator('.prog i');
        await expect(prev, `${locale} ${width}px previous arrow at start`).toBeDisabled();
        await expect(next).toBeEnabled();
        await expect.poll(() => progress.evaluate((el) => el.style.width)).not.toBe('');
        const initialProgress = await progress.evaluate((el) => el.style.transform);
        await next.press('Enter');
        await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await expect.poll(() => progress.evaluate((el) => el.style.transform)).not.toBe(initialProgress);
        await expect(prev).toBeEnabled();
        await prev.press('Space');
        await expect.poll(() => track.evaluate((el) => el.scrollLeft), { message: `${locale} ${width}px previous arrow returns to start` }).toBe(0);
      }

      if (isChrome) {
        await page.setViewportSize({ width: 390, height: 850 });
        await track.scrollIntoViewIfNeeded();
        const box = await track.boundingBox();
        const y = Math.round(box.y + box.height / 2);
        const client = await page.context().newCDPSession(page);
        try {
          await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
          for (const x of [250, 200, 150, 100, 50]) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
          }
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        } finally {
          await client.detach();
        }
      }

      const response = await fetch(`${origin}/api/catalog/services?locale=${locale}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.services.length, 7);
      assert.equal(logs().split(`[catalog-fixture] lp-slow ${language}`).length - 1, 1);
      await fs.unlink(release);
    }
    assert.equal(logs().match(/\[catalog-fixture\]/g)?.length, 2);
  });

  await run('lp-unlisted', async (origin, logs) => {
    for (const [locale, { messages, outsideOffer, language }] of Object.entries(locales)) {
      const [mapRequest] = await Promise.all([
        page.waitForRequest(mapUrl),
        page.goto(`${origin}/${locale}/lp/${variant}/`),
      ]);
      assert.equal(mapRequest.isNavigationRequest(), true);
      const directions = page.locator('#lp-directions');
      const map = directions.locator('iframe');
      await expect(directions.locator('address')).toContainText('HDS Tower Cluster F, 16 floor, 1606');
      await expect(map).toHaveAttribute('src', mapUrl);
      await expect(map).toHaveAttribute('loading', 'eager');
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 850 });
        const bounds = await map.boundingBox();
        assert.ok(bounds && bounds.height >= 200 && bounds.x >= 0 && bounds.x + bounds.width <= width);
      }
      for (const { width, height, slot } of layouts) {
        await page.setViewportSize({ width, height });
        await expectOffer(outsideOffer);
        await expect(hero.locator(`${variant === 'b' ? '.lp-copy' : slot} .offer-pill`)).toBeVisible();
        assert.equal(await hero.locator('.offer-pill:visible').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (variant === 'a' && slot === '.lp-media') {
          const pill = await hero.locator('.lp-media .offer-pill').boundingBox();
          const markers = await hero.locator('.lp-media :is(.tag, .co span):visible').all();
          for (const marker of markers) {
            const box = await marker.boundingBox();
            const overlaps = pill.x < box.x + box.width && pill.x + pill.width > box.x &&
              pill.y < box.y + box.height && pill.y + pill.height > box.y;
            assert.equal(overlaps, false, `${locale} ${width}×${height}: offer overlaps ${await marker.textContent()}`);
          }
        }
      }
      await expect(section.getByRole('status')).toHaveText(messages.home.services.empty);
      await expect(cards).toHaveCount(0);
      await page.goto(`${origin}/${locale}/lp/${variant}/?form=sheet`);
      await expect(hero.locator('.lp-hero-cta')).toBeVisible();
      await expectOffer(outsideOffer);
      assert.equal(logs().split(`[catalog-fixture] lp-unlisted ${language}`).length - 1, 1);
    }
  });

  await run('lp-missing', async (origin) => {
    for (const [locale, { messages, neutralOffer }] of Object.entries(locales)) {
      await page.goto(`${origin}/${locale}/lp/${variant}/`);
      await expect(cards).toHaveCount(4);
      assert.deepEqual(await cardIds(), ids.filter((id) => id !== '13982363'));
      await expect(section.locator('dd')).toHaveText([
        messages.home.services.priceUnknown, locale === 'ru' ? '75 мин' : '75 min',
        ...Array(3).fill(messages.home.services.priceUnknown),
      ]);
      await expect(cards.locator('s')).toHaveCount(0);
      await expectOffer(neutralOffer);
    }
  }, '');

  for (const [scenario, state] of [['empty', 'empty'], ['500', 'errorLoad']]) {
    await run(scenario, async (origin) => {
      for (const [locale, { messages, neutralOffer }] of Object.entries(locales)) {
        await page.goto(`${origin}/${locale}/lp/${variant}/`);
        await expect(section.getByRole('status')).toHaveText(messages.home.services[state]);
        await expect(cards).toHaveCount(0);
        await expect(hero.locator('#lp-h1')).toBeVisible();
        await expectOffer(neutralOffer);
      }
    });
  }
  await run('lp-unpriced', async (origin) => {
    for (const [locale, { messages, neutralOffer }] of Object.entries(locales)) {
      await page.goto(`${origin}/${locale}/lp/${variant}/`);
      await expect(cards).toHaveCount(1);
      await expect(cards.locator('dd')).toHaveText(messages.home.services.priceUnknown);
      await expectOffer(neutralOffer);
    }
  });
  assert.deepEqual(browserRequests, []);
  await page.context().close();
}

try {
  for (const [engine, options] of [[chromium, { channel: 'chrome' }], [webkit, {}]]) {
    const browser = await engine.launch(options);
    try {
      for (const variant of ['a', 'b']) {
        await checkCatalog(browser, variant, engine === chromium);
        console.log(`Landing ${variant.toUpperCase()} catalog (${options.channel ?? engine.name()}): RU/EN cards, prices, shared offer, fallbacks, cache and responsive layouts: OK`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
