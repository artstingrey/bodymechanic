import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import en from '../messages/en.json' with { type: 'json' };
import ru from '../messages/ru.json' with { type: 'json' };
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-lp-booking-'));
const scenarioFile = path.join(dir, 'scenario');
const journal = `${scenarioFile}.journal`;
const comments = `${scenarioFile}.comments`;
const preload = new URL('../e2e/fixtures/altegio-record.mjs', import.meta.url).href;
const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const datetime = `${date}T14:20:00+04:00`;
const calls = async (operation) => (await fs.readFile(journal, 'utf8')).split('\n').filter((line) => line === operation).length;
const contact = { fullname: 'fixture-private-fullname', phone: '+971501234567', email: 'visitor@example.test' };
const invalidPhone = '+80612345678';
const condition = 'Fixture notes about the visit';
const lang = { ru, en };

async function run(scenario, check) {
  await fs.writeFile(scenarioFile, scenario);
  await fs.writeFile(journal, '');
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin);
    } catch (error) {
      console.error(await fs.readFile(journal, 'utf8'));
      throw error;
    }
    assert.doesNotMatch(logs(), /fixture-partner-token|fixture-private-fullname|501234567|fixture-record-hash-secret|visitor@example\.test/);
  }, { preload, env: (origin) => ({
    BOOKING_ORIGIN: origin, BOOKING_CLIENT_IP_HEADER: '',
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)), ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    RECORD_FIXTURE_DATE: date, RECORD_FIXTURE_DATETIME: datetime, RECORD_FIXTURE_SCENARIO: scenarioFile,
  }) });
}

async function openForm(browser, origin, locale, id) {
  const page = await browser.newPage({ viewport: { width: id === 'lp-f2' ? 1280 : 320, height: 850 },
    timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
  await page.route((url) => url.origin !== origin, (route) => route.fulfill({ body: '' }));
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({
    necessary: true, analytics: true, marketing: false, at: 'test',
  })));
  const lookups = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname.startsWith('/api/booking/')) lookups.push(url);
  });
  const copy = lang[locale];
  const form = page.locator(`#${id}`);
  await page.goto(`${origin}/${locale}/lp/a/?utm_source=meta&utm_medium=paid&utm_campaign=lp_a_sports${id === 'lp-fs' ? '&form=sheet' : ''}`);
  if (id === 'lp-fs') await page.locator('.lp-hero-cta button').click();
  const wa = form.getByRole('link', { name: copy.lp.form.whatsapp });
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/971585172380\?text=/);
  assert.equal(new URL(await wa.getAttribute('href')).searchParams.get('text'), `${copy.lp.a.wa.message} [LP-A]`);
  await form.locator('input[name="name"]').fill(contact.fullname);
  await form.locator('input[type="tel"]').fill(contact.phone);
  return { page, form, copy, lookups };
}

async function choose(browser, origin, locale, id, { serviceId = 13982355, marks = false, result = 'created' } = {}) {
  const { page, form, copy, lookups } = await openForm(browser, origin, locale, id);
  try {
    const before = await calls('POST book_record');
    const open = form.getByRole('button', { name: copy.lp.booking.selectService });
    await expect(form.locator('summary, textarea, input[name="consent"]')).toHaveCount(0);
    const phone = form.locator('input[name="phone"]');
    const email = form.locator('input[name="email"]');
    const emailLayout = await email.evaluate((input) => {
      const fields = input.closest('.fields');
      const field = input.getBoundingClientRect();
      return field.width === fields.getBoundingClientRect().width &&
        field.top > fields.querySelector('input[type="tel"]').getBoundingClientRect().bottom;
    });
    assert.equal(emailLayout, true);
    await open.click();
    await expect(email).toBeFocused();
    await expect(form.locator(`#${id}-email-err`)).toHaveText(copy.forms.error.required);
    await email.fill('bad-email');
    await open.click();
    await expect(form.locator(`#${id}-email-err`)).toHaveText(copy.forms.error.emailInvalid);
    await email.fill(contact.email);
    await phone.fill(invalidPhone);
    await open.click();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toBeFocused();
    assert.equal(lookups.length, 0);
    await phone.fill(contact.phone);
    await open.click();
    await expect(form.getByRole('heading', { name: copy.booking.service.heading })).toBeFocused();
    const advance = form.getByRole('button', { name: copy.lp.form.submit });
    await expect(advance).toBeDisabled();
    const service = form.locator(`.bk-opt input[value="${serviceId}"]`);
    await expect(form.locator('.bk-opt input[value="13982355"]')).toHaveCount(1);
    await expect(form.locator('.bk-opt input[value="91201"]')).toHaveCount(1);
    const grid = await form.locator('.bk-list').evaluate((list) => {
      const [first, second] = Array.from(list.children, (card) => card.getBoundingClientRect());
      return { twoColumns: first.top === second.top && first.right < second.left,
        oneColumn: first.left === second.left && first.bottom < second.top,
        fits: list.scrollWidth <= list.clientWidth };
    });
    const desktop = page.viewportSize().width >= 768;
    assert.deepEqual(grid, { twoColumns: desktop, oneColumn: !desktop, fits: true });
    await service.check();
    const serviceTitle = await service.locator('xpath=..').locator('.bk-opt__body b').innerText();
    if (marks) {
      await form.getByRole('button', { name: copy.common.actions.back, exact: true }).click();
      await expect(form.locator('input[name="name"]')).toHaveValue(contact.fullname);
      await expect(email).toHaveValue(contact.email);
      await open.click();
      await expect(service).toBeChecked();
    }
    await advance.click();
    await expect(form.getByRole('heading', { name: copy.booking.time.heading })).toBeVisible();
    await expect(form.locator('select, input[name="staff"], input[name="email"], summary, textarea')).toHaveCount(0);
    const next = form.getByRole('button', { name: copy.lp.booking.continue });
    await expect(next).toBeDisabled();
    const day = form.locator('.cal button[data-available]');
    await expect(day).toHaveCount(1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await day.click();
    const time = form.getByRole('button', { name: '14:20', exact: true });
    await expect(time).toBeVisible();
    await time.click();
    await expect(next).toBeEnabled();
    assert.equal(await calls('POST book_record'), before);
    await next.click();
    await expect(form.getByRole('heading', { name: copy.lp.booking.detailsHeading })).toBeFocused();
    await expect(form.locator('input[name="detailsConsent"], input[name="email"]')).toHaveCount(0);
    const consent = form.locator('input[name="consent"]');
    await expect(form.locator('a[href*="/privacy"]')).toHaveAttribute('href', new RegExp(`/${locale}/privacy/?$`));
    const submit = form.getByRole('button', { name: copy.lp.booking.book });
    if (marks) {
      await form.locator('textarea[name="condition"]').fill(condition);
      await form.locator('summary').click();
      await form.locator('.chip').first().click();
      await form.locator('.chip').nth(2).click();
      await form.getByRole('button', { name: copy.common.actions.back, exact: true }).click();
      await expect(next).toBeEnabled();
      await next.click();
      await expect(form.locator('textarea[name="condition"]')).toHaveValue(condition);
    }
    await submit.click();
    await expect(consent).toBeFocused();
    await expect(consent).toHaveAttribute('aria-invalid', 'true');
    assert.equal(await calls('POST book_record'), before);
    await consent.check();
    const response = page.waitForResponse((r) => r.url().endsWith('/api/booking/record'));
    await submit.click();
    const submitted = await response;
    const body = submitted.request().postDataJSON();
    assert.deepEqual([body.source, body.serviceId, body.staffId, body.datetime, body.contact, body.consent], ['lp', serviceId, 0, datetime, contact, true]);
    assert.deepEqual(body.details, marks ? ['recovery', 'neckShoulders'] : undefined);
    assert.equal(body.condition, marks ? condition : undefined);
    assert.deepEqual(lookups.slice(0, 2).map((url) => [url.pathname, url.searchParams.get('staffId'), url.searchParams.get('serviceId')]), [
      ['/api/booking/dates', '0', String(serviceId)], ['/api/booking/times', '0', String(serviceId)],
    ]);
    if (result === 'created') {
      assert.equal(submitted.status(), 201);
      await expect(form.getByRole('heading', { name: copy.lp.booking.confirmed })).toBeVisible();
      await expect(form.locator('.lp-thanks')).toBeFocused();
      await expect(form.locator('.lp-thanks__icon svg')).toBeVisible();
      await expect(form.locator('.lp-thanks .sub')).toContainText('14:20');
      await expect(form.locator('.lp-thanks .sub')).toContainText(serviceTitle);
    } else if (result === 'invalid-phone') {
      assert.equal(submitted.status(), 422);
      await expect(phone).toBeFocused();
      await expect(phone).toHaveAttribute('aria-invalid', 'true');
      await expect(form.locator('.lp-thanks')).toHaveCount(0);
    } else {
      const feedback = result === 'conflict' ? 'slotTaken' : 'unknown';
      await expect(form.getByRole('alert')).toHaveText(copy.home.form.feedback[feedback]);
      await expect(form.locator('.lp-thanks')).toHaveCount(0);
      if (result === 'conflict') await expect(time).toHaveCount(0);
      else await expect(submit).toBeDisabled();
    }
    const events = await page.evaluate(() => (window.dataLayer ?? []).filter((event) => event.event === 'lp_lead'));
    assert.equal(events.length, result === 'created' ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(events), /fixture-private-fullname|501234567|neckShoulders/);
  } finally {
    await page.close();
  }
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  await run('lp-live', async (origin) => {
    const valid = { source: 'lp', serviceId: 13982355, staffId: 0, datetime, contact, locale: 'ru', consent: true };
    for (const [changes, field] of [[{ staffId: 91601 }, 'staffId'], [{ serviceId: 0 }, 'serviceId'], [{ consent: false }, 'consent'],
      [{ details: ['unsupported-mark'] }, 'details'], [{ condition: 'x'.repeat(1001) }, 'condition'],
      [{ contact: { ...contact, phone: invalidPhone } }, 'phone'], [{ contact: { ...contact, email: undefined } }, 'email'],
      [{ contact: { ...contact, email: 'bad-email' } }, 'email']]) {
      const response = await fetch(`${origin}/api/booking/record`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ ...valid, ...changes, idempotencyKey: randomUUID() }),
      });
      assert.equal(response.status, 400);
      assert.ok((await response.json()).error.fields.includes(field));
    }
    await choose(browser, origin, 'ru', 'lp-f1', { marks: true });
    await choose(browser, origin, 'en', 'lp-f2', { serviceId: 91201 });
    await choose(browser, origin, 'en', 'lp-fs', { marks: true });
    assert.equal(await calls('POST book_check'), 3);
    assert.equal(await calls('POST book_record'), 3);
    const written = (await fs.readFile(comments, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(written.every((comment) => comment.startsWith('[Сайт/LP]') && comment.includes('meta / paid / lp_a_sports')));
    assert.ok(written[0].includes(ru.lp.chips.recovery) && written[0].includes(ru.lp.chips.neckShoulders));
    assert.ok(written[2].includes(en.lp.chips.recovery) && written[2].includes(en.lp.chips.neckShoulders));
    assert.ok(written[0].includes(condition) && written[2].includes(condition));
    assert.doesNotMatch(written[1], /Recovery|Neck/);
  });
  await run('lp-conflict', async (origin) => {
    await choose(browser, origin, 'ru', 'lp-f1', { result: 'conflict' });
    assert.equal(await calls('POST book_record'), 0);
  });
  await run('lp-unknown', async (origin) => {
    await choose(browser, origin, 'en', 'lp-f1', { result: 'unknown' });
    assert.equal(await calls('POST book_record'), 1);
  });
  await run('lp-invalid-phone', async (origin) => {
    await choose(browser, origin, 'ru', 'lp-f1', { result: 'invalid-phone' });
    assert.equal(await calls('POST book_record'), 1);
  });
  console.log('Landing booking: RU/EN hero, final and sheet, service choice, any staff, consent, conflict and unknown result: OK');
} finally {
  await browser?.close();
  await fs.rm(dir, { recursive: true, force: true });
}
