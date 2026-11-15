import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-booking-review-'));
const fixture = path.join(dir, 'scenario');
const journal = `${fixture}.journal`;
const release = `${fixture}.release`;
const comments = `${fixture}.comments`;
const marker = `${fixture}.created`;
const preload = new URL('../e2e/fixtures/altegio-record.mjs', import.meta.url).href;
const day = 86_400_000;
const date = new Date(Date.now() + 7 * day).toISOString().slice(0, 10);
const datetime = `${new Date(Date.now() + 6 * day).toISOString().slice(0, 10)}T23:20:00.123+03:00`;
const secrets = /fixture-partner-token|fixture-record-hash-secret|fixture-private-|visitor\d+@example\.test|\+97150\d{7}/;
const recordPath = '/api/booking/record';
let browser;

async function scenario(name) {
  for (const file of [release, marker, comments]) await fs.rm(file, { force: true });
  await fs.writeFile(journal, '');
  await fs.writeFile(fixture, name);
}

async function creates() {
  return (await fs.readFile(journal, 'utf8')).split('\n').filter((line) => line === 'POST book_record').length;
}

function run(check) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin);
    } finally {
      assert.doesNotMatch(logs(), secrets);
    }
  }, { preload, env: (origin) => ({
    BOOKING_ORIGIN: origin, BOOKING_CLIENT_IP_HEADER: '',
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token', ALTEGIO_CURRENCY: 'AED',
    RECORD_FIXTURE_SCENARIO: fixture, RECORD_FIXTURE_DATE: date, RECORD_FIXTURE_DATETIME: datetime,
  }) });
}

async function openReview(origin, locale, staffId, contactIndex, serviceId = 13982355) {
  const page = await browser.newPage({ viewport: { width: locale === 'ru' ? 390 : 1280, height: 850 }, timezoneId: 'America/Los_Angeles' });
  const messages = JSON.parse(await fs.readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
  const booking = `${origin}/${locale}/booking/`;
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  await page.addInitScript(({ staffId, contactIndex, date, datetime, serviceId }) => {
    if (sessionStorage.getItem('booking-fixture-seeded')) return;
    sessionStorage.setItem('booking-fixture-seeded', '1');
    const savedAt = Date.now();
    sessionStorage.setItem('bm.bookingSteps', JSON.stringify({ version: 2, serviceId, staffId, date, datetime, savedAt,
      contact: { fullname: 'fixture-private-fullname', phone: `+97150${String(contactIndex).padStart(7, '0')}`,
        email: `visitor${contactIndex}@example.test`, age: 36, consent: true, health: true },
    }));
    sessionStorage.setItem('bm.bookingDraft', JSON.stringify({ v: 1, model: 'male', savedAt, generalNote: 'fixture-private-general',
      markers: [{ id: 'marker-1', zoneId: 'knee_l', note: 'fixture-private-marker', intensity: 5, position: [0, 0, 0] }],
    }));
  }, { staffId, contactIndex, date, datetime, serviceId });
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === recordPath) posts.push(request.postDataJSON());
  });
  await page.goto(`${booking}?step=6`);
  const confirm = page.getByRole('button', { name: messages.booking.review.confirm, exact: true });
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId('captcha')).toHaveAttribute('hidden', '');
  await expect(page.getByTestId('captcha')).toBeHidden();
  return { page, messages, booking, posts, confirm };
}

async function checkReceipt(page, messages, booking, composite = false) {
  const copy = messages.booking.done;
  const done = page.locator('.booking-done');
  const details = done.locator('.bk-review');
  await expect(page).toHaveURL(`${booking}?step=7`);
  await expect(page.locator('#st7')).toHaveText(copy.title);
  await expect(details).toContainText(composite ? '12345, 12346' : '12345');
  await expect(details).toContainText('00:20');
  await expect(details).toContainText('Example specialist');
  if (composite) {
    await expect(details).toContainText('Infrared capsule');
    await expect(details).toContainText('Capsule operator');
    await expect(details).toContainText('01:50');
  }
  const account = done.locator('a[href$="/account/"]');
  await expect(account).toContainText(copy.myBookings);
  await expect(account).toBeHidden();
  const accountNote = done.locator('#booking-demo-account');
  await expect(accountNote).toHaveText(copy.demoAccount);
  await expect(accountNote).toBeHidden();
  const file = page.waitForEvent('download');
  await done.getByRole('button', { name: copy.calendarIcs }).click();
  const download = await file;
  assert.equal(download.suggestedFilename(), 'bodymechanic-booking.ics');
  const ics = await fs.readFile(await download.path(), 'utf8');
  const start = new Date(datetime).toISOString().replace(/[-:]|\.\d{3}/g, '');
  assert.ok(ics.includes(`DTSTART:${start}`));
  if (composite) assert.match(ics, /DTEND:\d{8}T215000Z/);
  else assert.doesNotMatch(ics, /DTEND:/);
  assert.doesNotMatch(ics, secrets);
  await page.evaluate(() => {
    window.fixtureActions = [];
    window.open = (url) => { window.fixtureActions.push(url); return {}; };
    window.print = () => { window.fixtureActions.push('print'); };
  });
  const google = done.getByRole('link', { name: copy.calendarGoogle });
  await expect(google).toHaveAttribute('href', 'https://calendar.google.com/calendar/render?action=TEMPLATE');
  await google.click();
  const whatsapp = done.getByRole('link', { name: copy.whatsapp });
  await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\d*$/);
  await whatsapp.click();
  await done.getByRole('button', { name: copy.pdf }).click();
  const [googleUrl, whatsappUrl, print] = await page.evaluate(() => window.fixtureActions);
  assert.equal(new URL(googleUrl).searchParams.get('dates').split('/')[0], start);
  assert.match(new URL(whatsappUrl).searchParams.get('text'), /12345/);
  assert.doesNotMatch(decodeURIComponent(googleUrl + whatsappUrl), secrets);
  assert.equal(print, 'print');
  await page.emulateMedia({ media: 'print' });
  await expect(details).toBeVisible();
  await expect(google).toBeHidden();
  await expect(done.getByRole('button', { name: messages.booking.draft.startOver })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
}

try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-3d-apis'] });
  await scenario('check-conflict');
  await run(async (origin) => {
    const { page, messages, booking, posts, confirm } = await openReview(origin, 'ru', 0, 1);
    try {
      await confirm.click();
      await expect(page).toHaveURL(`${booking}?step=4`);
      await expect(page.locator('#booking-error')).toHaveText(messages.booking.error.slotTaken);
      const draft = await page.evaluate(() => ['bm.bookingSteps', 'bm.bookingDraft'].map((key) => JSON.parse(sessionStorage.getItem(key))));
      assert.equal(draft[0].datetime, null);
      assert.equal(draft[0].contact.email, 'visitor1@example.test');
      assert.equal(draft[1].markers[0].note, 'fixture-private-marker');
      assert.equal(await creates(), 0);

      await scenario('record-sms');
      await page.getByRole('button', { name: '00:20', exact: true }).click();
      await page.getByRole('button', { name: messages.common.actions.next, exact: true }).click();
      await expect(page.locator('#c-phone')).toHaveValue('+971500000001');
      await page.getByRole('button', { name: messages.booking.contacts.next, exact: true }).click();
      await confirm.click();
      await expect(page.locator('#booking-review-notice')).toContainText(messages.home.form.feedback.sms);
      await expect(confirm).toBeEnabled();

      await scenario('hold-record');
      await confirm.evaluate((button) => { button.click(); button.click(); });
      await expect.poll(creates).toBe(1);
      await expect(page.getByRole('button', { name: messages.booking.review.confirming })).toBeDisabled();
      assert.equal(posts.length, 3);
      assert.equal(new Set(posts.map(({ idempotencyKey }) => idempotencyKey)).size, 3);
      const submitted = posts.at(-1);
      assert.equal(submitted.source, '3d');
      assert.equal(submitted.datetime, datetime);
      assert.equal(submitted.staffId, 0);
      assert.equal(submitted.consent, true);
      assert.equal(submitted.body3d.healthConsent, true);
      assert.deepEqual(submitted.body3d.markers, [{ zoneId: 'knee_l', intensity: 5, note: 'fixture-private-marker' }]);
      assert.equal('captchaToken' in submitted, false);
      const replay = await page.evaluate(async (input) => {
        const response = await fetch('/api/booking/record', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
      }, submitted);
      assert.deepEqual(replay, { status: 202, body: { data: { status: 'processing' } } });
      assert.equal(await creates(), 1);
      await fs.writeFile(release, '');
      await checkReceipt(page, messages, booking);
      assert.match(JSON.parse(await fs.readFile(comments, 'utf8')), /^\[Сайт\/3D\][\s\S]+fixture-private-marker/);
      await page.reload();
      await expect(page.locator('#st7')).toHaveText(messages.booking.done.title);
      assert.equal(await creates(), 1);
      await page.getByRole('button', { name: messages.booking.draft.startOver }).click();
      await expect(page).toHaveURL(booking);
      await expect(page.locator('#st1')).toBeVisible();
      assert.equal(await page.evaluate(() => sessionStorage.getItem('bm.bookingResult')), null);
      await page.goto(`${booking}?step=7`);
      await expect(page).toHaveURL(`${booking}?step=2`);
      await expect(page.locator('#st7')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  await scenario('empty-201');
  await run(async (origin) => {
    const { page, messages, booking, posts, confirm } = await openReview(origin, 'en', 91601, 2);
    try {
      await page.route((url) => url.pathname === recordPath, async (route) => {
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort('failed');
      }, { times: 1 });
      await confirm.click();
      await expect(page.getByText(messages.home.form.feedback.unknown, { exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      await expect(page.locator('#st6')).toHaveText(messages.booking.review.heading);
      assert.equal(await creates(), 1);
      assert.equal(posts[0].staffId, 91601);
      await page.reload();
      await expect(page.getByText(messages.home.form.feedback.unknown, { exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      await page.goto(booking);
      await expect(page).toHaveURL(`${booking}?step=6`);
      await expect(confirm).toBeDisabled();
      assert.equal(posts.length, 1);
      assert.equal(await creates(), 1);
    } finally {
      await page.close();
    }
  });
  await scenario('package-confirmed');
  await run(async (origin) => {
    const { page, messages, booking, confirm } = await openReview(origin, 'en', 91601, 3, 13982379);
    try {
      await confirm.click();
      await checkReceipt(page, messages, booking, true);
      await page.reload();
      await expect(page.locator('#st7')).toHaveText(messages.booking.done.title);
      await expect(page.locator('.booking-done .bk-review')).toContainText('12345, 12346');
      assert.equal(await creates(), 1);
    } finally {
      await page.close();
    }
  });
  console.log('3D booking: review and confirmed receipt, composite parts, calendar, print, restart and unknown outcome OK');
} finally {
  await browser?.close();
  for (const file of [fixture, journal, release, comments, marker]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
