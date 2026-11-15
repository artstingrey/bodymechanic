/**
 * Page matrix: every page × 2 locales × the width of the current project (5 projects = 390/768/1280/1920/2560).
 * Per page: document 200 by direct link, 0 HTTP ≥400 / failed requests, only the expected studio map on contacts, 0 console errors,
 * meta robots noindex,nofollow, viewport, html lang, one h1, no horizontal overflow, no dead links,
 * every internal link resolves (and its #anchor exists), DEL-09 screenshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { LOCALES, matrixPages, isShotPage, shotName, guard, settle3D, drawOffscreen3D, domChecks, internalLinks, expectClean, expectNoDemoLabels, seedConsent, stubStudioMap } from './helpers';
import { STUDIO, STUDIO_MAP } from '../src/lib/config';
import en from '../messages/en.json';
import ru from '../messages/ru.json';

const SHOTS = process.env.GATE_SHOTS !== '0';
const linkCache = new Map<string, string | null>(); // url → problem (null = ok), per worker

async function checkLink(request: APIRequestContext, href: string): Promise<string | null> {
  const u = new URL(href);
  const key = u.pathname + u.search + u.hash;
  if (linkCache.has(key)) return linkCache.get(key)!;
  let problem: string | null = null;
  const res = await request.get(u.pathname + u.search);
  if (res.status() !== 200) problem = `link → ${key}: HTTP ${res.status()}`;
  else if (u.hash) {
    const id = decodeURIComponent(u.hash.slice(1));
    if (!(await res.text()).includes(`id="${id}"`)) problem = `link → ${key}: anchor #${id} not found on the target page`;
  }
  linkCache.set(key, problem);
  return problem;
}

for (const locale of LOCALES) {
  test(`/${locale}/contacts/ loads the studio map immediately`, async ({ page }) => {
    const { contacts, footer } = locale === 'ru' ? ru : en;
    await stubStudioMap(page);
    await seedConsent(page);
    const request = page.waitForRequest(STUDIO_MAP.embedUrl);
    await page.goto(`/${locale}/contacts/`, { waitUntil: 'networkidle' });
    await request;

    const list = page.locator('.contacts__list');
    const contactColumn = page.locator('.site-footer__cols > div').filter({ has: page.getByRole('heading', { name: footer.col.contacts, exact: true }) });
    await expect(list.locator('dd').first()).toHaveText(STUDIO.streetAddress);
    await expect(contactColumn.getByText(STUDIO.streetAddress, { exact: true })).toBeVisible();
    await expect(contactColumn.getByRole('link', { name: footer.links.address })).toHaveAttribute('href', `/${locale}/contacts/`);
    await expect(page.getByRole('contentinfo').getByRole('link', { name: contacts.openMap })).toHaveCount(0);
    await expect(page.getByText(contacts.pending, { exact: true })).toHaveCount(0);

    const map = page.getByRole('figure', { name: contacts.mapLabel });
    const iframe = map.locator('iframe');
    const fallback = page.locator('main').getByRole('link', { name: contacts.openMap });
    await expect(fallback).toHaveAttribute('href', STUDIO_MAP.url);
    await expect(map.getByRole('button')).toHaveCount(0);
    await expect(iframe).toHaveAttribute('title', contacts.mapLabel);
    await expect(iframe).toHaveAttribute('src', STUDIO_MAP.embedUrl);
    await expect(iframe).toHaveAttribute('loading', 'eager');
    await expect(iframe).toHaveAttribute('allowfullscreen', '');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    await expect(iframe.contentFrame().getByText('HDS Tower', { exact: true })).toBeVisible();
    await expect(fallback).toBeVisible();

    const mapBox = (await map.boundingBox())!;
    const listBox = (await list.boundingBox())!;
    const viewportWidth = page.viewportSize()!.width;
    expect(await iframe.boundingBox()).toEqual(mapBox);
    expect(mapBox.width).toBeGreaterThan(0);
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(viewportWidth);
    if (viewportWidth < 1024) {
      expect(mapBox.x).toBe(listBox.x);
      expect(mapBox.width).toBe(listBox.width);
      expect(mapBox.y).toBeGreaterThan(listBox.y + listBox.height);
    } else {
      expect(mapBox.y).toBe(listBox.y);
      expect(mapBox.x).toBeGreaterThan(listBox.x + listBox.width);
    }
  });

  for (const p of matrixPages(locale)) {
    const url = `/${locale}/${p}`;
    test(`${url}`, async ({ page, baseURL }, info) => {
      // the cookie card is checked (and shot) on the home page of every width and language; elsewhere the choice is made
      // in advance, so the full-page DEL-09 shots show the content, not the card over it (Web Art Director)
      if (p !== '') await seedConsent(page);
      if (p === 'contacts/') await stubStudioMap(page);
      const g = guard(page, baseURL!);
      const res = await page.goto(url, { waitUntil: 'networkidle' });
      expect(res?.status(), `document status of ${url}`).toBe(200);
      await settle3D(page);
      await expectNoDemoLabels(page);

      const problems = [...(await domChecks(page, locale))];
      const here = new URL(page.url());
      for (const href of await internalLinks(page)) {
        const u = new URL(href);
        if (u.pathname === here.pathname && u.search === here.search && u.hash) {
          // same-page anchor: the target may be client-rendered (booking steps) → check the live DOM
          const id = decodeURIComponent(u.hash.slice(1));
          if (!(await page.evaluate((i) => !!document.getElementById(i), id))) problems.push(`anchor #${id} missing on the page`);
          continue;
        }
        const pr = await checkLink(page.request, href);
        if (pr) problems.push(pr);
      }

      if (SHOTS && isShotPage(p)) {
        const dir = path.join(__dirname, 'shots', info.project.name);
        fs.mkdirSync(dir, { recursive: true });
        await drawOffscreen3D(page);
        await page.screenshot({ path: path.join(dir, `${shotName(locale, p)}.jpg`), type: 'jpeg', quality: 72, fullPage: true });
      }
      await page.waitForTimeout(150); // let late requests (idle prefetch) report before the verdict
      if (g.warnings.length) info.annotations.push({ type: 'console.warning', description: [...new Set(g.warnings)].join(' | ') });
      expectClean([...problems, ...(await g.problems())], url);
    });
  }
}
