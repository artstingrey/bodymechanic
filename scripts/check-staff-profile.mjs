import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { withProductionServer } from './check-server.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'bm-staff-profile-'));
const fixture = path.join(dir, 'profile');
const preload = new URL('../e2e/fixtures/altegio-staff-profile.mjs', import.meta.url).href;
const defaultNow = '2026-11-15T12:00:00Z';
const settings = (slots = 'mixed', now = defaultNow, catalog = 'ready') => writeFile(fixture, JSON.stringify({ catalog, slots, now }));
const profile = (locale, slug = 'staff-91601') => `/${locale}/team/${slug}/`;
const api = (locale, staffId = 91601) => `/api/booking/staff-today?staffId=${staffId}&locale=${locale}`;

let browser;
try {
  await settings('empty', defaultNow, 'failed');
  browser = await chromium.launch({ channel: 'chrome' });
  await withProductionServer(async (origin, logs) => {
    // Exercise a failed cold catalog before the failure can be covered by a cached successful result.
    for (const locale of ['ru', 'en']) {
      const copy = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
      const page = await browser.newPage();
      try {
        const failed = await page.goto(origin + profile(locale), { waitUntil: 'load' });
        assert.equal(failed.status(), 200, logs());
        await expect(page.getByRole('alert').filter({ hasText: copy.team.profile.unavailable })).toBeVisible();
        await expect(page.getByRole('link', { name: copy.common.actions.retry, exact: true })).toHaveAttribute('href', profile(locale));
        await expect(page.locator('.profile__slots')).toHaveCount(0);
      } finally {
        await page.close();
      }
    }

    await settings();
    for (const [locale, width, name, position, specialization] of [
      ['ru', 390, 'Анна Пример', 'Специалист студии', 'Спортивный массаж'],
      ['en', 1280, 'Anna Example', 'Studio specialist', 'Sports massage'],
    ]) {
      const alt = locale === 'ru' ? 'en' : 'ru';
      const copy = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
      const response = await fetch(origin + profile(locale).slice(0, -1) + '?ref=fixture', { redirect: 'manual' });
      assert.equal(response.status, 308);
      assert.equal(new URL(response.headers.get('location'), origin).pathname, profile(locale));
      assert.equal(new URL(response.headers.get('location'), origin).search, '?ref=fixture');
      for (const slug of ['staff-91604', 'staff-91605', 'staff-99999', 'staff-091601', 'staff-91601%0A']) {
        const missing = await fetch(origin + profile(locale, slug));
        assert.equal(missing.status, 404, slug);
        assert.match(await missing.text(), /container page nf/);
      }
      const page = await browser.newPage({ viewport: { width, height: 820 }, timezoneId: 'America/Los_Angeles' });
      try {
        await page.route('https://images.example.test/**', (route) => {
          assert.equal(route.request().headers().referer, undefined);
          return route.request().url().endsWith('broken.webp') ? route.fulfill({ status: 404 })
            : route.fulfill({ path: 'public/photos/services/classic-640.webp', contentType: 'image/webp' });
        });
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/booking/staff-today?*', async (route) => { await held; await route.continue(); }, { times: 1 });
        try {
          const entry = await page.goto(origin + profile(locale));
          assert.equal(entry.status(), 200);
          await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
          await expect(page.locator('.profile__slots [role="status"]')).toHaveText(copy.a11y.loading);
          await expect(page.locator('.profile .eyebrow')).toHaveText(position);
          await expect(page.locator('.profile .hero-lead')).toContainText(specialization);
          await expect(page.locator('.profile .crumbs [aria-current="page"]')).toHaveText(name);
          await expect(page.locator(`.profile .crumbs a[href="/${locale}/team/"]`)).toBeVisible();
          await expect(page).toHaveTitle(`${name}, ${position} · The Body Mechanic`);
          await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', `${name}, ${position} · ${specialization}`);
          for (const [selector, lang] of [['rel="canonical"', locale], [`hreflang="${alt}"`, alt]]) {
            assert.equal(new URL(await page.locator(`link[${selector}]`).getAttribute('href')).pathname, profile(lang));
          }
          const jsonLd = (await page.locator('main script[type="application/ld+json"]').allTextContents()).map(JSON.parse);
          const person = jsonLd.find((entry) => entry['@type'] === 'Person');
          assert.equal(person.name, name);
          assert.equal(person.jobTitle, position);
          assert.equal(person.knowsAbout, specialization);
          assert.equal(new URL(person.url).pathname, profile(locale));
          const trail = jsonLd.find((entry) => entry['@type'] === 'BreadcrumbList');
          assert.equal(trail.itemListElement.at(-1).name, name);
          assert.equal(new URL(trail.itemListElement.at(-1).item).pathname, profile(locale));
          assert.doesNotMatch(await entry.text(), /fixture raw staff detail|fixture-partner-token/);
          await expect.poll(() => page.getByRole('img', { name, exact: true }).evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
        } finally {
          release();
        }
        const windows = page.locator('.profile__slots time');
        await expect(windows).toHaveCount(4);
        for (const [i, time] of ['16:30', '16:45', '17:00', '17:30'].entries()) await expect(windows.nth(i)).toContainText(time);

        await page.getByRole('link', { name: new RegExp(`^${alt.toUpperCase()}\\.`) }).click();
        await expect(page).toHaveURL(origin + profile(alt));
        await expect(page.locator('html')).toHaveAttribute('lang', alt);

        await page.goto(origin + profile(locale, 'staff-91602'));
        await expect(page.getByRole('heading', { name: 'No Portrait', exact: true })).toBeVisible();
        await expect(page.locator('.profile__photo .ph')).toBeVisible();
        await expect(page.locator('.profile .eyebrow, .profile .hero-lead')).toHaveCount(0);
        await page.goto(origin + profile(locale, 'staff-91603'));
        await expect(page.locator('.profile__photo .ph')).toBeVisible();
        await expect(page.locator('.profile__photo img')).toHaveCount(0);

        for (const scenario of ['tomorrow', 'empty']) {
          await settings(scenario);
          await page.goto(origin + profile(locale));
          await expect(page.locator('.profile__slots [role="status"]')).toHaveText(copy.team.profile.slots.empty);
          await expect(windows).toHaveCount(0);
        }

        await settings('error');
        await page.reload();
        const slotAlert = page.locator('.profile__slots [role="alert"]');
        const retry = page.getByRole('button', { name: copy.common.actions.retry, exact: true });
        await expect(slotAlert).toHaveText(copy.team.profile.slots.error);
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        await settings('429');
        await retry.click();
        await expect(slotAlert).toHaveText(copy.team.profile.slots.rateLimited);
        await expect(retry).toBeDisabled();
        const limited = await page.request.get(origin + api(locale));
        assert.equal(limited.status(), 429);
        assert.match(limited.headers()['retry-after'], /^[12]$/);
        assert.equal(limited.headers()['cache-control'], 'no-store');
        const limitCalls = () => (logs().match(/book_staff_seances 429/g) ?? []).length;
        const limitedCount = limitCalls();
        await settings();
        await expect(retry).toBeEnabled();
        await retry.click();
        await expect(windows).toHaveCount(4);
        assert.equal(limitCalls(), limitedCount);

        await page.goto(origin + profile(locale, 'specialist-1'));
        await expect(page.locator('.page-head__badge')).toHaveText(copy.prototype.demoBadge);
        await expect(page.locator('.profile__text .btn-book')).toHaveAttribute('href', `/${locale}/booking/`);
        await expect(page.locator('.profile__slots a').first()).toHaveAttribute('href', `/${locale}/booking/?step=2`);
      } finally {
        await page.close();
      }
      console.log(`Staff profile and today's slots passed in ${locale.toUpperCase()}`);
    }

    for (const [instant, expected] of [
      ['2026-11-15T19:58:00Z', ['23:59']],
      ['2026-11-15T20:02:00Z', ['00:03']],
    ]) {
      await settings('boundary', instant);
      const day = await fetch(origin + api('en'));
      assert.equal(day.headers.get('cache-control'), 'no-store');
      assert.deepEqual((await day.json()).data.times.map(({ time }) => time), expected);
    }

    await settings('fallback');
    const alternate = await fetch(origin + api('en'));
    assert.deepEqual((await alternate.json()).data.times.map(({ time }) => time), ['16:15', '17:45']);
    assert.match(logs(), /book_services fallback en-US/);
    assert.equal((logs().match(/book_times fallback en-US/g) ?? []).length, 2);
    assert.equal((await fetch(origin + api('en', 91604))).status, 404);
    assert.equal((await fetch(origin + api('en', 0))).status, 400);
    assert.equal((await fetch(origin + api('en') + '&locale=ru')).status, 400);
    console.log('Dubai midnight, service fallback, no-store and input validation passed');
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)), ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
    ALTEGIO_CURRENCY: 'AED', STAFF_PROFILE_FIXTURE: fixture,
  } });
} finally {
  await browser?.close();
  await rm(fixture, { force: true });
  await rmdir(dir);
}
