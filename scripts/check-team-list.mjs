import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-team-list-fixture-'));
const scenario = path.join(dir, 'staff');
const release = `${scenario}.release`;
const cacheFiles = new Set();
const names = ['Александра с очень длинным именем для проверки переноса строк', 'Taylor Example',
  'Sam Example', 'Robin Example', 'Casey Example', 'Jamie Example'];
const ids = [91216, 91214, 91212, 91211, 91213, 91215];
const portraitUrl = 'https://images.example.test/portrait.webp';
const locales = {
  ru: { lang: 'ru-RU', title: 'Команда', loading: 'Загружаем команду…', retry: 'Повторить',
    error: 'Не удалось загрузить команду.', empty: 'Профили специалистов пока не опубликованы.',
    photoUnavailable: 'Фото недоступно', back: 'Все специалисты' },
  en: { lang: 'en-US', title: 'Team', loading: 'Loading the team…', retry: 'Try again',
    error: 'We couldn’t load the team.', empty: 'No specialist profiles are currently listed.',
    photoUnavailable: 'Photo unavailable', back: 'All specialists' },
};

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
      assert.doesNotMatch(logs(), /fixture-partner-token|fixture raw upstream detail|\[catalog-unhandled-rejection\]/);
    } finally {
      for (const [, file] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheFiles.add(file);
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token', ALTEGIO_CURRENCY: '', STAFF_TEST_SCENARIO: scenario,
  } });
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, analytics: false, marketing: false, at: 'gate',
  })));
  const unexpected = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'api.alteg.io' || url.pathname.startsWith('/api/catalog/')) unexpected.push(request.url());
  });
  page.on('pageerror', (error) => unexpected.push(error.message));
  await page.route('https://images.example.test/**', (route) => route.request().url().endsWith('/broken.webp')
    ? route.fulfill({ status: 404 }) : route.fulfill({ path: 'public/photos/services/sports-640.webp' }));
  await page.route('**/api/booking/staff-today?*', (route) => route.fulfill({ json: { data: { times: [] } } }));
  const grid = page.locator('main .card-grid.card-grid--4');
  const cards = grid.locator(':scope > li > .staff');
  const links = cards.locator('b a');
  const status = page.locator('main [role="status"]');

  async function expectProfile(origin, locale) {
    const pathname = `/${locale}/team/staff-${ids[0]}/`;
    await expect(page).toHaveURL(origin + pathname);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1, name: names[0] })).toBeVisible();
    await expect(page.locator('.profile__photo img')).toHaveAttribute('src', portraitUrl);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${pathname}$`));
  }

  async function switchLanguage(locale, pathname) {
    const switcher = page.locator(`header a[hreflang="${locale}"]`).first();
    await expect(switcher).toHaveAttribute('href', pathname);
    await switcher.click();
  }

  await fs.writeFile(scenario, 'home-slow');
  await run(async (origin) => {
    const copy = locales.ru;
    await page.goto(`${origin}/ru/team/`, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { level: 1, name: copy.title })).toBeVisible();
    await expect(status).toHaveText(copy.loading);
    await expect(cards).toHaveCount(0);
    await fs.writeFile(release, '');
    await expect(cards.locator('b')).toHaveText(names);
  });

  await run(async (origin, logs) => {
    for (const [locale, copy] of Object.entries(locales)) {
      await fs.rm(release, { force: true });
      await fs.writeFile(scenario, '500');
      await page.setViewportSize({ width: 320, height: 850 });
      const response = await page.goto(`${origin}/${locale}/team/`);
      assert.equal(response.status(), 200);
      assert.doesNotMatch(await response.text(), /fixture-partner-token|fixture raw upstream detail/);
      const heading = page.getByRole('heading', { level: 1, name: copy.title });
      await expect(heading).toBeVisible();
      await expect(status).toHaveText(copy.error);
      await expect(cards).toHaveCount(0);

      const retry = page.getByRole('button', { name: copy.retry });
      await fs.writeFile(scenario, 'team-list-slow');
      await retry.press('Enter');
      await expect(status).toHaveText(copy.loading);
      await expect(heading).toBeVisible();
      await expect(retry).toHaveAttribute('aria-disabled', 'true');
      const brokenResponse = page.waitForResponse('https://images.example.test/broken.webp');
      await fs.writeFile(release, '');
      await expect(links).toHaveText(names);
      await expect(heading).toBeFocused();
      await expect(page.locator('main .page-head .badge')).toHaveCount(0);
      for (const [index, id] of ids.entries()) {
        await expect(links.nth(index)).toHaveAttribute('href', `/${locale}/team/staff-${id}/`);
      }
      await expect(cards.locator('.cap')).toHaveCount(0);

      const portrait = cards.first().getByRole('img', { name: names[0], exact: true });
      await portrait.scrollIntoViewIfNeeded();
      await expect(portrait).toHaveAttribute('src', portraitUrl);
      await expect.poll(() => portrait.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
      await cards.nth(1).scrollIntoViewIfNeeded();
      assert.equal((await brokenResponse).status(), 404);
      await expect(cards.nth(1).getByRole('img', { name: copy.photoUnavailable })).toBeVisible();
      await expect(cards.nth(3).getByRole('img', { name: copy.photoUnavailable })).toBeVisible();

      for (const [width, columns] of [[320, 1], [1280, 4]]) {
        await page.setViewportSize({ width, height: 850 });
        await expect.poll(() => grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
        assert.ok(await links.first().evaluate((link) => {
          const name = link.parentElement;
          const card = link.closest('article').getBoundingClientRect();
          return name.scrollWidth <= name.clientWidth && card.left >= 0 && card.right <= window.innerWidth;
        }), `long name and card should fit at ${width}px (${locale})`);
      }

      // Same cache entry serves the page and the public API without a third upstream request.
      const api = await fetch(`${origin}/api/catalog/staff?locale=${locale}`);
      assert.equal(api.status, 200);
      assert.deepEqual((await api.json()).data.staff.map(({ name }) => name), names);

      await links.first().click();
      await expectProfile(origin, locale);
      const back = page.locator('.profile').getByRole('link', { name: copy.back, exact: true });
      await expect(back).toHaveAttribute('href', `/${locale}/team/`);
      await back.click();
      await expect(page).toHaveURL(`${origin}/${locale}/team/`);
      await expect(links).toHaveText(names);
    }

    await switchLanguage('ru', '/ru/team/');
    await expect(page).toHaveURL(`${origin}/ru/team/`);
    await expect(page.getByRole('heading', { level: 1, name: locales.ru.title })).toBeVisible();
    await expect(links.first()).toHaveAttribute('href', `/ru/team/staff-${ids[0]}/`);
    await links.first().click();
    await expectProfile(origin, 'ru');
    for (const locale of ['en', 'ru']) {
      await switchLanguage(locale, `/${locale}/team/staff-${ids[0]}/`);
      await expectProfile(origin, locale);
    }

    assert.deepEqual(logs().match(/\[staff-fixture\] [^\r\n]+/g), Object.values(locales).flatMap(({ lang }) => [
      `[staff-fixture] 500 ${lang}`, `[staff-fixture] team-list-slow ${lang}`,
    ]));
  });

  await fs.writeFile(scenario, 'empty');
  await run(async (origin) => {
    for (const [locale, copy] of Object.entries(locales)) {
      await page.goto(`${origin}/${locale}/team/`);
      await expect(status).toHaveText(copy.empty);
      await expect(cards).toHaveCount(0);
      await expect(page.getByRole('button', { name: copy.retry })).toHaveCount(0);
    }
  });

  assert.deepEqual(unexpected, []);
  console.log('Team list: RU/EN, catalog states, cards, canonical profile round trips and language switching: OK');
} finally {
  await browser?.close();
  await Promise.all([...cacheFiles].map((file) => fs.rm(path.join('.next/cache/fetch-cache', file), { force: true })));
  await Promise.all([scenario, release].map((file) => fs.rm(file, { force: true })));
  await fs.rmdir(dir);
}
