import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-booking-services-'));
const scenarioFile = path.join(dir, 'catalog');
const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const sports = 13982355;
const classic = 13982356;
const other = 91201;
const cacheKeys = new Set();
let browser;

try {
  await fs.writeFile(scenarioFile, 'service-detail');
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-3d-apis'] });
  await withProductionServer(async (origin, logs) => {
    try {
      for (const [locale, width] of [['ru', 390], ['en', 1280]]) {
        const messages = JSON.parse(await fs.readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const booking = `${origin}/${locale}/booking/`;
        const copy = messages.booking.service;
        const rows = page.locator('input[name="service"]');
        const row = (id) => page.locator('.bk-opt', { has: rows.locator(`xpath=self::input[@value="${id}"]`) });
        const recommendation = page.locator('.bk-opt', { hasText: copy.suggested });
        const requests = [];
        let catalogRequests = 0;
        let scenario = 'loading';
        const release = Promise.withResolvers();
        page.on('request', (request) => {
          const url = new URL(request.url());
          if (url.pathname.startsWith('/api/booking/') || url.hostname === 'api.alteg.io') requests.push(url.pathname);
        });
        await page.route('**/api/catalog/services?locale=*', async (route) => {
          catalogRequests++;
          assert.equal(route.request().method(), 'GET');
          assert.equal(new URL(route.request().url()).searchParams.get('locale'), locale);
          if (scenario === 'loading') await release.promise;
          if (scenario === 'error') {
            await route.fulfill({ status: 503, json: { error: { code: 'CATALOG_UNAVAILABLE' } } });
            return;
          }
          const response = await route.fetch();
          const json = await response.json();
          if (scenario === 'empty') json.data.services = [];
          if (scenario === 'missing') json.data.services = json.data.services.filter(({ id }) => id !== classic);
          await route.fulfill({ response, json });
        });
        try {
          await page.goto(booking);
          await expect(page.locator('.booking[data-ready="true"] #st1')).toBeVisible();
          await expect(page.locator('.b3d-poster img')).toHaveAttribute('fetchpriority', 'high');
          assert.equal(catalogRequests, 0);
          await page.getByRole('button', { name: messages.body3d.panel.skip }).click();
          await expect(page.locator('.booking-loading')).toBeVisible();
          scenario = 'error';
          release.resolve();
          await expect(page.getByRole('alert').filter({ hasText: copy.loadError })).toBeVisible();
          scenario = 'empty';
          await page.getByRole('button', { name: messages.common.actions.retry }).click();
          await expect(page.getByText(copy.empty, { exact: true })).toBeVisible();
          await expect(rows).toHaveCount(0);

          scenario = 'ready';
          await page.goto(`${booking}?step=2&service=${sports}&utm_source=fixture#st2`);
          await expect(rows.locator(`xpath=self::input[@value="${sports}"]`)).toBeChecked();
          await expect(page).toHaveURL(`${booking}?step=2&utm_source=fixture#st2`);
          await expect(recommendation).toHaveCount(0);
          await expect(row(sports)).toContainText(locale === 'ru' ? 'Спортивный массаж из каталога' : messages.home.services.cards[sports].title);
          await expect(row(sports)).toContainText(locale === 'ru' ? 'Массаж из каталога' : 'Catalog massage');
          await expect(row(sports)).toContainText(/80.+160.+AED|AED.+80.+160/);
          await expect(row(other)).toContainText(/90\s/);
          await expect(row(other)).toContainText(/0\s*AED|AED\s*0/);
          await expect(row(classic)).toContainText(messages.home.services.priceUnknown);
          await row(other).click();
          await page.reload();
          await expect(rows.locator(`xpath=self::input[@value="${other}"]`)).toBeChecked();

          await page.getByRole('button', { name: messages.common.actions.back }).click();
          const zones = page.locator('#zone-list');
          const unknown = messages.body3d.zones.left.replace('{zone}', messages.body3d.zones.elbow_forearm);
          await zones.getByRole('checkbox', { name: unknown, exact: true }).check();
          await page.getByRole('button', { name: messages.body3d.panel.cta }).click();
          await expect(rows.first()).toHaveValue(String(sports));
          await expect(recommendation).toHaveCount(0);

          await page.getByRole('button', { name: messages.common.actions.back }).click();
          for (const zone of ['chest', 'neck_collar']) {
            await zones.getByRole('checkbox', { name: messages.body3d.zones[zone], exact: true }).check();
          }
          await page.getByRole('button', { name: messages.body3d.panel.cta }).click();
          await expect(rows.first()).toHaveValue(String(classic));
          await expect(recommendation).toHaveCount(1);
          await expect(row(classic)).toContainText(copy.suggested);

          await page.evaluate(() => {
            sessionStorage.setItem('bm.bookingSteps', JSON.stringify({
              serviceId: 102, staffId: 201, date: '2026-11-30', datetime: '2026-11-30T12:00:00+04:00',
              contact: { fullname: 'Fixture', consent: true },
            }));
          });
          await page.reload();
          await expect(rows.locator(`xpath=self::input[@value="${classic}"]`)).toBeChecked();
          await expect(page.getByRole('button', { name: messages.common.actions.next })).toBeDisabled();
          await page.goto(`${booking}?step=7&service=102&staff=201&date=2026-11-30&time=12:00&utm_source=fixture#st2`);
          await expect(page).toHaveURL(`${booking}?step=2&utm_source=fixture#st2`);
          await expect(rows.locator(`xpath=self::input[@value="${classic}"]`)).toBeChecked();
          const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')));
          assert.equal(draft.staffId, 0);
          assert.equal(draft.datetime, null);
          assert.equal(draft.contact.fullname, 'Fixture');
          await expect(page.locator('#st7')).toHaveCount(0);

          scenario = 'missing';
          await page.reload();
          await expect(rows.first()).toHaveValue(String(sports));
          await expect(recommendation).toHaveCount(1);
          await expect(row(sports)).toContainText(copy.suggested);
          await expect(page.locator('input[name="service"]:checked')).toHaveCount(0);
          assert.deepEqual(requests, []);
        } finally {
          release.resolve();
          await page.close();
        }
      }
      assert.match(logs(), /\[catalog-fixture\] service-detail ru-RU/);
      assert.match(logs(), /\[catalog-fixture\] service-detail en-US/);
      console.log('3D booking services: catalog, ranking, drafts, deep links and staged boundary passed in RU and EN');
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheKeys.add(key);
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    ALTEGIO_CURRENCY: 'AED',
    CATALOG_TEST_SCENARIO: scenarioFile,
  } });
} finally {
  await browser?.close();
  await fs.unlink(scenarioFile).catch(() => {});
  await fs.rmdir(dir);
  for (const key of cacheKeys) await fs.unlink(path.join('.next', 'cache', 'fetch-cache', key)).catch(() => {});
}
