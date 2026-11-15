import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-quick-form-submit-'));
const scenarioFile = path.join(dir, 'scenario');
const journal = `${scenarioFile}.journal`;
const release = `${scenarioFile}.release`;
const marker = `${scenarioFile}.created`;
const comments = `${scenarioFile}.comments`;
const preload = new URL('../e2e/fixtures/altegio-record.mjs', import.meta.url).href;
const now = Date.now();
const day = 86_400_000;
const date = new Date(now + 7 * day).toISOString().slice(0, 10);
const datetime = `${new Date(now + 6 * day).toISOString().slice(0, 10)}T23:20:00.123+03:00`;
const serviceId = '13982355';
const specialist = '91601';
const attemptStorage = 'bm.quickBooking.pending';
const privateValues = /fixture-partner-token|fixture-record-hash-secret|fixture-private-|visitor\d*@example\.test|\+97150\d{7}/;
const messages = {};
for (const locale of ['en', 'ru']) {
  messages[locale] = JSON.parse(await fs.readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
}

async function scenario(name) {
  for (const file of [release, marker, comments]) await fs.rm(file, { force: true });
  await fs.writeFile(journal, '');
  await fs.writeFile(scenarioFile, name);
}

async function calls(operation) {
  return (await fs.readFile(journal, 'utf8')).split('\n').filter((line) => line === operation).length;
}

function successEvents(page) {
  return page.evaluate(() => (window.dataLayer ?? []).filter((item) => item.event === 'booking_success'));
}

async function openForm(browser, origin, locale, analytics, staffId, suffix, selectedService = serviceId) {
  const page = await browser.newPage({ viewport: { width: locale === 'ru' ? 390 : 1280, height: 850 }, timezoneId: 'America/Los_Angeles' });
  await page.addInitScript((allowed) => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, marketing: false, analytics: allowed, at: 'fixture',
  })), analytics);
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  const requests = [];
  const lookups = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/booking/')) return;
    if (request.method() === 'POST') requests.push(request.postDataJSON());
    else lookups.push(url.pathname);
  });
  await page.goto(`${origin}/${locale}/`, { waitUntil: 'networkidle' });
  const copy = messages[locale];
  const form = page.locator('form.qform');
  const button = form.getByRole('button', { name: copy.home.form.submit, exact: true });
  await expect(button).toBeEnabled();
  await expect(form.getByTestId('captcha')).toBeHidden();
  await form.locator('#qf-service').selectOption(selectedService);
  if (staffId !== 0) await form.locator('#qf-staff').selectOption(String(staffId));
  await form.locator('#qf-date').selectOption(date);
  const time = form.locator('#qf-time');
  await time.selectOption(datetime);
  const phone = `+97150${String(suffix).padStart(7, '0')}`;
  const email = `visitor${suffix}@example.test`;
  await form.locator('#qf-name').fill('fixture-private-fullname');
  await form.locator('#qf-phone').fill(phone);
  await form.locator('#qf-age').fill('38');
  await form.locator('textarea').fill('fixture-private-note');
  await form.locator('#qf-consent').check();
  return { page, copy, form, button, time, requests, lookups, phone, email };
}

async function assertConfirmed(page, copy) {
  const receipt = page.getByRole('status').filter({ has: page.getByRole('heading', { name: copy.booking.done.title }) });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('12345');
  await expect(receipt).toContainText('00:20');
  await expect(receipt).toContainText('Example specialist');
  await expect(receipt).not.toContainText(copy.home.form.anyStaffOption);
}

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin);
    } finally {
      assert.doesNotMatch(logs(), privateValues);
    }
  }, { preload, env: (origin) => ({
    BOOKING_QUICK_FORM_ENABLED: 'true',
    BOOKING_ORIGIN: origin,
    BOOKING_CLIENT_IP_HEADER: '',
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    ALTEGIO_CURRENCY: 'AED',
    RECORD_FIXTURE_SCENARIO: scenarioFile,
    RECORD_FIXTURE_DATE: date,
    RECORD_FIXTURE_DATETIME: datetime,
  }) });
}

let browser;
try {
  await scenario('empty-201');
  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  await run(async (origin) => {
    const en = await openForm(browser, origin, 'en', true, 0, 1);
    await en.button.click();
    await expect(en.form.locator('#qf-email-err')).toHaveText(en.copy.forms.error.required);
    await en.form.locator('#qf-email').fill('invalid-email');
    await en.button.click();
    await expect(en.form.locator('#qf-email-err')).toHaveText(en.copy.forms.error.emailInvalid);
    assert.deepEqual(en.requests, []);
    await en.form.locator('#qf-email').fill(en.email);
    await scenario('check-conflict');
    const timesBefore = en.lookups.filter((url) => url.endsWith('/times')).length;
    await en.button.click();
    await expect(en.form.getByRole('alert')).toHaveText(en.copy.home.form.feedback.slotTaken);
    await expect(en.time).toHaveValue('');
    await expect.poll(() => en.lookups.filter((url) => url.endsWith('/times')).length).toBeGreaterThan(timesBefore);
    await expect(en.form.locator('#qf-email')).toHaveValue(en.email);
    await expect(en.form.locator('#qf-phone')).toHaveValue(en.phone);
    await expect(en.form.locator('textarea')).toHaveValue('fixture-private-note');
    assert.equal(await calls('POST book_record'), 0);
    assert.deepEqual(await successEvents(en.page), []);

    await scenario('hold-record');
    await en.time.selectOption(datetime);
    await en.form.evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await expect.poll(() => calls('POST book_record')).toBe(1);
    await expect(en.form.getByRole('button', { name: en.copy.home.form.submitting })).toBeDisabled();
    assert.deepEqual(await successEvents(en.page), []);
    assert.equal(en.requests.length, 2);
    const [first, second] = en.requests;
    assert.notEqual(first.idempotencyKey, second.idempotencyKey);
    assert.deepEqual(second, {
      serviceId: Number(serviceId), staffId: 0, datetime, locale: 'en', consent: true, idempotencyKey: second.idempotencyKey,
      contact: { fullname: 'fixture-private-fullname', phone: en.phone, email: en.email },
      age: 38, condition: 'fixture-private-note',
    });
    await fs.writeFile(release, '');
    await assertConfirmed(en.page, en.copy);
    assert.deepEqual(await successEvents(en.page), [{ event: 'booking_success', service_id: Number(serviceId), staff_id: Number(specialist), currency: 'AED', source: 'form' }]);
    assert.equal(await calls('POST book_record'), 1);
    assert.equal(await calls('POST locations'), 0);
    assert.equal(JSON.parse(await fs.readFile(comments, 'utf8')), '[Сайт/форма] Age: 38\nCondition: fixture-private-note');
    assert.equal(await en.page.evaluate((key) => sessionStorage.getItem(key), attemptStorage), null);
    await en.page.close();

    await scenario('checked-json');
    const ru = await openForm(browser, origin, 'ru', false, Number(specialist), 2);
    await ru.form.locator('#qf-email').fill(ru.email);
    await ru.button.click();
    await assertConfirmed(ru.page, ru.copy);
    assert.equal(ru.requests[0].staffId, Number(specialist));
    assert.equal(await calls('POST book_record'), 1);
    assert.equal(await calls('POST locations'), 0);
    assert.equal(JSON.parse(await fs.readFile(comments, 'utf8')), '[Сайт/форма] Возраст: 38\nСостояние: fixture-private-note');
    assert.deepEqual(await successEvents(ru.page), []);
    await ru.page.close();

    await scenario('record-timeout');
    const timeout = await openForm(browser, origin, 'ru', true, 0, 3);
    await timeout.form.locator('#qf-email').fill(timeout.email);
    await timeout.button.click();
    await expect(timeout.form.getByText(timeout.copy.home.form.feedback.unknown)).toBeVisible({ timeout: 20_000 });
    await expect(timeout.form.getByRole('link', { name: timeout.copy.home.form.contactStudio })).toHaveCount(0);
    await expect(timeout.button).toBeDisabled();
    assert.equal(await calls('POST book_record'), 1);
    await fs.stat(marker);
    assert.deepEqual(await successEvents(timeout.page), []);
    await timeout.form.evaluate((form) => form.requestSubmit());
    assert.equal(timeout.requests.length, 1);
    assert.equal(await timeout.page.evaluate((storage) => sessionStorage.getItem(storage), attemptStorage), null);
    await timeout.page.reload({ waitUntil: 'networkidle' });
    await expect(timeout.button).toBeEnabled();
    await expect(timeout.form.getByText(timeout.copy.home.form.feedback.unknown)).toHaveCount(0);
    assert.equal(timeout.requests.length, 1);
    assert.equal(await calls('POST book_record'), 1);
    await timeout.page.close();

    await scenario('empty-201');
    const lost = await openForm(browser, origin, 'en', true, 0, 4);
    let accepted;
    await lost.page.route('**/api/booking/record', async (route) => {
      accepted = (await route.fetch()).status();
      await route.abort();
    });
    await lost.form.locator('#qf-email').fill(lost.email);
    await lost.button.click();
    await expect(lost.form.getByText(lost.copy.home.form.feedback.unknown)).toBeVisible();
    assert.equal(accepted, 201);
    assert.equal(await calls('POST book_record'), 1);
    assert.deepEqual(await successEvents(lost.page), []);
    await lost.page.close();
  });

  // Isolate the package checks from the per-IP limit of the ordinary booking scenarios.
  await run(async (origin) => {
    for (const [locale, suffix, staffId, packageId, mode, title] of [
      ['ru', 5, Number(specialist), '13982379', 'package-confirmed', 'Sports massage'],
      ['en', 6, 0, '13982380', 'package-classic', 'Classic massage'],
    ]) {
      await scenario(mode);
      const composite = await openForm(browser, origin, locale, true, staffId, suffix, packageId);
      await composite.form.locator('#qf-email').fill(composite.email);
      await composite.button.click();
      const receipt = composite.page.getByRole('status').filter({
        has: composite.page.getByRole('heading', { name: composite.copy.booking.done.title }),
      });
      await expect(receipt.getByText(composite.copy.booking.done.references)).toBeVisible();
      await expect(receipt).toContainText('12345, 12346');
      await expect(receipt.getByText(title, { exact: true })).toBeVisible();
      await expect(receipt.getByText('Infrared capsule', { exact: true })).toBeVisible();
      for (const time of ['00:20', '01:05', '01:50']) await expect(receipt).toContainText(time);
      assert.equal(await calls('POST book_check'), packageId === '13982380' ? 3 : 1);
      assert.equal(await calls('POST book_record'), 1);
      assert.equal(await calls('GET book_record'), 2);
      assert.deepEqual(await successEvents(composite.page), [
        { event: 'booking_success', service_id: Number(packageId), staff_id: Number(specialist), currency: 'AED', source: 'form' },
      ]);
      await composite.page.close();
    }

    await scenario('package-partial');
    const partial = await openForm(browser, origin, 'en', true, 0, 7, '13982379');
    await partial.form.locator('#qf-email').fill(partial.email);
    await partial.button.click();
    await expect(partial.form.getByText(partial.copy.home.form.feedback.unknown)).toBeVisible();
    await expect(partial.button).toBeDisabled();
    assert.equal(await calls('POST book_record'), 1);
    assert.equal(await calls('GET book_record'), 1);
    assert.deepEqual(await successEvents(partial.page), []);
    await partial.page.close();
  });
  console.log('Quick form submission: RU/EN, composite receipts, validation, conflict recovery, consent, duplicate submit and lost response OK');
} finally {
  await browser?.close();
  for (const file of [journal, release, marker, comments, scenarioFile]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
