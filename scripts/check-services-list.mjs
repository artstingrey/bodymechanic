import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import en from '../messages/en.json' with { type: 'json' };
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
    if (['api.alteg.io', 'images.example.test'].includes(url.hostname) || url.pathname.startsWith('/api/catalog/services')) {
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
    const englishTitles = ['First massage', 'Uncategorized', 'Second massage', 'Missing category', 'Mobility session'];
    await expect(titles).toHaveText(englishTitles);
    await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeFocused();
    await expect(categories).toHaveText(['All services', 'Massage', 'Empty category', 'Recovery']);
    await expect(cards.locator('.badge')).toHaveCount(0);

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
    await expect(titles).toHaveText(['Первый массаж', 'Без категории', 'Второй массаж', 'Исчезнувшая категория', 'Тренировка']);
    await expect(categories).toHaveText(['Все услуги', 'Массаж', 'Пустая категория', 'Восстановление']);
    for (let index = 0; index < 3; index++) {
      await expect(categories.nth(index + 1)).toHaveAttribute('href',
        `/ru/services/?category=${[30, 20, 10][index]}`);
    }

    const active = page.locator('main .list-bar .chip[aria-current="page"]');
    const count = page.locator('main .list-bar [role="status"]');
    const filterLink = (name) => page.locator('main .list-bar').getByRole('link', { name, exact: true });
    const enList = `${origin}/en/services/`;
    const checkSelection = async (url, label, visibleTitles, counter) => {
      await expect(page).toHaveURL(url);
      await expect(active).toHaveText([label]);
      await expect(titles).toHaveText(visibleTitles);
      await expect(count).toHaveText(counter);
    };
    const enMassage = () => checkSelection(enList + '?category=30', 'Massage', ['First massage', 'Second massage'], '2 services found');
    const enRecovery = () => checkSelection(enList + '?category=10', 'Recovery', ['Mobility session'], '1 service found');
    const enEmpty = () => checkSelection(enList + '?category=20', 'Empty category', [], '0 services found');

    await page.goto(enList + '?category=30');
    await enMassage();
    await page.reload();
    await enMassage();
    await filterLink('Recovery').click();
    await enRecovery();
    await filterLink('Empty category').click();
    await enEmpty();
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    await filterLink('All services').click();
    await checkSelection(enList, 'All services', englishTitles, '5 services found');
    await page.goBack();
    await enEmpty();
    await page.goBack();
    await enRecovery();
    await page.goForward();
    await enEmpty();
    await filterLink('Massage').click();
    await enMassage();
    await page.locator('header a[hreflang="ru"]').first().click();
    await checkSelection(`${origin}/ru/services/?category=30`, 'Массаж', ['Первый массаж', 'Второй массаж'], 'Найдено: 2');
    await page.locator('header a[hreflang="en"]').first().click();
    await enMassage();

    for (const value of ['massage', 'rehab', '', '-30', '0', '030', '30.0', '999', '30&category=10']) {
      const url = enList + '?category=' + value;
      await page.goto(url);
      await checkSelection(url, 'All services', englishTitles, '5 services found');
    }

    for (const [locale, allLabel, massageLabel, title, menuLabels] of [
      ['ru', 'Все услуги', 'Массаж', 'Первый массаж', ['Онлайн запись', 'Услуги']],
      ['en', 'All services', 'Massage', 'First massage', ['Online booking', 'Services']],
    ]) {
      const listPath = `/${locale}/services/`;
      await page.goto(`${origin}/${locale}/`);
      const menu = page.locator('.site-nav');
      for (const [index, id] of [13989203, 13989204].entries()) {
        await expect(menu.getByRole('link', { name: menuLabels[index], exact: true })).toHaveAttribute('href', listPath + '?category=' + id);
      }
      const homeServices = page.locator('section[aria-labelledby="services-title"]');
      await homeServices.getByRole('link', { name: allLabel, exact: true }).click();
      await expect(page).toHaveURL(origin + listPath);
      await filterLink(massageLabel).click();
      await expect(page).toHaveURL(origin + listPath + '?category=30');
      await titles.getByRole('link', { name: new RegExp(title) }).click();
      await expect(page).toHaveURL(origin + listPath + 'service-93004/');
      await expect(page.locator('.svc-hero h1')).toHaveText(title);
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

  await fs.writeFile(scenario, 'catalog-category-titles');
  await run(async (origin) => {
    for (const [locale, title] of [['ru', 'Услуги'], ['en', 'Services']]) {
      const listPath = `/${locale}/services/`;
      const filtered = `${listPath}?category=13989204`;
      await page.goto(origin + listPath);
      const menu = page.locator('.site-nav').getByRole('link', { name: title, exact: true });
      await expect(menu).toHaveAttribute('href', filtered);
      await expect(categories.filter({ hasText: /^Услуги вне салона$/ })).toHaveAttribute('href', `${listPath}?category=20`);
      await page.locator('main .list-bar').getByRole('link', { name: title, exact: true }).click();
      await expect(page).toHaveURL(origin + filtered);
      await expect(page.locator('main .list-bar .chip[aria-current="page"]')).toHaveText(title);
      await titles.getByRole('link', { name: /Mobile massage/ }).click();
      await expect(page.locator('.svc-hero .eyebrow')).toHaveText(title);
    }
  });

  await page.route('https://images.example.test/**', (route) => route.abort());
  await fs.writeFile(scenario, 'service-detail');
  await run(async (origin) => {
    const locales = {
      ru: {
        sports: 'Спортивный массаж из каталога',
        sportsDescription: 'Описание из каталога.',
        longTitle: /длинным названием для проверки переноса строк/,
        classicDescription: 'Спокойный классический массаж в приватном кабинете.',
        from: 'От', minutes: 'мин', unknown: 'Стоимость уточняется',
      },
      en: {
        sports: 'Sports massage',
        sportsDescription: en.home.services.cards['13982355'].description,
        longTitle: /very long service title/,
        classicDescription: 'A calm, classic massage in a private room.',
        from: 'From', minutes: 'min', unknown: 'Price to be confirmed',
      },
    };
    const slugs = ['sports', 'service-91201', 'service-91202', 'service-91203', 'service-91204', 'classic'];
    for (const [locale, labels] of Object.entries(locales)) {
      const listUrl = `${origin}/${locale}/services/`;
      const href = (slug) => `/${locale}/services/${slug}/`;
      const card = (set, slug) => set.filter({ has: page.locator(`a[href="${href(slug)}"]`) });
      const sports = card(cards, 'sports');
      const long = card(cards, 'service-91201');
      const unknown = card(cards, 'service-91204');
      await page.setViewportSize({ width: 320, height: 850 });
      await page.goto(listUrl);
      await expect(sports.locator('h2')).toHaveText(labels.sports);
      await expect(sports.locator('.d')).toHaveText(labels.sportsDescription);
      await expect(card(cards, 'classic').locator('.d')).toHaveText(labels.classicDescription);
      await expect(sports.locator('dd')).toHaveText([/80\s*–\s*160.*AED|AED.*80\s*–\s*160/]);
      await expect(long.locator('h2')).toHaveText(labels.longTitle);
      await expect(long.locator('dd')).toHaveText([/^(?:AED\s+)?0(?:\s+AED)?$/, new RegExp(`^90\\s+${labels.minutes}$`)]);
      await expect(card(cards, 'service-91202').locator('dd')).toHaveText([new RegExp(`^${labels.from}\\s+(?:AED\\s+)?55[,.]5(?:\\s+AED)?$`)]);
      await expect(card(cards, 'service-91203').locator('dd')).toHaveText([/^(?:AED\s+125|125\s+AED)$/]);
      await expect(unknown.locator('dd')).toHaveText([labels.unknown]);
      await expect(unknown.locator('.d, img')).toHaveCount(0);
      await expect(unknown.locator('.ph')).toBeAttached();
      await expect(long.locator('.ph')).toBeVisible();
      await expect(long.locator('img')).toHaveCount(0);
      await expect(cards.locator('.badge')).toHaveCount(0);
      const photo = sports.locator('img');
      await photo.scrollIntoViewIfNeeded();
      await expect(photo).toHaveAttribute('alt', labels.sports);
      await expect(photo).toHaveAttribute('src', '/website-services/test/sports-massage.png');
      await expect.poll(() => photo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

      const grid = page.locator('main .card-grid');
      for (const [width, columns] of [[320, 1], [1280, 3]]) {
        await page.setViewportSize({ width, height: 850 });
        assert.equal(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await long.locator('h2').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      }

      const listContent = new Map();
      for (const slug of slugs) {
        const item = card(cards, slug);
        listContent.set(slug, {
          title: await item.locator('h2').innerText(),
          facts: await item.locator('dd').allTextContents(),
          description: await item.locator('.d').allTextContents(),
        });
      }
      await page.goto(`${origin}/${locale}/`);
      const homeCards = page.locator('section[aria-labelledby="services-title"] article');
      for (const [slug, expected] of listContent) {
        const item = card(homeCards, slug);
        await expect(item.locator('h3')).toHaveText(expected.title);
        await expect(item.locator('dd')).toHaveText(expected.facts);
        await expect(item.locator('.d')).toHaveText(expected.description);
      }

      for (const slug of ['sports', 'service-91201']) {
        await page.goto(listUrl);
        await card(cards, slug).locator('h2 a').click();
        await expect(page).toHaveURL(origin + href(slug));
        const expected = listContent.get(slug);
        const hero = page.locator('.svc-hero');
        await expect(hero.locator('h1')).toHaveText(expected.title);
        await expect(hero.locator('.hero-lead')).toHaveText(expected.description);
        await expect(hero.locator('dd')).toHaveText(expected.facts.length === 1 ? [...expected.facts, ''] : expected.facts);
      }
    }
  });
  assert.deepEqual(browserRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log('Services list: RU/EN, order, states, cards, category navigation, history and home-to-detail flow: OK');
} finally {
  await browser?.close();
  await Promise.all([...cacheFiles, scenario, release].map((file) => fs.rm(file, { force: true })));
  await fs.rmdir(dir);
}
