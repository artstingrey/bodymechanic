/**
 * In-app browsers (ads open in them): Instagram and Facebook on iOS (WKWebView) and Android (WebView) — the app's bar takes
 * ~100 px (e2e/devices.ts IN_APP). /ru/ and /ru/booking/ work, the main call to action is reachable, wa.me and tel: links
 * are well-formed (they leave the app for WhatsApp / the dialer). Run with `npm run test:matrix`.
 */
import { test, expect } from '@playwright/test';
import ru from '../messages/ru.json';
import { guard, expectClean, seedConsent } from './helpers';

test('/ru/: hero CTA in the first screen, no horizontal scroll, contact links well-formed', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/ru/', { waitUntil: 'networkidle' });
  const cta = page.locator('[data-track="body_open"]');
  const b = (await cta.boundingBox())!;
  expect(b.y + b.height, '«Начать» within the first screen').toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const href of await page.locator('a[href^="https://wa.me"], a[href^="tel:"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) {
    expect(href).toMatch(/^(https:\/\/wa\.me\/\d*\?text=[^\s]*|tel:\+\d{7,15})$/);
  }
  expectClean(await g.problems(), 'in-app home');
});

test('/ru/booking/: the model or the 2D scheme, the «Оформить запись» action reachable, a zone can be marked', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
  await expect(page.locator('.b3d-slot[data-mode="booking"]')).toBeVisible();
  await page.locator('#zone-list input[type="checkbox"]').first().check();
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  const cta = page.getByRole('button', { name: ru.body3d.panel.cta }).first();
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeVisible();
  await cta.click();
  await page.waitForURL(/step=2/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expectClean(await g.problems(), 'in-app booking');
});
