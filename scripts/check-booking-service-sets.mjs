import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, webkit } from '@playwright/test';
import en from '../messages/en.json' with { type: 'json' };
import ru from '../messages/ru.json' with { type: 'json' };
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-service-sets-'));
const fixture = path.join(dir, 'scenario');
const preload = new URL('../e2e/fixtures/altegio-record.mjs', import.meta.url).href;
const journal = `${fixture}.journal`;
const release = `${fixture}.release`;
const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const datetime = `${day}T14:20:00+04:00`;
const services = [91201, 91203];
const title = /Optional prepayment.*Infrared capsule/;
const confirmedTitle = /Service 91201.*Service 91203/;
const missing = 91204;
const sports = 13982355;
const contact = { fullname: 'fixture-private-fullname', phone: '+971501234567', email: 'visitor@example.test', consent: true };
const setScenario = (mode = 'multi-normal') => fs.writeFile(fixture, mode);
const creates = async () => (await fs.readFile(journal, 'utf8').catch(() => '')).split('\n').filter((line) => line === 'POST book_record').length;

async function newPage(browser, origin, width) {
  const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 768, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12_000);
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, analytics: false, marketing: false, at: new Date().toISOString(),
  })));
  await page.route((url) => url.origin !== origin, (route) => route.fulfill({ body: '' }));
  return page;
}

function serviceChoice(form, id) {
  return form.locator(`input[type="checkbox"][value="${id}"]`);
}

async function chooseTime(root) {
  const available = root.locator('.cal button[data-available]');
  await expect(available).toHaveCount(1);
  await available.click();
  await root.getByRole('button', { name: '14:20', exact: true }).click();
}

async function verifyConflict(page, button, afterConflict) {
  await setScenario('multi-create-conflict');
  const pending = page.waitForResponse((response) => response.url().endsWith('/api/booking/record') && response.request().method() === 'POST');
  await button.click();
  const response = await pending;
  assert.equal(response.status(), 409);
  assert.equal((await response.json()).error.code, 'SLOT_TAKEN');
  assert.deepEqual(response.request().postDataJSON().serviceIds, services);
  await setScenario();
  await afterConflict();
}

async function verifySubmission(page, root, button, copy, source, staffId, reopen) {
  await setScenario('multi-receipt-hold');
  await fs.rm(release, { force: true });
  const before = await creates();
  const requests = [];
  const record = (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/booking/record';
  page.on('request', (request) => { if (record(request)) requests.push(request.postDataJSON()); });
  const lost = Promise.withResolvers();
  await page.route('**/api/booking/record', async (route) => {
    try {
      const upstream = await route.fetch();
      lost.resolve({ status: upstream.status(), body: await upstream.json() });
    } catch (error) {
      lost.reject(error);
    } finally {
      await route.abort('failed').catch(() => {});
    }
  }, { times: 1 });

  try {
    await expect(button).toBeEnabled();
    await button.evaluate((control) => { control.click(); control.click(); });
    await expect.poll(creates).toBe(before + 1);
    assert.equal(requests.length, 1, 'only one create request on a double click');
    const [body] = requests;
    assert.deepEqual([body.source, body.serviceIds, body.staffId, body.datetime], [source, services, staffId, datetime]);
    const replay = await page.evaluate(async (input) => {
      const response = await fetch('/api/booking/record', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      return { status: response.status, body: await response.json() };
    }, body);
    assert.deepEqual(replay, { status: 202, body: { data: { status: 'processing' } } });
    await fs.writeFile(release, '');
    const success = await lost.promise;
    assert.equal(success.status, 201);
    assert.deepEqual(success.body.data.services.map(({ id }) => id), services);
    assert.equal(success.body.data.staff.id, 91601);
    assert.equal(success.body.data.durationSeconds, 4200);
    await expect(root.getByText(copy.home.form.feedback.unknown, { exact: true })).toBeVisible();
    await expect(page.locator('[data-result="created"], .qform__receipt, .lp-thanks')).toHaveCount(0);

    // Neither a changed catalog nor a page reload may generate another creation.
    await setScenario('multi-renamed-catalog');
    await page.reload({ waitUntil: 'networkidle' });
    await reopen?.();
    const checking = page.waitForResponse((response) => response.url().endsWith('/api/booking/record/status'));
    await root.getByRole('button', { name: copy.booking.done.checkStatus }).click();
    const checked = await checking;
    assert.equal(checked.status(), 201);
    assert.notEqual(body.recoveryKey, body.idempotencyKey);
    assert.deepEqual(checked.request().postDataJSON(), {
      idempotencyKey: body.idempotencyKey, recoveryKey: body.recoveryKey, locale: body.locale,
    });
    assert.deepEqual((await checked.json()).data, success.body.data);
    assert.equal(await creates(), before + 1);
  } finally {
    await fs.writeFile(release, '');
    await setScenario();
  }
}

async function checkCalendarAndPrint(page, root, copy) {
  const receipt = root.locator('[data-result="created"]');
  await expect(receipt).toContainText(confirmedTitle);
  await expect(receipt).toContainText('Specialist 91601');
  await expect(receipt).toContainText(/70/);
  await expect(receipt).toContainText(/175/);
  const download = page.waitForEvent('download');
  await receipt.getByRole('button', { name: copy.booking.done.calendarIcs }).click();
  const contents = await fs.readFile(await (await download).path(), 'utf8');
  const iso = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
  assert.ok(contents.includes(`DTSTART:${iso(Date.parse(datetime))}`));
  assert.ok(contents.includes(`DTEND:${iso(Date.parse(datetime) + 4200_000)}`));
  assert.match(contents, /SUMMARY:.*Service 91201.*Service 91203/);
  assert.match(contents, /Specialist 91601/);
  await page.evaluate(() => {
    window.receiptActions = [];
    window.open = (url) => { window.receiptActions.push(url); return {}; };
    window.print = () => { window.receiptActions.push('print'); };
  });
  await receipt.getByRole('link', { name: copy.booking.done.calendarGoogle }).click();
  await receipt.getByRole('link', { name: copy.booking.done.whatsapp }).click();
  await receipt.getByRole('button', { name: copy.booking.done.pdf }).click();
  const [google, chat, print] = await page.evaluate(() => window.receiptActions);
  assert.match(new URL(google).searchParams.get('text'), confirmedTitle);
  assert.ok(new URL(google).searchParams.get('dates').endsWith(iso(Date.parse(datetime) + 4200_000)));
  assert.match(new URL(chat).searchParams.get('text'), confirmedTitle);
  assert.match(new URL(chat).searchParams.get('text'), /Specialist 91601/);
  assert.equal(print, 'print');
}

async function check3d(browser, origin, locale, copy) {
  const page = await newPage(browser, origin, locale === 'ru' ? 390 : 1280);
  const url = `${origin}/${locale}/booking/`;
  const booking = page.locator('.booking');
  const next = booking.getByRole('button', { name: copy.common.actions.next, exact: true });
  const back = booking.getByRole('button', { name: copy.common.actions.back, exact: true });
  try {
    await page.goto(url);
    await page.evaluate(({ id, contact }) => {
      const savedAt = Date.now();
      sessionStorage.setItem('bm.bookingSteps', JSON.stringify({ version: 2, serviceId: id, staffId: 0, contact, savedAt }));
      sessionStorage.setItem('bm.bookingDraft', JSON.stringify({
        v: 1, savedAt, model: 'male', generalNote: 'fixture-private-note',
        markers: [{ id: 'test-zone', zoneId: 'chest', position: [0, 0, 0], intensity: 5 }],
      }));
    }, { id: services[0], contact });
    await page.goto(`${url}?step=2`);
    await expect(serviceChoice(booking, services[0])).toBeChecked();
    const migrated = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')));
    assert.deepEqual(migrated.serviceIds, [services[0]]);
    assert.equal(migrated.version, 3);
    assert.deepEqual(migrated.contact, contact);
    await serviceChoice(booking, missing).check();
    await next.click();
    await expect(booking.getByText(copy.booking.staff.empty)).toBeVisible();
    await expect(next).toBeDisabled();
    await back.click();
    await serviceChoice(booking, missing).uncheck();
    await serviceChoice(booking, services[1]).focus();
    await page.keyboard.press('Space');
    await expect(serviceChoice(booking, services[1])).toBeChecked();
    await page.reload();
    for (const id of services) await expect(serviceChoice(booking, id)).toBeChecked();
    assert.equal(new URL(page.url()).searchParams.has('serviceIds'), false);
    await next.click();
    await expect(booking.locator('input[name="staff"][value="91601"]')).toBeChecked();
    await expect(booking.locator('#bk-sum ~ dl, .bk-summary dl')).toContainText(/175.*AED|AED.*175/);
    await next.click();
    await chooseTime(booking);
    await back.click();
    await expect(booking).toHaveAttribute('data-step', '3');
    await back.click();
    await expect(booking).toHaveAttribute('data-step', '2');
    await serviceChoice(booking, services[1]).uncheck();
    await serviceChoice(booking, services[1]).check();
    await next.click();
    await expect(booking).toHaveAttribute('data-step', '3');
    await expect(booking.locator('input[name="staff"][value="91601"]')).toBeChecked();
    await next.click();
    await expect(booking).toHaveAttribute('data-step', '4');
    await expect(next).toBeDisabled();
    await chooseTime(booking);
    await next.click();
    await expect(page.locator('#c-email')).toHaveValue(contact.email);
    await expect(page.locator('#c-consent')).toBeChecked();
    await booking.locator('form').getByRole('button', { name: copy.booking.contacts.next, exact: true }).click();
    const review = booking.locator('.bk-review');
    await expect(review).toContainText(title);
    await expect(review).toContainText(copy.body3d.zones.chest);
    await expect(review).toContainText(/175.*AED|AED.*175/);
    const confirm = booking.getByRole('button', { name: copy.booking.review.confirm });
    await verifyConflict(page, confirm, async () => {
      await expect(booking).toHaveAttribute('data-step', '4');
      await expect(page.locator('#booking-error')).toBeVisible();
      await expect(booking.locator('.bk-summary')).toContainText(title);
      await chooseTime(booking);
      await next.click();
      await expect(page.locator('#c-email')).toHaveValue(contact.email);
      await booking.locator('form').getByRole('button', { name: copy.booking.contacts.next, exact: true }).click();
    });
    await verifySubmission(page, booking, confirm, copy, '3d', 91601);
    await checkCalendarAndPrint(page, booking, copy);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(booking.locator('[data-result="created"]')).toContainText(confirmedTitle);
  } finally {
    await page.close();
  }
}

async function checkQuick(browser, origin, locale, copy) {
  const page = await newPage(browser, origin, locale === 'ru' ? 390 : 1280);
  try {
    await page.goto(`${origin}/${locale}/`);
    const form = page.locator('form.qform');
    const trigger = form.locator('#qf-service');
    const time = form.locator('#qf-time');
    const date = form.locator('#qf-date');
    const submit = form.getByRole('button', { name: copy.home.form.submit, exact: true });
    await form.locator('#qf-name').fill(contact.fullname);
    await form.locator('#qf-phone').fill(contact.phone);
    await form.locator('#qf-email').fill(contact.email);
    await form.locator('#qf-consent').check();
    await expect(trigger).toBeEnabled();
    const fieldGeometry = () => form.locator('#qf-staff').evaluate((element) => [element.offsetLeft, element.offsetTop, element.offsetWidth]);
    const originalGeometry = await fieldGeometry();
    if (locale === 'ru') await trigger.tap();
    else await trigger.click();
    assert.deepEqual(await fieldGeometry(), originalGeometry);
    await serviceChoice(form, services[0]).focus();
    await page.keyboard.press('Space');
    let held = false;
    const release = Promise.withResolvers();
    const oldTime = (url) => url.pathname === '/api/booking/times' && url.searchParams.getAll('serviceIds').length === 1;
    await page.route(oldTime, async (route) => {
      held = true;
      await release.promise;
      await route.fulfill({ json: { data: { serviceIds: [services[0]], staffId: 0, date: day, times: [{ datetime, time: '14:20' }] } } }).catch(() => {});
    }, { times: 1 });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await date.selectOption(day);
    await expect.poll(() => held).toBe(true);
    try {
      await trigger.click();
      await serviceChoice(form, services[1]).check();
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toContainText(title);
      await expect(form.locator('#qf-staff')).toHaveValue('91601');
      await expect(date).toHaveValue('');
      await expect(submit).toBeDisabled();
    } finally {
      release.resolve();
    }
    await expect(time).toBeDisabled();
    await expect(form.locator('#qf-email')).toHaveValue(contact.email);

    await setScenario('multi-no-window');
    await trigger.click();
    await serviceChoice(form, services[1]).uncheck();
    await serviceChoice(form, services[1]).check();
    await page.keyboard.press('Escape');
    await expect(form.locator('#qf-dates-status')).toHaveText(copy.home.form.availability.dates.empty);
    await expect(submit).toBeDisabled();
    await setScenario();

    await trigger.click();
    await serviceChoice(form, services[1]).uncheck();
    await serviceChoice(form, sports).check();
    await setScenario('multi-service-removed');
    await serviceChoice(form, services[1]).check();
    await expect(form.getByRole('alert')).toContainText(copy.booking.service.removed);
    await expect(serviceChoice(form, sports)).toHaveCount(0);
    await setScenario();
    await page.keyboard.press('Escape');
    await expect(trigger).toContainText(title);
    await date.selectOption(day);
    await time.selectOption(datetime);
    await expect(form.getByText(/175.*AED|AED.*175/)).toBeVisible();
    assert.ok(await form.evaluate((element) => element.scrollWidth <= element.clientWidth));
    await verifyConflict(page, submit, async () => {
      await expect(form.getByText(copy.home.form.feedback.slotTaken)).toBeVisible();
      await expect(trigger).toContainText(title);
      await expect(form.locator('#qf-email')).toHaveValue(contact.email);
      await expect(time).toHaveValue('');
      await time.selectOption(datetime);
    });
    await verifySubmission(page, page.locator('.qform'), submit, copy, undefined, 91601);
    const receipt = page.locator('.qform__receipt');
    await expect(receipt).toContainText(confirmedTitle);
    await expect(receipt).toContainText('Specialist 91601');
    await expect(receipt).toContainText(/70/);
    await expect(receipt).toContainText(/175/);
    await page.setViewportSize({ width: 320, height: 850 });
    const duration = receipt.getByText(copy.booking.done.duration, { exact: true });
    assert.equal(await duration.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    }), 1, 'the duration label fits on one line in the mobile receipt');
    assert.ok(await receipt.evaluate((element) => element.scrollWidth <= element.clientWidth));
  } finally {
    await setScenario();
    await page.close();
  }
}

async function checkLanding(browser, origin, locale, copy, variant, id) {
  const page = await newPage(browser, origin, id === 'lp-f2' ? 1280 : 390);
  const form = page.locator(`#${id}`);
  try {
    await page.goto(`${origin}/${locale}/lp/${variant}/${id === 'lp-fs' ? '?form=sheet' : ''}`, { waitUntil: 'networkidle' });
    if (id === 'lp-fs') await page.locator('.lp-hero-cta button').click();
    await form.locator('input[name="name"]').fill(contact.fullname);
    await form.locator('input[name="phone"]').fill(contact.phone);
    await form.locator('input[name="email"]').fill(contact.email);
    await expect(form.locator('input[name="name"]')).toHaveValue(contact.fullname);
    await form.getByRole('button', { name: copy.lp.booking.selectService }).click();
    const advance = form.getByRole('button', { name: copy.lp.form.submit });
    await expect(advance).toBeDisabled();
    await serviceChoice(form, services[0]).check();
    await serviceChoice(form, missing).check();
    await expect(form.getByText(copy.home.form.availability.staff.empty)).toBeVisible();
    await expect(advance).toBeDisabled();
    await serviceChoice(form, missing).uncheck();
    await serviceChoice(form, services[1]).check();
    await advance.click();
    await expect(form.getByText(title)).toContainText(/164[,.]4/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await expect(form.locator('input[name="staff"]')).toHaveCount(0);
    await chooseTime(form);
    const next = form.getByRole('button', { name: copy.lp.booking.continue });
    await next.click();
    const note = form.locator('textarea[name="condition"]');
    await note.fill('fixture-private-note');
    await form.getByRole('button', { name: copy.common.actions.back, exact: true }).click();
    await next.click();
    await expect(note).toHaveValue('fixture-private-note');
    await form.locator('input[name="consent"]').check();
    const submit = form.getByRole('button', { name: copy.lp.booking.book });
    await verifyConflict(page, submit, async () => {
      await expect(form.getByText(copy.home.form.feedback.slotTaken)).toBeVisible();
      await expect(form.getByText(title)).toBeVisible();
      await chooseTime(form);
      await next.click();
      await expect(note).toHaveValue('fixture-private-note');
      await expect(form.locator('input[name="consent"]')).toBeChecked();
    });
    await verifySubmission(page, form, submit, copy, 'lp', 0, id === 'lp-fs'
      ? () => page.locator('.lp-hero-cta button').click() : undefined);
    const receipt = form.locator('.lp-thanks');
    await expect(receipt).toContainText(confirmedTitle);
    await expect(receipt).toContainText('Specialist 91601');
    await expect(receipt).toContainText(/70/);
    await expect(receipt).toContainText(/164[,.]4/);
    const whatsapp = receipt.getByRole('link', { name: copy.lp.form.whatsapp });
    await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+$/);
    await page.evaluate(() => { window.open = (url) => { window.receiptChat = url; return {}; }; });
    await whatsapp.click();
    const message = new URL(await page.evaluate(() => window.receiptChat)).searchParams.get('text');
    assert.match(message, confirmedTitle);
    assert.match(message, /Specialist 91601/);
  } finally {
    await page.close();
  }
}

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin);
    } catch (error) {
      console.error(logs().split('\n').slice(-20).join('\n'));
      throw error;
    }
  }, { preload, env: (origin) => ({
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)), ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    ALTEGIO_CURRENCY: 'AED', BOOKING_ORIGIN: origin, BOOKING_CLIENT_IP_HEADER: '', BOOKING_QUICK_FORM_ENABLED: 'true',
    RECORD_FIXTURE_DATE: day, RECORD_FIXTURE_DATETIME: datetime, RECORD_FIXTURE_SCENARIO: fixture,
  }) });
}

try {
  await setScenario();
  for (const [engine, launch] of [[chromium, { channel: 'chrome', args: ['--disable-3d-apis'] }], [webkit, {}]]) {
    const browser = await engine.launch(launch);
    try {
      for (const [locale, copy] of Object.entries({ ru, en })) {
        // Each isolated server stays within the existing five-attempt window.
        await run(async (origin) => {
          await check3d(browser, origin, locale, copy);
          await checkQuick(browser, origin, locale, copy);
        });
        for (const variant of ['a', 'b']) {
          await run(async (origin) => {
            for (const id of ['lp-f1', 'lp-f2']) await checkLanding(browser, origin, locale, copy, variant, id);
          });
          await run((origin) => checkLanding(browser, origin, locale, copy, variant, 'lp-fs'));
        }
        console.log(`Booking sets ${engine.name()} ${locale}: 3D, home, both landings and all placements OK`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  for (const file of [fixture, journal, release, `${fixture}.comments`, `${fixture}.selection`]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
