import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-quick-form-'));
const catalog = path.join(dir, 'catalog');
const staff = path.join(dir, 'staff');
const availability = path.join(dir, 'availability');
const release = `${catalog}.release`;
const cacheKeys = new Set();
const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const start = '2026-11-30';
const end = '2026-12-01';
const earlySlot = `${start}T09:30:00+04:00`;
const lateSlot = '2026-11-30T23:20:00.123+03:00';
const messages = {};
for (const locale of ['ru', 'en']) {
  messages[locale] = JSON.parse(await fs.readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
}

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin);
      assert.doesNotMatch(logs(), /fixture-partner-token|fixture raw upstream detail|\[catalog-unhandled-rejection\]/);
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheKeys.add(key);
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    ALTEGIO_CURRENCY: 'AED',
    CATALOG_TEST_SCENARIO: catalog,
    SERVICE_STAFF_TEST_SCENARIO: staff,
    AVAILABILITY_TEST_SCENARIO: availability,
  } });
}

async function deferResponse(page, resource, param, value) {
  let saved = false;
  const send = Promise.withResolvers();
  const sent = Promise.withResolvers();
  await page.route(
    (url) => url.pathname === `/api/booking/${resource}` && url.searchParams.get(param) === value,
    async (route) => {
      try {
        const response = await route.fetch();
        saved = true;
        await send.promise;
        // An aborted browser request may no longer accept its old response.
        await route.fulfill({ response }).catch(() => {});
      } finally {
        sent.resolve();
      }
    },
    { times: 1 },
  );
  return { wait: () => expect.poll(() => saved).toBe(true), send: () => { send.resolve(); return sent.promise; } };
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  await fs.writeFile(catalog, 'home-slow');
  await run(async (origin) => {
    const page = await browser.newPage();
    try {
      const form = page.locator('.qform');
      const status = form.locator('#qf-services-status:visible');
      await page.goto(`${origin}/en/`, { waitUntil: 'commit' });
      await expect(page.locator('#hero-title')).toBeVisible();
      await expect(status).toHaveText(messages.en.home.form.availability.services.loading);
      await expect(form.locator('select')).toHaveCount(4);
      await form.locator('#qf-name').fill('During catalog load');
      await fs.writeFile(release, '');
      await expect(form.locator('#qf-service:visible')).toBeEnabled();
      await expect(form.locator('#qf-name')).toHaveValue('During catalog load');
    } finally {
      await page.close();
    }
  });

  await fs.writeFile(catalog, '500');
  await run(async (origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${origin}/en/`);
      const form = page.locator('.qform');
      await expect(form.locator('#qf-services-status:visible')).toHaveText(messages.en.home.form.availability.services.error);
      await expect(form.locator('#qf-service:visible option')).toHaveCount(1);
      await form.locator('#qf-email').fill('contact@example.test');
      await fs.writeFile(catalog, 'service-detail');
      await form.getByRole('button', { name: messages.en.home.form.retry }).click();
      await expect(form.locator('#qf-service:visible')).toBeEnabled();
      await expect(form.locator('#qf-email')).toHaveValue('contact@example.test');
    } finally {
      await page.close();
    }
  });

  await fs.writeFile(catalog, 'empty');
  await run(async (origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${origin}/ru/`);
      // Suspense can temporarily keep streamed content in a hidden container.
      await expect(page.locator('#qf-services-status:visible')).toHaveText(messages.ru.home.form.availability.services.empty);
      await expect(page.locator('#qf-service:visible')).toBeDisabled();
      await expect(page.locator('#qf-service:visible option')).toHaveCount(1);
    } finally {
      await page.close();
    }
  });

  await fs.writeFile(catalog, 'service-detail');
  await run(async (origin) => {
    for (const [locale, width] of [['en', 1280], ['ru', 390]]) {
      await fs.writeFile(staff, 'success');
      await fs.writeFile(availability, 'success');
      const page = await browser.newPage({ viewport: { width, height: 850 }, timezoneId: 'America/Los_Angeles' });
      const { home, booking } = messages[locale];
      const copy = home.form;
      const requests = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/booking/') || url.hostname === 'api.alteg.io') requests.push([request.method(), url]);
      });
      const form = page.locator('.qform');
      const service = form.locator('#qf-service:visible');
      const specialist = form.locator('#qf-staff:visible');
      const date = form.locator('#qf-date:visible');
      const time = form.locator('#qf-time:visible');
      const status = (resource) => form.locator(`#qf-${resource}-status`);
      const retry = (resource) => form.locator(`button[aria-describedby="qf-${resource}-status"]`);
      try {
        await page.goto(`${origin}/${locale}/`);
        await expect(service.locator('option[value="101"]')).toHaveCount(0);
        await expect(service.locator('option[value="13982355"]')).toHaveText(
          locale === 'en' ? home.services.cards[13982355].title : 'Спортивный массаж из каталога',
        );
        await expect(specialist.locator('option[value="0"]')).toHaveText(copy.anyStaffOption);
        await expect(form.getByTestId('captcha')).toHaveAttribute('hidden', '');
        await expect(form.getByTestId('captcha')).toBeHidden();
        await expect(form.getByRole('button', { name: copy.submit, exact: true })).toBeDisabled();
        await expect(form.getByText(copy.submitUnavailable)).toBeVisible();
        await expect(form.locator('#qf-email')).toHaveAttribute('required', '');
        await form.locator('#qf-name').fill('Fixture name');
        await form.locator('#qf-phone').fill('+971501234567');
        await form.locator('#qf-email').fill('contact@example.test');
        await form.locator('#qf-age').fill('35');
        await form.locator('textarea').fill('Fixture note');
        await form.locator('#qf-consent').check();

        await service.selectOption('13982355');
        await expect(specialist.locator('option')).toHaveCount(3);
        await expect(date.locator('option')).toHaveCount(3);
        await date.selectOption(start);
        await time.selectOption(earlySlot);

        const slowTime = await deferResponse(page, 'times', 'date', end);
        await date.selectOption(end);
        await slowTime.wait();
        await expect(status('times')).toHaveText(copy.availability.times.loading);
        await expect(time).toHaveValue('');
        await expect(time).toBeDisabled();
        await date.selectOption(start);
        await time.selectOption(earlySlot);
        await slowTime.send();
        await expect(time).toHaveValue(earlySlot);
        await expect(time.locator(`option[value="${lateSlot}"]`)).toHaveCount(0);

        const slowDates = await deferResponse(page, 'dates', 'staffId', '91601');
        await specialist.selectOption('91601');
        await slowDates.wait();
        await expect(status('dates')).toHaveText(copy.availability.dates.loading);
        await expect(date).toHaveValue('');
        await expect(time).toHaveValue('');
        await specialist.selectOption('91602');
        await date.selectOption(end);
        await time.selectOption(lateSlot);
        await slowDates.send();
        await expect(date.locator(`option[value="${start}"]`)).toHaveCount(0);
        await expect(time).toHaveValue(lateSlot);
        await expect(time.locator('option:checked')).toContainText('00:20');

        const slowStaff = await deferResponse(page, 'staff', 'serviceId', '91201');
        await service.selectOption('91201');
        await slowStaff.wait();
        await expect(status('staff')).toHaveText(copy.availability.staff.loading);
        await expect(specialist).toHaveValue('0');
        await expect(date).toHaveValue('');
        await expect(time).toHaveValue('');
        await service.selectOption('13982355');
        await expect(specialist.locator('option')).toHaveCount(3);
        await slowStaff.send();
        await expect(specialist.locator('option[value="91605"]')).toHaveCount(0);
        await service.selectOption('91201');
        await expect(specialist.locator('option[value="91605"]')).toHaveText('Taylor Example');

        await fs.writeFile(availability, 'empty');
        await specialist.selectOption('91605');
        await expect(status('dates')).toHaveText(copy.availability.dates.empty);
        await expect(date).toBeDisabled();
        await fs.writeFile(availability, '503');
        await specialist.selectOption('0');
        await expect(status('dates')).toHaveText(copy.availability.dates.error);
        await fs.writeFile(availability, 'success');
        await retry('dates').click();
        await expect(date).toBeEnabled();

        await fs.writeFile(availability, 'empty');
        await date.selectOption(end);
        await expect(status('times')).toHaveText(copy.availability.times.empty);
        await expect(time).toBeDisabled();
        await date.selectOption('');
        await fs.writeFile(availability, '503');
        await date.selectOption(end);
        await expect(status('times')).toHaveText(copy.availability.times.error);
        await fs.writeFile(availability, 'success');
        await retry('times').click();
        await time.selectOption(lateSlot);

        await fs.writeFile(staff, '500');
        await service.selectOption('91204');
        await expect(status('staff')).toHaveText(copy.availability.staff.error);
        await fs.writeFile(staff, 'success');
        await retry('staff').click();
        await expect(status('staff')).toHaveText(copy.availability.staff.empty);
        await expect(specialist).toHaveValue('0');

        await expect(form.locator('#qf-name')).toHaveValue('Fixture name');
        await expect(form.locator('#qf-phone')).toHaveValue('+971501234567');
        await expect(form.locator('#qf-email')).toHaveValue('contact@example.test');
        await expect(form.locator('#qf-age')).toHaveValue('35');
        await expect(form.locator('textarea')).toHaveValue('Fixture note');
        await expect(form.locator('#qf-consent')).toBeChecked();
        await expect(time).toBeVisible();
        assert.ok(await form.evaluate((element) => element.scrollWidth <= element.clientWidth));
        await form.evaluate((element) => element.requestSubmit());
        await expect(page.getByText(booking.done.title, { exact: true })).toHaveCount(0);
        assert.ok(requests.length > 0);
        assert.ok(requests.every(([method, url]) => method === 'GET' && url.origin === origin &&
          url.searchParams.get('locale') === locale && /^\/api\/booking\/(staff|dates|times)$/.test(url.pathname)));
      } finally {
        await page.close();
      }
    }
  });
  console.log('Quick form: server catalog, RU/EN, mobile and desktop, stale responses, retries and retained contacts OK');
} finally {
  await browser?.close();
  for (const key of cacheKeys) await fs.rm(path.join('.next/cache/fetch-cache', key), { force: true });
  for (const file of [catalog, staff, availability, release]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
