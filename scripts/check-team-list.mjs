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
const locales = {
  ru: { lang: 'ru-RU', title: 'Команда', loading: 'Загружаем команду…', retry: 'Повторить',
    error: 'Не удалось загрузить команду.', empty: 'Профили специалистов пока не опубликованы.' },
  en: { lang: 'en-US', title: 'Team', loading: 'Loading the team…', retry: 'Try again',
    error: 'We couldn’t load the team.', empty: 'No specialist profiles are currently listed.' },
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
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, analytics: false, marketing: false, at: 'gate',
  })));
  const unexpected = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'api.alteg.io' || url.pathname.startsWith('/api/catalog/')) unexpected.push(request.url());
  });
  page.on('pageerror', (error) => unexpected.push(error.message));
  const cards = page.locator('main .card-grid.card-grid--4 > li > .staff');
  const status = page.locator('main [role="status"]');

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
      await page.setViewportSize({ width: locale === 'ru' ? 390 : 1280, height: 850 });
      const response = await page.goto(`${origin}/${locale}/team/`);
      assert.equal(response.status(), 200);
      assert.doesNotMatch(await response.text(), /fixture-partner-token|fixture raw upstream detail/);
      const heading = page.getByRole('heading', { level: 1, name: copy.title });
      await expect(heading).toBeVisible();
      await expect(status).toHaveText(copy.error);
      await expect(cards).toHaveCount(0);

      const retry = page.getByRole('button', { name: copy.retry });
      await fs.writeFile(scenario, 'home-slow');
      await retry.press('Enter');
      await expect(status).toHaveText(copy.loading);
      await expect(heading).toBeVisible();
      await expect(retry).toHaveAttribute('aria-disabled', 'true');
      await fs.writeFile(release, '');
      await expect(cards.locator('b')).toHaveText(names);
      await expect(heading).toBeFocused();
      await expect(cards.locator('a')).toHaveCount(0);

      // Same cache entry serves the page and the public API without a third upstream request.
      const api = await fetch(`${origin}/api/catalog/staff?locale=${locale}`);
      assert.equal(api.status, 200);
      assert.deepEqual((await api.json()).data.staff.map(({ name }) => name), names);
    }
    assert.deepEqual(logs().match(/\[staff-fixture\] [^\r\n]+/g), Object.values(locales).flatMap(({ lang }) => [
      `[staff-fixture] 500 ${lang}`, `[staff-fixture] home-slow ${lang}`,
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
  console.log('Team list: RU/EN, publication order, shared cache, loading, empty, error and retry: OK');
} finally {
  await browser?.close();
  await Promise.all([...cacheFiles].map((file) => fs.rm(path.join('.next/cache/fetch-cache', file), { force: true })));
  await Promise.all([scenario, release].map((file) => fs.rm(file, { force: true })));
  await fs.rmdir(dir);
}
