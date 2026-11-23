import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { checkPhoneField } from '../e2e/fixtures/phone-field.mjs';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-booking-services-'));
const scenarioFile = path.join(dir, 'catalog');
const staffFixture = path.join(dir, 'staff');
const availabilityFixture = path.join(dir, 'availability');
const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;
const sports = 13982355;
const classic = 13982356;
const other = 91201;
const cacheKeys = new Set();
let browser;

async function checkServiceEntry(page, origin, locale, messages) {
  const detail = `${origin}/${locale}/services/sports/`;
  const booking = `${origin}/${locale}/booking/`;
  const cta = page.locator('.svc-hero').getByRole('link', { name: messages.service.cta, exact: true });
  const checked = page.locator('input[name="service"]:checked');
  const next = page.getByRole('button', { name: messages.common.actions.next, exact: true });
  const draft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')));
  const openFromDetail = async () => {
    await expect(cta).toHaveAttribute('href', `/${locale}/booking/`);
    await cta.click();
    await expect(page).toHaveURL(booking);
    await expect(page.locator('.booking[data-ready="true"] #st1')).toBeVisible();
    await expect(page.locator('.b3d-slot[data-mode="booking"]')).toBeVisible();
  };
  const skipZones = async () => {
    await page.getByRole('button', { name: messages.body3d.panel.skip, exact: true }).click();
    await expect(page).toHaveURL(`${booking}?step=2`);
  };

  await page.goto(detail);
  // A copied address and a modifier click carry no service.
  const copied = await cta.getAttribute('href');
  const [newTab] = await Promise.all([page.context().waitForEvent('page'), cta.click({ modifiers: ['ControlOrMeta'] })]);
  try {
    await expect(newTab).toHaveURL(booking);
    await expect(newTab.locator('.booking[data-ready="true"] #st1')).toBeVisible();
    await newTab.getByRole('button', { name: messages.body3d.panel.skip, exact: true }).click();
    await expect(newTab.locator(`input[name="service"][value="${sports}"]`)).not.toBeChecked();
    await expect(page).toHaveURL(detail);
  } finally {
    await newTab.close();
  }
  await page.goto(new URL(copied, origin).href);
  await expect(page.locator('.booking[data-ready="true"] #st1')).toBeVisible();
  await skipZones();
  await expect(page.locator(`input[name="service"][value="${sports}"]`)).not.toBeChecked();

  await page.goto(detail);
  await openFromDetail();
  await skipZones();
  await expect(checked).toHaveValue(String(sports));
  await expect(next).toBeEnabled();

  const contact = { fullname: 'Fixture Visitor', phone: '+971501234567', email: 'fixture@example.test', consent: true };
  await page.evaluate(({ other, contact }) => {
    const savedAt = Date.now() - 60_000;
    sessionStorage.setItem('bm.bookingSteps', JSON.stringify({
      version: 2, savedAt, serviceId: other, staffId: 91605, contact: { ...contact, health: false },
      date: '2026-11-30', datetime: '2026-11-30T12:00:00+04:00', wantDate: '2026-11-30', wantTime: '12:00',
    }));
    sessionStorage.setItem('bm.bookingDraft', JSON.stringify({
      v: 1, savedAt, model: 'male', generalNote: '',
      markers: [{ id: 'fixture-zone', zoneId: 'chest', position: [0, 0, 0], intensity: 5 }],
    }));
  }, { other, contact });
  await page.goto(detail);
  await openFromDetail();
  await expect(page.locator('#zone-list').getByRole('checkbox', { name: messages.body3d.zones.chest, exact: true })).toBeChecked();
  await page.getByRole('button', { name: messages.body3d.panel.cta, exact: true }).click();
  await expect(page).toHaveURL(`${booking}?step=2`);
  await expect(checked).toHaveValue(String(sports));
  const { serviceId, staffId, date, datetime, wantDate, wantTime, contact: restoredContact } = await draft();
  assert.deepEqual({ serviceId, staffId, date, datetime, wantDate, wantTime, restoredContact }, {
    serviceId: sports, staffId: 0, date: null, datetime: null, wantDate: null, wantTime: null, restoredContact: contact,
  });

  // The detail is still available, but the current booking catalog no longer contains the preset service.
  await page.route(`**/api/catalog/services?locale=${locale}`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.data.services = json.data.services.filter(({ id }) => id !== sports);
    await route.fulfill({ response, json });
  });
  await page.goto(detail);
  await openFromDetail();
  await skipZones();
  await expect(page.locator(`input[name="service"][value="${other}"]`)).toBeVisible();
  await expect(checked).toHaveCount(0);
  await expect(next).toBeDisabled();
  await expect.poll(async () => (await draft()).serviceId).toBeNull();
  await page.locator(`input[name="service"][value="${other}"]`).check();
  await expect(next).toBeEnabled();
}

async function checkStaff(page, booking, messages) {
  const { next, back, retry } = messages.common.actions;
  const any = page.locator('input[name="staff"][value="0"]');
  const staff = (id) => page.locator(`input[name="staff"][value="${id}"]`);
  const service = (id) => page.locator(`input[name="service"][value="${id}"]`);
  const summary = page.locator('.bk-summary');
  const draft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')));
  const staffUrl = (id) => (url) => url.pathname === '/api/booking/staff' && url.searchParams.get('serviceId') === String(id);
  const slotPreset = '&date=2026-11-30&time=12:00';

  await page.goto(`${booking}?step=3&service=${sports}&staff=91602${slotPreset}&utm_source=fixture#st3`);
  await expect(page).toHaveURL(`${booking}?step=3&utm_source=fixture#st3`);
  await expect(staff(91602)).toBeChecked();
  await expect(summary).toContainText('Sam Example');
  await expect(page.getByRole('button', { name: next })).toBeEnabled();
  await expect(page.locator('#st4, #st7')).toHaveCount(0);
  assert.equal((await draft()).wantTime, '12:00');
  await page.evaluate(() => {
    const key = 'bm.bookingSteps';
    const stored = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.setItem(key, JSON.stringify({ ...stored, date: '2026-11-30', datetime: '2026-11-30T12:00:00+04:00' }));
  });
  await page.reload();
  await expect(staff(91602)).toBeChecked();

  await page.getByRole('button', { name: back }).click();
  await expect(service(sports)).toBeChecked();
  let pending = false;
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  await page.route(staffUrl(sports), async (route) => {
    try {
      const response = await route.fetch();
      pending = true;
      await release.promise;
      await route.fulfill({ response }).catch(() => {});
    } finally {
      finished.resolve();
    }
  }, { times: 1 });
  try {
    await page.getByRole('button', { name: next }).click();
    await expect.poll(() => pending).toBe(true);
    await page.getByRole('button', { name: back }).click();
    await service(other).check();
    await page.getByRole('button', { name: next }).click();
    await expect(staff(91605)).toBeVisible();
    await expect(any).toBeChecked();
    const switched = await draft();
    assert.equal(switched.staffId, 0);
    assert.equal(switched.date, null);
    assert.equal(switched.datetime, null);
    assert.equal(switched.wantTime, null);
    await staff(91605).check();
    await expect(summary).toContainText('Taylor Example');
    release.resolve();
    await finished.promise;
    await expect(staff(91602)).toHaveCount(0);
    await expect(summary).toContainText('Taylor Example');
  } finally {
    release.resolve();
  }

  const empty = 91204;
  await page.route(staffUrl(empty), (route) => route.fulfill({ status: 503, json: { error: { code: 'CATALOG_UNAVAILABLE' } } }), { times: 1 });
  await page.goto(`${booking}?step=3&service=${empty}&staff=91602${slotPreset}`);
  await expect(page.getByRole('alert').filter({ hasText: messages.booking.staff.loadError })).toBeVisible();
  assert.equal((await draft()).staffId, 91602);
  await page.getByRole('button', { name: retry }).click();
  await expect(page.getByText(messages.booking.staff.empty, { exact: true })).toBeVisible();
  await expect(any).toBeChecked();
  await expect(summary).toContainText(messages.booking.staff.any);
  assert.equal((await draft()).datetime, null);
  assert.equal((await draft()).wantTime, null);

  await page.goto(`${booking}?step=3&service=91299&staff=91602&utm_source=fixture#st2`);
  await expect(page).toHaveURL(`${booking}?step=2&utm_source=fixture#st2`);
  await expect(page.locator('input[name="service"]:checked')).toHaveCount(0);
}

async function checkAvailability(page, booking, messages) {
  const { next, back, retry } = messages.common.actions;
  const { time } = messages.booking;
  const button = (name) => page.getByRole('button', { name, exact: true });
  const availableDays = page.locator('.dates button[data-available]');
  const draft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')));
  const first = '2026-11-30';
  const second = '2026-12-01';
  const later = '2026-12-20';
  const midnight = '2026-11-30T23:20:00.123+03:00';
  const datesUrl = (url) => url.pathname === '/api/booking/dates';
  const timesUrl = (day) => (url) => url.pathname === '/api/booking/times' && url.searchParams.get('date') === day;
  const fail = (route) => route.fulfill({ status: 503, json: { error: { code: 'CATALOG_UNAVAILABLE' } } });

  await page.clock.setFixedTime(new Date('2026-11-15T00:00:00Z'));
  await page.route(datesUrl, fail, { times: 1 });
  await page.goto(`${booking}?step=3&service=${sports}`);
  await expect(page.locator('input[name="staff"][value="0"]')).toBeChecked();
  await button(next).click();
  await expect(page.locator('#st4')).toBeVisible();
  await expect(page.locator('.booking-error')).toBeVisible();
  await button(retry).click();
  await expect(availableDays).toHaveCount(2);
  await expect(page.locator('.dates button')).toHaveCount(30);
  await expect(availableDays.nth(1).locator('small')).toBeVisible();

  let pending = false;
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  await page.route(timesUrl(first), async (route) => {
    try {
      const response = await route.fetch();
      pending = true;
      await release.promise;
      await route.fulfill({ response }).catch(() => {});
    } finally {
      finished.resolve();
    }
  }, { times: 1 });
  try {
    await availableDays.first().click();
    await expect(page.getByText(time.searching, { exact: true })).toBeVisible();
    await expect.poll(() => pending).toBe(true);
    await availableDays.nth(1).click();
    await expect(button('00:20')).toBeVisible();
    release.resolve();
    await finished.promise;
    await expect(button('09:30')).toHaveCount(0);
  } finally {
    release.resolve();
  }

  await button('00:20').click();
  await expect(page.locator('.bk-picked')).toContainText('00:20');
  assert.equal((await draft()).date, second);
  assert.equal((await draft()).datetime, midnight);
  await expect(button(next)).toBeEnabled();
  await page.reload();
  await expect(button('00:20')).toHaveAttribute('aria-pressed', 'true');

  await page.route(timesUrl(second), fail, { times: 1 });
  await page.reload();
  await expect(page.locator('.booking-error')).toBeVisible();
  await expect(page.locator('.bk-picked')).toHaveCount(0);
  assert.equal((await draft()).datetime, midnight);
  await page.route(timesUrl(second), async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.data.times = [];
    await route.fulfill({ response, json });
  }, { times: 1 });
  await button(retry).click();
  await expect(page.getByText(time.noTimes, { exact: true })).toBeVisible();
  await expect.poll(async () => (await draft()).datetime).toBeNull();
  await expect(availableDays.nth(1)).toHaveAttribute('aria-pressed', 'true');

  await button(back).click();
  await page.locator('input[name="staff"][value="91601"]').check();
  await button(next).click();
  await expect(availableDays).toHaveCount(1);
  await expect(page.locator('.dates button[aria-pressed="true"]')).toHaveCount(0);
  assert.equal((await draft()).date, null);

  await page.goto(`${booking}?step=4&service=${sports}&staff=91602&date=${second}&time=00:20&utm_source=fixture#st4`);
  await expect(page).toHaveURL(`${booking}?step=4&utm_source=fixture#st4`);
  await expect(button('00:20')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await draft()).datetime).toBe(midnight);
  await expect(page.locator('#st6, #st7')).toHaveCount(0);

  await page.goto(`${booking}?step=4&service=${sports}&staff=91602&date=${second}&time=12:00`);
  await expect(page.getByTestId('slot-unfit')).toBeVisible();
  await expect(button('00:20')).toHaveAttribute('aria-pressed', 'false');

  await page.route(datesUrl, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.data.dates.push(later);
    await route.fulfill({ response, json });
  }, { times: 1 });
  await page.reload();
  await expect(page.locator('.dates button')).toHaveCount(36);
  await expect(availableDays.last()).toHaveText('20');

  await page.goto(`${booking}?step=4&service=91204`);
  await expect(page.getByText(time.noDates, { exact: true })).toBeVisible();
}

async function checkContacts(page, booking, messages) {
  const { contacts } = messages.booking;
  const save = page.getByRole('button', { name: contacts.next, exact: true });
  await page.goto(booking);
  const savedAt = await page.evaluate(() => {
    sessionStorage.removeItem('bm.bookingSteps');
    const savedAt = Date.now() - 60_000;
    sessionStorage.setItem('bm.bookingDraft', JSON.stringify({
      v: 1, model: 'female', savedAt, generalNote: 'a'.repeat(900),
      markers: [{ id: 'legacy-marker', zoneId: 'knee_l', position: [0, 0, 0], note: 'a'.repeat(199) + '😀' + 'b'.repeat(50) }],
    }));
    return savedAt;
  });
  await page.reload();
  const marker = page.getByTestId('b3d-marker');
  const markerNote = marker.locator('textarea');
  const generalNote = page.locator('.b3d-general textarea');
  await expect(markerNote).toHaveAttribute('maxlength', '200');
  await expect(markerNote).toHaveValue('a'.repeat(199));
  await expect(generalNote).toHaveAttribute('maxlength', '400');
  await expect(generalNote).toHaveValue('a'.repeat(400));
  await expect(marker.locator('[role="radio"][aria-checked="true"]')).toHaveText('5');
  await expect(marker.locator('.b3d-count')).toContainText('200');
  await expect(page.locator('.b3d-general .b3d-count')).toContainText('400');
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingDraft')).savedAt), savedAt);

  await page.goto(`${booking}?step=5&service=${sports}`);
  await expect(page).toHaveURL(`${booking}?step=4`);
  await page.goto(`${booking}?step=7&service=${sports}&staff=91602&date=2026-12-01&time=00:20`);
  await expect(page).toHaveURL(`${booking}?step=5`);
  await expect(page.locator('form.bk-form input[type="checkbox"]')).toHaveCount(1);
  await expect(page.locator('#c-email')).toHaveAttribute('required', '');
  const phone = page.locator('#c-phone');
  await checkPhoneField(phone, { copy: messages.forms, submit: () => save.click() });
  await phone.fill('');
  await save.click();
  await expect(page.locator('#c-name')).toBeFocused();
  for (const id of ['name', 'phone', 'email', 'consent']) {
    await expect(page.locator(`#c-${id}`)).toHaveAttribute('aria-invalid', 'true');
  }
  await page.locator('#c-name').fill('  Fixture visitor  ');
  const number = booking.includes('/ru/') ? '+971 50 123-45-67' : '+44 20 7946-0958';
  await phone.fill(number);
  await page.locator('#c-email').fill('invalid');
  await page.locator('#c-consent').check();
  await save.click();
  await expect(page.locator('#c-email')).toBeFocused();
  await page.locator('#c-email').fill('fixture@example.test');
  await save.click();
  await expect(page).toHaveURL(`${booking}?step=6`);
  await expect(page.getByRole('button', { name: messages.booking.review.confirm })).toBeEnabled();
  await expect(page.getByTestId('captcha')).toHaveAttribute('hidden', '');
  await expect(page.getByTestId('captcha')).toBeHidden();
  await expect(page.locator('#st7')).toHaveCount(0);
  await page.getByRole('button', { name: messages.common.actions.back, exact: true }).click();
  await expect(page).toHaveURL(`${booking}?step=5`);
  await page.reload();
  await expect(page.locator('#c-name')).toHaveValue('Fixture visitor');
  await expect(phone).toHaveValue(number.replace(/[ -]/g, ''));
  await expect(page.locator('#c-age')).toHaveValue('');
  await expect(page.locator('#c-consent')).toBeChecked();
}

try {
  await fs.writeFile(scenarioFile, 'service-detail');
  await fs.writeFile(staffFixture, 'success');
  await fs.writeFile(availabilityFixture, 'success');
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-3d-apis'] });
  await withProductionServer(async (origin, logs) => {
    try {
      for (const [locale, width] of [['ru', 390], ['en', 1280]]) {
        const messages = JSON.parse(await fs.readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
        const entryPage = await browser.newPage({ viewport: { width, height: 850 } });
        try {
          await checkServiceEntry(entryPage, origin, locale, messages);
          console.log(`Service detail to 3D booking: preset, draft, clean URL and missing service passed in ${locale.toUpperCase()}`);
        } finally {
          await entryPage.close();
        }
        const page = await browser.newPage({ viewport: { width, height: 850 }, timezoneId: 'America/Los_Angeles' });
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
          if (url.pathname.startsWith('/api/booking/') || url.hostname === 'api.alteg.io') {
            requests.push([request.method(), url.pathname, url.searchParams.get('locale')]);
          }
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
          await expect(page.getByRole('button', { name: messages.common.actions.next })).toBeEnabled();
          await page.goto(`${booking}?step=2&service=102&staff=201&date=2026-11-30&time=12:00&utm_source=fixture#st2`);
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
          scenario = 'ready';
          await checkStaff(page, booking, messages);
          assert.ok(requests.length > 0);
          assert.ok(requests.every(([method, pathname, lang]) => method === 'GET' && pathname === '/api/booking/staff' && lang === locale));
          await checkAvailability(page, booking, messages);
          await checkContacts(page, booking, messages);
          assert.ok(requests.some(([, pathname]) => pathname === '/api/booking/dates'));
          assert.ok(requests.some(([, pathname]) => pathname === '/api/booking/times'));
          assert.ok(requests.every(([method, pathname, lang]) => method === 'GET' &&
            ['staff', 'dates', 'times'].some((resource) => pathname === `/api/booking/${resource}`) && lang === locale));
        } finally {
          release.resolve();
          await page.close();
        }
      }
      assert.match(logs(), /\[catalog-fixture\] service-detail ru-RU/);
      assert.match(logs(), /\[catalog-fixture\] service-detail en-US/);
      assert.match(logs(), /\[service-staff-fixture\] success ru-RU 13982355/);
      assert.match(logs(), /\[service-staff-fixture\] success en-US 13982355/);
      console.log('3D booking: services, availability, contacts, legacy note limits and staged boundary passed in RU and EN');
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheKeys.add(key);
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    ALTEGIO_CURRENCY: 'AED',
    CATALOG_TEST_SCENARIO: scenarioFile,
    SERVICE_STAFF_TEST_SCENARIO: staffFixture,
    AVAILABILITY_TEST_SCENARIO: availabilityFixture,
  } });
} finally {
  await browser?.close();
  await fs.unlink(scenarioFile).catch(() => {});
  await fs.unlink(staffFixture).catch(() => {});
  await fs.unlink(availabilityFixture).catch(() => {});
  await fs.rmdir(dir);
  for (const key of cacheKeys) await fs.unlink(path.join('.next', 'cache', 'fetch-cache', key)).catch(() => {});
}
