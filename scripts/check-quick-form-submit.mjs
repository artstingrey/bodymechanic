import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { checkPhoneField } from '../e2e/fixtures/phone-field.mjs';
import { withProductionServer } from './check-server.mjs';
import { captchaPrivateValues, stubTurnstile, turnstileEnv } from '../e2e/fixtures/turnstile.mjs';

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
const resultStorage = 'bm.bookingResult.form';
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

async function openForm(browser, origin, locale, analytics, staffId, suffix, selectedService = serviceId, exerciseCaptcha = false) {
  const page = await browser.newPage({ viewport: { width: locale === 'ru' ? 390 : 1280, height: 850 }, timezoneId: 'America/Los_Angeles' });
  if (exerciseCaptcha) await page.clock.install();
  await page.addInitScript((allowed) => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, marketing: false, analytics: allowed, at: 'fixture',
  })), analytics);
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  const scriptRequests = await stubTurnstile(page);
  if (exerciseCaptcha) {
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      (route) => route.abort(), { times: 1 });
  }
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
  if (exerciseCaptcha) {
    await expect(form.locator('.captcha.cap')).toContainText(copy.booking.captcha.error, { timeout: 18_000 });
    await expect(button).toBeDisabled();
    await form.getByRole('button', { name: copy.booking.captcha.retry }).click();
  }
  await expect(button).toBeEnabled();
  await expect(form.locator('.captcha.cap').getByTitle('Synthetic Turnstile')).toBeVisible();
  const service = form.locator('#qf-service');
  await service.click();
  await form.locator(`#qf-service-options input[value="${selectedService}"]`).check();
  await service.press('Escape');
  if (staffId !== 0) await form.locator('#qf-staff').selectOption(String(staffId));
  await form.locator('#qf-date').selectOption(date);
  const time = form.locator('#qf-time');
  await time.selectOption(datetime);
  const phone = `+97150${String(suffix).padStart(7, '0')}`;
  const email = `visitor${suffix}@example.test`;
  await form.locator('#qf-name').fill('fixture-private-fullname');
  const field = form.locator('#qf-phone');
  if (suffix === 1 || suffix === 2) {
    await checkPhoneField(field, { copy: copy.forms, submit: () => button.click() });
    assert.deepEqual(requests, []);
  }
  await field.fill(phone);
  await form.locator('#qf-age').fill('38');
  await form.locator('textarea').fill('fixture-private-note');
  await form.locator('#qf-consent').check();
  return { page, copy, form, button, time, requests, lookups, phone, email, scriptRequests };
}

async function checkCaptchaLifecycle(origin) {
  const { page, copy, form, button, requests, email, scriptRequests } = await openForm(browser, origin, 'ru', true, 0, 17, serviceId, true);
  const retry = form.getByRole('button', { name: copy.booking.captcha.retry });
  const widget = form.locator('.captcha.cap');
  const respond = (type, token) => page.evaluate(({ type, token }) => {
    const { widgets, respond } = window.fixtureTurnstile;
    respond([...widgets.values()][0], type, token);
  }, { type, token });
  try {
    await form.locator('#qf-email').fill(email);
    await page.clock.fastForward(300_000);
    await expect(widget).toContainText(copy.booking.captcha.expired);
    await expect(button).toBeDisabled();
    await form.evaluate((element) => element.requestSubmit());
    assert.deepEqual(requests, []);
    await retry.click();
    await expect(button).toBeEnabled();
    await respond('expired');
    await expect(widget).toContainText(copy.booking.captcha.expired);
    await retry.click();
    await expect(button).toBeEnabled();
    await respond('timeout');
    await expect(widget).toContainText(copy.booking.captcha.error);
    await expect(button).toBeDisabled();
    await retry.click();
    await expect(button).toBeEnabled();

    for (const [token, status, feedback] of [
      ['synthetic-captcha-expired', 422, copy.home.form.feedback.captchaInvalid],
      ['synthetic-captcha-http', 503, copy.home.form.feedback.captchaUnavailable],
    ]) {
      await respond('success', token);
      const response = page.waitForResponse((r) => r.url().endsWith('/api/booking/record'));
      await button.click();
      assert.equal((await response).status(), status);
      await expect(form.getByRole('alert').filter({ hasText: feedback })).toBeVisible();
      await expect(form.locator('#qf-email')).toHaveValue(email);
      await expect(form.locator('textarea')).toHaveValue('fixture-private-note');
      await expect(form.locator('#qf-consent')).toBeChecked();
      await expect(button).toBeEnabled();
      assert.equal(await calls('POST book_record'), 0);
    }
    await button.click();
    await assertConfirmed(page, copy);
    assert.equal(await calls('POST book_record'), 1);
    assert.equal(scriptRequests(), 1);
    const clientData = await page.evaluate(() => JSON.stringify([location.href, { ...sessionStorage }, { ...localStorage }, window.dataLayer]));
    assert.doesNotMatch(clientData, captchaPrivateValues);
  } finally {
    await page.close();
  }
}

async function assertConfirmed(page, copy) {
  const receipt = page.getByRole('status').filter({ has: page.getByRole('heading', { name: copy.booking.done.title }) });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('12345');
  await expect(receipt).toContainText('00:20');
  await expect(receipt).toContainText('Example specialist');
  await expect(receipt).not.toContainText(copy.home.form.anyStaffOption);
}

async function checkLandingContacts(form, copy) {
  await form.locator('input[name="name"]').fill('Fixture visitor');
  await form.locator('input[name="email"]').fill('visitor@example.test');
  const submit = () => form.locator('button[type="submit"]').click();
  await checkPhoneField(form.locator('input[name="phone"]'), { copy: copy.forms, submit, invalid: copy.lp.error.phone });
  await submit();
  await expect(form.getByRole('heading', { name: copy.booking.service.heading })).toBeVisible();
}

async function checkAccountAndLandings(origin, locale) {
  const copy = messages[locale];
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  try {
    await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
      necessary: true, analytics: false, marketing: false, at: 'fixture',
    })));
    await page.route((url) => url.origin !== origin, (route) => route.abort());
    await page.goto(`${origin}/${locale}/account/`, { waitUntil: 'networkidle' });
    const getCode = page.getByRole('button', { name: copy.account.login.getCode });
    await checkPhoneField(page.locator('#acc-phone'), { copy: copy.forms, submit: () => getCode.click() });
    await getCode.click();
    await page.locator('#acc-code').fill('1234');
    await page.getByRole('button', { name: copy.account.login.submit }).click();
    await expect(page.getByTestId('account-record')).toHaveCount(3);

    for (const variant of ['a', 'b']) {
      const landing = `${origin}/${locale}/lp/${variant}/`;
      await page.goto(landing, { waitUntil: 'networkidle' });
      await checkLandingContacts(page.locator('#lp-f1'), copy);
      await checkLandingContacts(page.locator('#lp-f2'), copy);
      await page.goto(`${landing}?form=sheet`, { waitUntil: 'networkidle' });
      await page.locator('.lp-hero-cta button').click();
      await checkLandingContacts(page.locator('#lp-fs'), copy);
    }
  } finally {
    await page.close();
  }
}

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin);
    } finally {
      assert.doesNotMatch(logs(), privateValues);
      assert.doesNotMatch(logs(), captchaPrivateValues);
    }
  }, { preload, env: (origin) => ({
    ...turnstileEnv,
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
  await run(checkCaptchaLifecycle);
  await scenario('empty-201');
  await run(async (origin) => {
    for (const locale of ['en', 'ru']) {
      await checkAccountAndLandings(origin, locale);
      console.log(`Account and landing phone fields: manual entry, paste, autofill and validation passed in ${locale.toUpperCase()}`);
    }
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
      serviceIds: [Number(serviceId)], staffId: Number(specialist), datetime, locale: 'en', consent: true,
      idempotencyKey: second.idempotencyKey, recoveryKey: second.recoveryKey,
      captchaToken: second.captchaToken,
      contact: { fullname: 'fixture-private-fullname', phone: en.phone, email: en.email },
      age: 38, condition: 'fixture-private-note',
    });
    assert.match(second.captchaToken, captchaPrivateValues);
    assert.notEqual(first.captchaToken, second.captchaToken);
    await fs.writeFile(release, '');
    await assertConfirmed(en.page, en.copy);
    assert.deepEqual(await successEvents(en.page), [{ event: 'booking_success', service_id: Number(serviceId), staff_id: Number(specialist), currency: 'AED', source: 'form' }]);
    assert.equal(await calls('POST book_record'), 1);
    assert.equal(await calls('POST locations'), 0);
    assert.equal(JSON.parse(await fs.readFile(comments, 'utf8')), '[Сайт/форма] Age: 38\nCondition: fixture-private-note');
    const saved = await en.page.evaluate((key) => sessionStorage.getItem(key), resultStorage);
    assert.equal(JSON.parse(saved).status, 'created');
    assert.doesNotMatch(saved, privateValues);
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
    const stored = await timeout.page.evaluate((key) => sessionStorage.getItem(key), resultStorage);
    assert.equal(JSON.parse(stored).attempt.idempotencyKey, timeout.requests[0].idempotencyKey);
    assert.doesNotMatch(stored, privateValues);
    await timeout.page.reload({ waitUntil: 'networkidle' });
    await expect(timeout.button).toBeDisabled();
    await expect(timeout.form.getByText(timeout.copy.home.form.feedback.unknown)).toBeVisible();
    await timeout.form.getByRole('button', { name: timeout.copy.booking.done.checkStatus }).click();
    await expect.poll(() => timeout.requests.length).toBe(2);
    assert.deepEqual(timeout.requests[1], {
      idempotencyKey: timeout.requests[0].idempotencyKey, recoveryKey: timeout.requests[0].recoveryKey, locale: 'ru',
    });
    await expect(timeout.form.getByText(timeout.copy.home.form.feedback.unknown)).toBeVisible();
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
    await lost.page.reload({ waitUntil: 'networkidle' });
    await lost.form.getByRole('button', { name: lost.copy.booking.done.checkStatus }).click();
    await assertConfirmed(lost.page, lost.copy);
    assert.equal(await calls('POST book_record'), 1);
    assert.deepEqual(lost.requests[1], {
      idempotencyKey: lost.requests[0].idempotencyKey, recoveryKey: lost.requests[0].recoveryKey, locale: 'en',
    });
    assert.equal((await successEvents(lost.page)).length, 1);
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
