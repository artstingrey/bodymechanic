/**
 * Ad landing /[locale]/lp/[variant] (task 01a1b325) on the shared device matrix (e2e/devices.ts, README-CONTEXT «ВСЕ iPhone
 * И ВСЕ Android»: visible area, not the screen). Runs inside the device projects of playwright.config:
 *   level A (A-*, every gate run): all four pages — first screen, layout, fonts, meta, AA, denylist — and the scenarios;
 *   level B and in-app (B-*, inapp-*, npm run test:matrix): layout smoke on one page per language;
 *   text scale 130 / 200 % (page zoom) on A-pixel-7 and A-moto-g4.
 * First screen: the whole form button (iPhone from 375×629, Android from 360×732) OR the sticky CTA. No horizontal scroll;
 * targets ≥ 44 (chips 48; links inside a sentence excepted, WCAG 2.5.8); text ≥ 13. Level A also: 200, no console errors,
 * only the static LP fonts, one h1, noindex, hreflang ru/en/x-default, color-scheme «only light», AA 0, denylist banned +
 * landing_banned on the rendered text = 0; errors + summary, consent for the marks only with a chip, AA in the error and
 * thank-you states, double tap → one lead, server error keeps the input, ?form=sheet + «Назад» closes the sheet, sticky CTA
 * show / hide, the keyboard never covers the focused field.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import ru from '../messages/ru.json';
import en from '../messages/en.json';
import { testHook } from './helpers';

const PAGES = ['/ru/lp/a/', '/ru/lp/b/', '/en/lp/a/', '/en/lp/b/'];
// RC-9 (T-1): the list lives IN the repository (a copy of the deck's lexicon-denylist.json, kept by `npm run sync` and the
// drift check of `npm run i18n`). It used to be read from ../copy next to the app and the check was silently skipped where
// that folder does not exist — in a clean checkout and for anyone who clones the repository. A missing file now fails.
const LEX = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'lexicon-denylist.json'), 'utf8')) as { banned: string[]; landing_banned: string[] };
/** the banned patterns found in `s` (the deck's U+00A0 must not hide a phrase written with a space) */
const bannedIn = (s: string) => { const t = s.replace(/[  ]/g, ' ').toLowerCase(); return [...LEX.banned, ...LEX.landing_banned].filter((rx) => new RegExp(rx, 'iu').test(t)); };
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

function consoleGuard(page: Page) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });
  return errs;
}

/** WCAG contrast of every visible text node against its composited background (canvas-normalised colours). */
async function aaFails(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the CSS rise-in would leave below-the-fold text at opacity < 1 (skipped)
  return page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true })!;
    const rgba = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (t: number[], b: number[]) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3]), 1];
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const out: string[] = []; const seen = new Set<Element>();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode; if (!n.textContent?.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (el.closest('script,style,svg,[aria-hidden="true"],[hidden],.sr-only,dialog:not([open]),[disabled]')) continue;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (cs.visibility !== 'visible' || cs.display === 'none' || r.width < 1 || r.height < 1) continue;
      const layers: number[][] = []; let img = false; let op = 1;
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e); op *= +s.opacity;
        if (s.backgroundImage !== 'none') { img = true; break; }
        const b = rgba(s.backgroundColor); if (b[3] > 0) { layers.push(b); if (b[3] >= 1) break; }
      }
      if (img || op < 1) continue; // gradients / mid-animation: not measurable here
      let bg = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      const fg = over(rgba(cs.color), bg);
      const size = parseFloat(cs.fontSize); const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
      const a = lum(fg), b = lum(bg); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (cr < (large ? 3 : 4.5)) out.push(`${cr.toFixed(2)} «${n.textContent.trim().slice(0, 40)}»`);
    }
    return out;
  });
}

async function sizeProblems(page: Page) {
  return page.evaluate(() => {
    const p: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.lp a, .lp button, .lp summary, .lp input')) {
      const r = el.getBoundingClientRect(); if (!r.width || el.closest('[hidden], dialog:not([open])') || getComputedStyle(el).visibility !== 'visible') continue;
      if (el.matches('input[type="checkbox"]')) continue; // the box is 24 px, the label row is ≥ 44
      if (el.matches('a') && getComputedStyle(el).display === 'inline' && el.closest('p')) continue; // a link inside a sentence (WCAG 2.5.8 inline exception)
      const min = el.classList.contains('chip') ? 48 : 44;
      if (Math.round(r.height) < min || Math.round(r.width) < 44) p.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} «${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}»`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('.lp *')) {
      if (!el.childNodes.length || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) continue;
      const r = el.getBoundingClientRect(); if (!r.width || el.closest('[aria-hidden="true"], .sr-only, dialog:not([open])')) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 12.5) p.push(`text ${getComputedStyle(el).fontSize} «${el.textContent!.trim().slice(0, 30)}»`);
    }
    return p;
  });
}

/** iPhone from 375×629, Android from 360×732: the whole form button on the first screen with ≥ 8 px to spare (README-CONTEXT,
 *  RC-1: 375×629 ru/a ended 5 px below the screen); below — the sticky CTA. */
const FORM_BUTTON_SLACK = 8;
const FORM_BUTTON_FROM = { webkit: { width: 375, height: 629 }, chromium: { width: 360, height: 732 } } as const;
/** Android text scale = page zoom: the CSS viewport shrinks (Pixel 7 at 130 / 200 %, Moto G4 at 200 %). */
const TEXT_SCALE = [{ project: 'A-pixel-7', scale: 1.3 }, { project: 'A-pixel-7', scale: 2 }, { project: 'A-moto-g4', scale: 2 }];
const levelOf = (project: string) => (project.startsWith('A-') ? 'A' : 'B'); // B-* and inapp-* = layout smoke
const SMOKE_PAGES = ['/ru/lp/a/', '/en/lp/b/'];

test.use({ reducedMotion: 'reduce' }); // deterministic sticky bar and rise-in

/** Whole form button / sticky CTA on the first screen (after the IntersectionObserver's first callback). */
async function firstScreen(page: Page) {
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const b = document.querySelector('#lp-f1 button[type="submit"]')!.getBoundingClientRect();
    const s = document.querySelector('.lp-sticky')!; const r = s.getBoundingClientRect();
    const shown = s.hasAttribute('data-show') && getComputedStyle(s).display !== 'none' && r.top >= 0 && r.bottom <= innerHeight + 0.5;
    const f = document.querySelector('#lp-f1 input:not([type="hidden"])')?.getBoundingClientRect(); // «Имя»
    return {
      button: b.top >= 0 && b.bottom <= innerHeight + 0.5,
      slack: innerHeight - b.bottom,
      field: !!f && f.width > 0 && f.top >= 0 && f.bottom <= innerHeight + 0.5 && !(shown && f.bottom > r.top),
      sticky: shown,
      at: `button ${Math.round(b.top)}–${Math.round(b.bottom)} in ${innerWidth}×${innerHeight} (spare ${Math.round(innerHeight - b.bottom)} px)`,
    };
  });
}

/** First screen, overflow, targets, text; on level A also fonts, meta, AA, denylist. */
async function checkPage(page: Page, url: string, engine: 'webkit' | 'chromium' | 'firefox', full: boolean) {
  const errs = consoleGuard(page);
  const fonts: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'font' || /\.woff2(\?|$)/.test(r.url())) fonts.push(new URL(r.url()).pathname.split('/').pop()!); });
  const res = await page.goto(url, { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  const vp = page.viewportSize()!;
  const from = FORM_BUTTON_FROM[engine === 'webkit' ? 'webkit' : 'chromium'];
  const fs = await firstScreen(page);
  if (vp.width >= from.width && vp.height >= from.height) expect(fs.button && fs.slack >= FORM_BUTTON_SLACK - 0.5, `the whole form button on the first screen, ≥ ${FORM_BUTTON_SLACK} px to spare: ${fs.at}`).toBe(true);
  // below: the whole button, OR the whole first field «Имя» (the form itself is the call to action), OR the sticky CTA —
  // lead's decision 07.11 (RC-2): the sticky CTA no longer lies over the form, so on 320×560 or at 200 % text it hides there
  else expect(fs.button || fs.field || fs.sticky, `the form button, its first field or the sticky CTA on the first screen: ${fs.at}`).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'horizontal scroll').toBeLessThanOrEqual(0);
  expect(await sizeProblems(page)).toEqual([]);
  // R-LP-03 M-01: at the very end the sticky bar (if shown) never covers the footer disclaimer
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const foot = await page.evaluate(() => {
    const s = document.querySelector('.lp-sticky')!; const shown = s.hasAttribute('data-show') && getComputedStyle(s).display !== 'none';
    const d = document.querySelector('.lp-foot > p:last-child')!.getBoundingClientRect();
    return { shown, barTop: Math.round(s.getBoundingClientRect().top), disclaimerBottom: Math.round(d.bottom) };
  });
  if (foot.shown) expect(foot.barTop, 'sticky bar over the footer disclaimer').toBeGreaterThanOrEqual(foot.disclaimerBottom);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (full) {
    // R-LP-03 F-02: while lp-config offer.status = example, the offer carries «Пример оффера» in the first screen and the final block
    expect(await page.locator('.lp-hero .ex').evaluateAll((els) => els.some((e) => e.getBoundingClientRect().width > 0)), 'example badge on the hero offer').toBe(true);
    await expect(page.locator('.lp-final .ex')).toHaveCount(1);
    // T-12: while requests go to the mock, «Демо» + one line next to the form
    await expect(page.locator('#lp-f1 .demo-note, .lp-hero-cta ~ dialog .demo-note').first()).toBeAttached();
    if (await page.locator('#lp-f1').isVisible()) await expect(page.locator('#lp-f1 .demo-note')).toBeVisible();
    // §6: only the landing's static Manrope instances, never the site's variable font (scripts/lp-postexport.mjs)
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((f) => !/^Manrope_[4-8]00[.-]/.test(f)), 'fonts other than the static LP instances').toEqual([]); // «Manrope_400.<hash>», «.p.» when preloaded, «-s» with next/font's fallback
    // RC-7 (A): the 4 static faces are preloaded with fetchpriority="low" (scripts/lp-postexport.mjs) — in the HTML as served
    const served = await (await page.request.get(url)).text();
    const pre = [...served.matchAll(/<link rel="preload" href="\/_next\/static\/media\/([^"]+\.woff2)"[^>]*>/g)];
    expect(pre.map((m) => m[1].slice(0, 11)).sort(), 'the landing font preloads').toEqual(['Manrope_400', 'Manrope_600', 'Manrope_700', 'Manrope_800']);
    expect(pre.filter((m) => !m[0].includes('fetchPriority="low"')).map((m) => m[1]), 'landing font preloads without fetchpriority="low"').toEqual([]);
    expect(await page.locator('h1').count()).toBe(1);
    expect(await page.locator('meta[name="robots"]').first().getAttribute('content')).toMatch(/noindex/);
    expect(await page.locator('meta[name="color-scheme"]').getAttribute('content')).toBe('only light'); // Samsung Internet forced dark
    expect(await page.locator('link[rel="alternate"][hreflang]').evaluateAll((ls) => ls.map((l) => l.getAttribute('hreflang')).sort())).toEqual(['en', 'ru', 'x-default']);
    expect(await aaFails(page)).toEqual([]);
    expect(bannedIn(await page.evaluate(() => document.body.innerText + ' ' + document.title)), 'banned words in the page text or title').toEqual([]);
    // RC-9 (C-1): the same rule for what a messenger shows as the link preview \u2014 the description, the Open Graph / Twitter
    // texts, the card's alt and its file name\u2026
    const meta = await page.evaluate(() => Object.fromEntries(['description', 'og:title', 'og:description', 'og:site_name', 'og:image', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']
      .map((k) => [k, document.querySelector(`meta[name="${k}"], meta[property="${k}"]`)?.getAttribute('content') ?? ''])));
    const decoded = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } }; // \u00AB20%\u00BB in a text is not an escape
    for (const [k, v] of Object.entries(meta)) expect(bannedIn(decoded(v)), `banned words in <meta ${k}> \u00AB${v}\u00BB`).toEqual([]);
    for (const k of ['description', 'og:title', 'og:description', 'og:image']) expect(meta[k], `<meta ${k}>`).not.toBe('');
    // \u2026and the card itself is the landing's own: the site card (og-template-*) has \u00AB\u2026\u041B\u0424\u041A \u0438 \u0440\u0435\u0430\u0431\u0438\u043B\u0438\u0442\u0430\u0446\u0438\u044F \u0432 \u0414\u0443\u0431\u0430\u0435\u00BB /
    // \u00AB\u2026exercise therapy and rehabilitation\u00BB drawn on it, which no text check can see
    const [, lang, variant] = /^\/(ru|en)\/lp\/(a|b)\/$/.exec(url)!;
    for (const k of ['og:image', 'twitter:image']) expect(new URL(meta[k]).pathname, `<meta ${k}>`).toBe(`/og/og-lp-${variant}-${lang}.png`);
    const card = await page.request.get(new URL(meta['og:image']).pathname);
    expect(card.status(), 'the landing card answers').toBe(200);
    expect(card.headers()['content-type'], 'the landing card is a PNG').toContain('image/png');
    const png = await card.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], 'the landing card is 1200\u00D7630').toEqual([1200, 630]);
    const siteCard = await page.request.get(`/og/og-template-${lang}.png`);
    expect(sha1(png), 'the landing card is not a copy of the site card').not.toBe(sha1(await siteCard.body()));
    // RC-9 (C-2): the tab title of version B says what its approved H1 says \u2014 \u00AB\u0417\u0430\u044F\u0432\u043A\u0430 \u0437\u0430 \u043C\u0438\u043D\u0443\u0442\u0443\u00BB / \u00ABRequest in a minute\u00BB
    // (it said \u00AB\u0437\u0430\u043F\u0438\u0441\u044C \u0437\u0430 \u043C\u0438\u043D\u0443\u0442\u0443\u00BB / \u00ABbook in a minute\u00BB: a request is not a booking)
    if (variant === 'b') {
      const plain = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ').toLowerCase();
      const h1 = plain((lang === 'ru' ? ru : en).lp.h1.b1);
      expect(plain(await page.title()), 'the title of /lp/b carries the last sentence of its H1').toContain(h1.slice(h1.lastIndexOf('. ') + 2));
    }
  }
  expect(errs).toEqual([]);
}

for (const url of PAGES) {
  test(`${url} first screen and layout (level A: + fonts, meta, AA, denylist)`, async ({ page, browserName }, ti) => {
    const A = levelOf(ti.project.name) === 'A';
    test.skip(!A && !SMOKE_PAGES.includes(url), 'level B / in-app: smoke on one page per language');
    await checkPage(page, url, browserName, A);
  });
}

/**
 * RC-7 (A), AD + HR: a repeat visit draws the landing in Manrope. With font-display: optional and no preload the cached faces
 * still missed the first frame and the visit stayed on the fallback (Chromium 390 Android: visits 2–3 on Manrope 0–1 of 3,
 * 86e41f6). The low-priority preloads (scripts/lp-postexport.mjs) are ready from the HTTP cache before the first frame.
 * Chromium (the drawing font comes from CDP CSS.getPlatformFontsForNode): 3 rounds × visits 2 and 3, 390 Android and 1280.
 */
test('a repeat visit draws the landing H1 in Manrope (fetchpriority="low" preloads, cache)', async ({ browser }, ti) => {
  test.skip(ti.project.name !== 'A-pixel-7', 'one Chromium project (CDP)');
  test.setTimeout(240_000);
  const bad: string[] = [];
  const windows = [{ label: '390 Android', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ti.project.use.userAgent } }, { label: '1280', opts: { viewport: { width: 1280, height: 800 } } }];
  for (const url of ['/ru/lp/a/', '/en/lp/b/']) for (const w of windows) for (let round = 0; round < 3; round++) {
    const ctx = await browser.newContext({ ...w.opts, baseURL: ti.project.use.baseURL });
    await ctx.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' })));
    for (let visit = 1; visit <= 3; visit++) {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(800);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const drawn = fonts.map((f) => f.familyName).join('+');
      if (visit > 1 && !/manrope/i.test(drawn)) bad.push(`${url} ${w.label} round ${round + 1} visit ${visit}: H1 drawn in ${drawn}`);
      await cdp.detach(); await page.close();
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

/**
 * RC-8: the top bar is a floating pill (logo + WhatsApp, no navigation: an ad page keeps visitors on the form) that costs the first
 * screen nothing it cannot afford — 4 + 48 px, then a gap of up to 16 px that follows the height on short phones (BD: 4 px read as
 * stuck to the photo; the form button keeps its 8 px, lp.spec first-screen test); 48 px in all on the in-app SE. It stays on screen while the page scrolls (≤ 500 px high it scrolls away: with the
 * sticky CTA it would take a third of the height). The logo is the plate copy: readable under a browser's force-dark.
 */
test('floating pill: costs the first screen nothing, stays on screen while scrolling, logo + WhatsApp only', async ({ page }, ti) => {
  test.skip(levelOf(ti.project.name) !== 'A', 'level A only');
  const vp = page.viewportSize()!;
  await page.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' })));
  await page.goto('/ru/lp/a/', { waitUntil: 'load' });
  const m = await page.evaluate(() => {
    const top = document.querySelector<HTMLElement>('.lp-top')!, r = top.getBoundingClientRect(), wa = top.querySelector('a')!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, mainTop: document.querySelector('main')!.getBoundingClientRect().top, links: top.querySelectorAll('a').length, nav: top.querySelectorAll('nav').length, logos: [...top.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? ''), radius: parseFloat(getComputedStyle(top).borderTopLeftRadius), waH: wa.height, waW: wa.width, sw: document.documentElement.scrollWidth - innerWidth };
  });
  if (vp.height <= 450) expect(m.mainTop, 'where the content starts on the in-app SE').toBeCloseTo(48, 0);
  else {
    expect(m.mainTop - m.bottom, 'the gap under the pill').toBeGreaterThanOrEqual(3.5);
    expect(m.mainTop - m.bottom, 'the gap under the pill').toBeLessThanOrEqual(16.5);
  }
  expect(m.top, 'the pill floats off the top edge').toBeGreaterThan(0);
  expect(m.left, 'the pill floats off the left edge').toBeGreaterThan(0);
  expect(vp.width - m.right, 'the pill floats off the right edge').toBeGreaterThan(0);
  expect(m.radius, 'a pill').toBeGreaterThanOrEqual(22);
  expect([m.links, m.nav], 'the WhatsApp button only, no navigation').toEqual([1, 0]);
  expect(m.logos.filter((src) => !src.endsWith('-plate.svg')), 'logos without the force-dark plate').toEqual([]);
  expect(Math.min(m.waH, m.waW), 'the WhatsApp target').toBeGreaterThanOrEqual(44);
  expect(m.sw, 'no horizontal scroll').toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(250);
  const y = await page.evaluate(() => document.querySelector('.lp-top')!.getBoundingClientRect().top);
  if (vp.height > 500) expect(y, 'the pill stays on screen while the page scrolls').toBeGreaterThanOrEqual(0);
  if (vp.height > 500) expect(y).toBeLessThanOrEqual(16);
  else expect(y, 'short screens: the pill scrolls away').toBeLessThan(0);
});

/** Air between a call-out plate and the other plates on the photo (RC-2: 2–7 px on Pixel 9 / Galaxy A / 375, lead: ≥ 8). */
const CALLOUT_AIR = 8;
/**
 * Hero call-out problems: a label leaving the photo (it clips them — RC-1: RU zone names cut by 55–122 px on every phone),
 * text spilling out of its plate, or less than CALLOUT_AIR px to the photo tag «Иллюстративное фото», the example badge,
 * the offer pill or another call-out.
 */
async function calloutProblems(page: Page) {
  return page.evaluate((air) => {
    const m = document.querySelector('.lp-hero .lp-media')!; const mb = m.getBoundingClientRect();
    if (!mb.width) return []; // ≤ 600 px high phones: no photo band
    const shown = (e: Element) => e.getBoundingClientRect().width > 0;
    const plates = [...m.querySelectorAll('.co > span')].filter(shown);
    const others = [...m.querySelectorAll('.tag, .ex--photo, .offer-pill')].filter(shown);
    const label = (e: Element) => e.classList.contains('tag') ? 'the photo tag' : e.classList.contains('ex--photo') ? 'the example badge'
      : e.classList.contains('offer-pill') ? 'the offer pill' : `«${e.textContent!.trim()}»`;
    // separation of two boxes: > 0 = the air between them on the axis where they are apart, ≤ 0 = they overlap
    const gap = (a: DOMRect, b: DOMRect) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
    return plates.flatMap((s, i) => {
      const b = s.getBoundingClientRect();
      const out = Math.max(mb.left - b.left, b.right - mb.right, mb.top - b.top, b.bottom - mb.bottom);
      const spill = s.scrollWidth - s.clientWidth; // a word longer than the plate (the plate wraps, a word cannot)
      const at = `${label(s)} in ${innerWidth}×${innerHeight}`;
      const close = [...others, ...plates.slice(i + 1)].map((o) => [label(o), gap(b, o.getBoundingClientRect())] as const).filter(([, d]) => d < air - 0.5);
      return [
        ...(out > 0.5 ? [`${at}: ${Math.ceil(out)} px outside the photo`] : []),
        ...(spill > 0 ? [`${at}: the text spills ${spill} px out of its plate`] : []),
        ...close.map(([o, d]) => `${at}: ${d < 0 ? `overlaps ${o} by ${Math.ceil(-d)} px` : `${Math.floor(d)} px to ${o}`} (< ${air})`),
      ];
    });
  }, CALLOUT_AIR);
}
/** tablets / desktops, checked once per engine (A-iphone-16 = WebKit, A-pixel-9 = Chrome) on top of the device's own size */
const CALLOUT_WIDE = [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];

test('hero call-outs: every label inside the photo, ≥ 8 px from the tag, the badges and each other (all four pages, every device of the LP matrix)', async ({ page }, ti) => {
  const sizes = [page.viewportSize()!, ...(['A-iphone-16', 'A-pixel-9'].includes(ti.project.name) ? CALLOUT_WIDE : [])];
  const bad: string[] = [];
  for (const url of PAGES) {
    await page.setViewportSize(sizes[0]);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    for (const s of sizes) {
      await page.setViewportSize(s);
      bad.push(...(await calloutProblems(page)).map((x) => `${url} ${x}`));
    }
  }
  expect(bad).toEqual([]);
});

for (const ts of TEXT_SCALE) {
  test.describe(`text scale ${ts.scale * 100} % (${ts.project})`, () => {
    // the project's own visible area divided by the zoom (Pixel 7 412×839 → 317×645 / 206×420, Moto G4 360×640 → 180×320)
    const base = { 'A-pixel-7': { width: 412, height: 839 }, 'A-moto-g4': { width: 360, height: 640 } }[ts.project]!;
    test.use({ viewport: { width: Math.round(base.width / ts.scale), height: Math.round(base.height / ts.scale) } });
    for (const url of SMOKE_PAGES) {
      test(`${url} no horizontal scroll, first screen, targets, text`, async ({ page, browserName }, ti) => {
        test.skip(ti.project.name !== ts.project, `runs on ${ts.project}`);
        await checkPage(page, url, browserName, false);
      });
    }
  });
}

test('form: errors + summary, consent for the marks only with a chip, AA in states, one lead per key, thank-you', async ({ page }, ti) => {
  test.skip(levelOf(ti.project.name) !== 'A', 'level A only');
  const errs = consoleGuard(page);
  await testHook(page); // RC-9: the count of accepted leads comes through the gate's sink (no debug global in the build)
  await page.goto('/ru/lp/a/', { waitUntil: 'networkidle' });
  const f = page.locator('#lp-f1');
  await f.locator('button[type="submit"]').click();
  await expect(f.locator('.form-errors[role="alert"]')).toBeVisible();
  await expect(f.locator('[aria-invalid="true"]')).toHaveCount(2);
  expect(await aaFails(page)).toEqual([]);
  await f.locator('input[name="name"]').fill('Анна');
  await f.locator('input[name="phone"]').fill('+971 50 123 4567');
  await f.locator('summary').click();
  await f.locator('.chip').first().click();
  await f.locator('button[type="submit"]').click();
  await expect(f.locator('input[name="detailsConsent"]')).toHaveAttribute('aria-invalid', 'true');
  await f.locator('.check').click();
  await f.locator('button[type="submit"]').dblclick(); // a double tap → still one lead
  await expect(page.locator('#lp-f1 .lp-thanks[role="status"]')).toBeVisible();
  await expect(page.locator('#lp-f1 .lp-thanks')).toBeFocused(); // R-LP-03 M-02 (WebKit: focus after the render)
  await expect(page.locator('#lp-f1 .lp-thanks .demo-note')).toBeVisible(); // T-12: the demo mark stays after «спасибо»
  expect(await page.evaluate(() => (window as unknown as { __lpLeads?: number }).__lpLeads)).toBe(1);
  expect(await aaFails(page)).toEqual([]);
  expect(errs).toEqual([]);
});

test('server error: an alert, the form stays filled', async ({ page }, ti) => {
  test.skip(levelOf(ti.project.name) !== 'A', 'level A only');
  await testHook(page); // ?mock= is the gate's only (RC-9, S-3)
  await page.goto('/en/lp/b/?mock=server', { waitUntil: 'networkidle' });
  const f = page.locator('#lp-f1');
  await f.locator('input[name="name"]').fill('Anna');
  await f.locator('input[name="phone"]').fill('+971 50 123 4567');
  await f.locator('button[type="submit"]').click();
  await expect(f.locator('.server-err[role="alert"]')).toBeVisible();
  await expect(f.locator('input[name="name"]')).toHaveValue('Anna');
});

test('?form=sheet: the test button opens the sheet, «Назад» closes it and stays on the page, the form sends', async ({ page }, ti) => {
  test.skip(levelOf(ti.project.name) !== 'A', 'level A only');
  await page.goto('/ru/lp/b/?form=sheet', { waitUntil: 'networkidle' });
  await expect(page.locator('#lp-f1')).toBeHidden();
  const btn = page.locator('.lp-hero-cta button');
  const sheet = page.locator('dialog.lp-sheet');
  await btn.click();
  await expect(sheet).toHaveAttribute('open', '');
  await page.goBack(); // Android hardware «Назад» / iOS edge swipe
  await expect(sheet).not.toHaveAttribute('open', '');
  expect(new URL(page.url()).pathname).toBe('/ru/lp/b/');
  await btn.click();
  await sheet.locator('.lp-sheet__x').click(); // closed by ×: our history entry is gone too
  await expect(sheet).not.toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => !!(history.state && history.state.bmOverlay))).toBe(false);
  await btn.click();
  await sheet.locator('input[name="name"]').fill('Анна');
  await sheet.locator('input[name="phone"]').fill('+971 50 123 4567');
  await sheet.locator('button[type="submit"]').click();
  await expect(sheet.locator('.lp-thanks')).toBeVisible();
  expect(await aaFails(page)).toEqual([]);
});

test('sticky CTA: shown mid-page, hidden at the final form; the keyboard never covers the focused field', async ({ page }, ti) => {
  test.skip(levelOf(ti.project.name) !== 'A', 'level A only');
  await page.goto('/ru/lp/a/', { waitUntil: 'networkidle' });
  const bar = page.locator('.lp-sticky');
  await page.evaluate(() => document.querySelector('.lp-cards')!.scrollIntoView());
  await expect(bar).toHaveAttribute('data-show', '');
  await page.evaluate(() => document.querySelector('#lp-f2 button[type="submit"]')!.scrollIntoView({ block: 'center' }));
  await expect(bar).not.toHaveAttribute('data-show', '');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#lp-f1 input[name="phone"]').focus();
  const vp = page.viewportSize()!;
  const h = Math.max(260, vp.height - 300); // the on-screen keyboard takes ~300 px
  await page.setViewportSize({ width: vp.width, height: h });
  await page.waitForTimeout(400);
  const r = await page.locator('#lp-f1 input[name="phone"]').boundingBox();
  expect(r && r.y >= 0 && r.y + r.height <= h, `phone field ${r?.y}–${r && r.y + r.height} in ${h}`).toBeTruthy();
  await expect(bar, 'no sticky bar while typing (R-LP-03 M-03)').not.toHaveAttribute('data-show', '');
});

/**
 * Sticky CTA over the forms (Brand Designer's LP audit, lead): the bar must never sit over a field, a chip or a button of
 * either form — like the site's FAB test. Every 48 px through both form regions (hero #lp-f1, final #lp-f2): if the bar
 * is shown, no visible form control (its part on screen) may intersect it.
 */
/**
 * One page: every 48 px through both forms — the bar over a control, or hidden with no control on screen. expand: the
 * optional «Уточнить» block of both forms open (chips, the note, the second consent — RC-4).
 */
async function stickyScan(page: Page, url: string, { expand = false } = {}) {
  const bad: string[] = [];
  {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.querySelector('.lp-consent')?.remove()); // the first-visit consent bar is a separate test
    if (expand) await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('.lp-form details').forEach((d) => { d.open = true; }));
    const vh = page.viewportSize()!.height;
    for (const id of ['#lp-f1', '#lp-f2']) {
      const box = await page.locator(id).evaluate((f) => { const b = f.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, w: b.width }; });
      if (!box.w) continue; // ?form=sheet keeps #lp-f1 in a closed sheet
      for (let y = Math.max(0, Math.round(box.top - vh)); y <= box.bottom; y += 48) {
        await page.evaluate((t) => window.scrollTo({ top: t, behavior: 'instant' }), y);
        await page.waitForTimeout(120); // IntersectionObserver → data-show (reduced motion: no slide)
        bad.push(...(await page.evaluate(([form, sy]) => {
          const bar = document.querySelector('.lp-sticky')!;
          const br = bar.getBoundingClientRect();
          if (getComputedStyle(bar).display === 'none') return []; // ≥ 768: no sticky bar
          const out: string[] = [];
          if (!bar.hasAttribute('data-show') || br.top >= innerHeight) {
            // «empty» case (lead): the bar hides only for a form control that is on screen (≥ 3 px of it) — never for the
            // card's edge or title alone, never with no form in view
            const typing = document.activeElement?.matches('.lp-form input, .lp-form textarea, .lp-form select');
            const any = [...document.querySelectorAll('.lp-form input:not([type="hidden"]), .lp-form textarea, .lp-form select, .lp-form button, .lp-form .chip, .lp-form .check, .lp-form summary, [data-lp-cta]')]
              .some((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && !c.closest('dialog') && Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= 3; });
            if (!typing && !any) out.push(`${location.pathname} ${innerWidth}×${innerHeight} scroll ${sy}: the bar is hidden, but no form control is on screen`);
            return out;
          }
          for (const el of document.querySelectorAll<HTMLElement>(`${form} input:not([type="hidden"]), ${form} textarea, ${form} select, ${form} button, ${form} .chip, ${form} .check, ${form} summary`)) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) continue; // off screen
            const over = Math.min(r.bottom, innerHeight) - Math.max(r.top, br.top);
            if (over >= 3 && r.right > br.left && r.left < br.right) { // the same 3 px as «on screen» above: the bar hides at 3 px of a control
              const name = el.getAttribute('name') || el.getAttribute('type') || el.className.split(' ')[0] || el.tagName.toLowerCase();
              out.push(`${location.pathname} ${innerWidth}×${innerHeight} scroll ${sy}: ${form} ${name} under the sticky bar by ${Math.round(over)} px`);
            }
          }
          return out;
        }, [id, y] as const)));
      }
    }
  }
  return bad;
}

test('sticky CTA never covers a field or a button of the forms, and never hides with no form control on screen (every scroll position, every device of the LP matrix)', async ({ page }) => {
  test.setTimeout(180_000); // three scans since RC-4 (+ «Уточнить» open, ?form=sheet)
  const bad: string[] = [];
  for (const url of SMOKE_PAGES) bad.push(...(await stickyScan(page, url)));
  // RC-4: the «Уточнить» block open (the forms grow by the chips and the note) and the ?form=sheet variant (the hero form
  // in a closed sheet: the final form and the hero button) — one page each, every device
  bad.push(...(await stickyScan(page, '/ru/lp/a/', { expand: true })).map((x) => `«Уточнить» open: ${x}`));
  bad.push(...(await stickyScan(page, '/ru/lp/a/?form=sheet')).map((x) => `?form=sheet: ${x}`));
  // the sheet open: no control of its form under the sticky bar (the dialog is modal — a tap at each control's centre lands
  // on the control)
  await page.goto('/ru/lp/a/?form=sheet', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('.lp-consent')?.remove());
  await page.evaluate(() => window.scrollTo(0, 0));
  // the hero's sheet button (aria-haspopup) — not the first [data-lp-cta]: that is the hidden form's submit inside the closed sheet
  await page.locator('.lp-hero button[aria-haspopup="dialog"]').click();
  await expect(page.locator('dialog.lp-sheet[open]')).toBeVisible();
  await page.waitForTimeout(450); // the sheet's rise
  bad.push(...(await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('dialog.lp-sheet[open] :is(input:not([type="hidden"]), textarea, select, button, .chip, .check, summary)')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, innerHeight - 1));
      if (hit && hit.closest('.lp-sticky')) out.push(`sheet open ${innerWidth}×${innerHeight}: ${el.getAttribute('name') || el.tagName.toLowerCase()} under the sticky bar`);
    }
    return out;
  })));
  expect([...new Set(bad)].slice(0, 40)).toEqual([]);
});

/**
 * Instagram on an iPhone SE (375×448 visible, not in the device matrix; lead): even after L03 the form button sits 33–53 px
 * below the first screen, so the first screen must show the whole first field (or the sticky CTA), and the bar must neither
 * cover a control nor hide with no control on screen. WebKit (A-iphone-se project), both smoke pages.
 */
test('IG on iPhone SE 375×448: first screen (button, first field or sticky CTA) and the sticky CTA rules', async ({ page, browserName }, ti) => {
  test.skip(ti.project.name !== 'A-iphone-se', 'one WebKit iPhone project sets the IG-on-SE window');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 448 });
  const bad: string[] = [];
  for (const url of SMOKE_PAGES) {
    await checkPage(page, url, browserName, false);
    bad.push(...(await stickyScan(page, url)));
  }
  expect([...new Set(bad)].slice(0, 40)).toEqual([]);
});

/**
 * Consent bar on the first visit (Brand Designer's LP audit: cut on 7 screens, lead): the whole text with the privacy link
 * and both buttons («Принять все», «Только необходимые») visible at once — nothing clipped by the bar, its scroll area or
 * the screen — and both buttons take a tap at their centre.
 */
test('consent bar: the whole text, the privacy link and both buttons visible on the first visit (every device of the LP matrix)', async ({ page }) => {
  const bad: string[] = [];
  for (const url of SMOKE_PAGES) {
    await page.goto(url, { waitUntil: 'networkidle' }); // no consent stored → the bar
    await expect(page.getByTestId('lp-consent')).toBeVisible();
    bad.push(...(await page.getByTestId('lp-consent').evaluate((bar) => {
      const out: string[] = [];
      const at = `${location.pathname} ${innerWidth}×${innerHeight}`;
      const check = (el: Element | null, name: string, tap: boolean) => {
        if (!el) { out.push(`${at}: ${name} missing`); return; }
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) { out.push(`${at}: ${name} not rendered`); return; }
        // the visible window: the screen, cut by every ancestor that clips (the bar, its scroll area)
        let top = 0, left = 0, bottom = innerHeight, right = innerWidth;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const ar = a.getBoundingClientRect();
          top = Math.max(top, ar.top); left = Math.max(left, ar.left); bottom = Math.min(bottom, ar.bottom); right = Math.min(right, ar.right);
        }
        const hidden = Math.max(top - r.top, r.bottom - bottom, left - r.left, r.right - right);
        if (hidden > 0.5) out.push(`${at}: ${name} ${Math.ceil(hidden)} px hidden`);
        if (tap) {
          const f = el.getClientRects()[0] ?? r; // an inline link may wrap: the centre of its first line box, not of the union
          const hit = document.elementFromPoint(f.left + f.width / 2, Math.min(f.top + f.height / 2, innerHeight - 1));
          if (!hit || !el.contains(hit)) out.push(`${at}: a tap at the centre of ${name} lands on ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
        }
      };
      check(bar.querySelector('.lp-consent__text'), 'the consent text', false);
      check(bar.querySelector('.lp-consent__text a'), 'the privacy link', true);
      check(bar.querySelector('.lp-consent__acts .btn--p'), '«accept all»', true);
      check(bar.querySelector('.lp-consent__acts .lp-consent__secondary'), '«necessary only»', true);
      return out;
    })));
  }
  expect(bad).toEqual([]);
});

/** Desktop and tablet windows (desktop audit 01a1b516, art director). The browser window, not the screen: 1366×768 → ~1366×657,
 * 1280×720 → ~1280×610, 1280×800 → ~1280×689; iPad landscape 1024×768. «Подобрать время» whole on the first screen with
 * ≥ 8 px to spare (was 5–163 px below it: a fixed 60 px H1 in 4–6 lines), and no heading splits a word in the middle
 * (overflow-wrap: anywhere is the phones' safety net: «восстановление» broke at 1024–1100). One Chromium and one WebKit
 * project run it, in their own desktop contexts. */
const DESKTOP = [[1024, 768], [1024, 1366], [1100, 800], [1180, 820], [1280, 610], [1280, 689], [1366, 657], [1440, 789], [1536, 730], [1920, 969]];
test('desktop and tablet windows 1024–1920: the form button on the first screen, no heading splits a word', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(240_000);
  const bad: string[] = [];
  for (const [width, height] of DESKTOP) {
    const ctx = await browser.newContext({ viewport: { width, height }, baseURL: ti.project.use.baseURL, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'gate' })));
    const page = await ctx.newPage();
    for (const url of PAGES) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const m = await page.evaluate(() => {
        const btn = document.querySelector('.lp-hero .lp-form button[type="submit"]')!.getBoundingClientRect();
        const split: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('.lp :is(h1, h2, h3)')) {
          if (!el.getBoundingClientRect().width) continue;
          const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (tw.nextNode()) {
            const n = tw.currentNode as Text; const re = /[^\s\u00a0]+/g; let w: RegExpExecArray | null;
            while ((w = re.exec(n.data))) {
              const r = document.createRange(); r.setStart(n, w.index); r.setEnd(n, w.index + w[0].length);
              if (new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1) split.push(`${el.tagName} «${w[0]}»`);
            }
          }
        }
        return { spare: innerHeight - btn.bottom, split };
      });
      if (m.spare < 8) bad.push(`${width}×${height} ${url}: the form button ${Math.round(-m.spare)} px past the first screen (8 px spare needed)`);
      for (const s of m.split) bad.push(`${width}×${height} ${url}: ${s} split mid-word`);
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

/** «Что можно выбрать» (desktop audit R1 + HR, RC-4): on 320–1024 the price and the old price stay on one line («520 AED
 * 650»; «Демо» may wrap — it went «520 AED / 650 / ДЕМО» on 360 / 800 / 820), every card ends inside the list (the third
 * card ran into the page margin on 768), no word of the card facts is split. One Chromium project, own contexts. */
const CARD_WIDTHS = [[320, 640], [360, 640], [393, 852], [744, 1133], [768, 1024], [800, 1280], [820, 1180], [1024, 1366]];
test('service cards on 320–1024: the price row on one line, the cards inside the list, no split words', async ({ browser }, ti) => {
  test.skip(ti.project.name !== 'A-pixel-7', 'one Chromium project');
  test.setTimeout(180_000);
  const bad: string[] = [];
  for (const [width, height] of CARD_WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height }, baseURL: ti.project.use.baseURL, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'gate' })));
    const page = await ctx.newPage();
    for (const url of PAGES) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const found = await page.evaluate(() => {
        const out: string[] = []; const list = document.querySelector('.lp-cards')!; const lb = list.getBoundingClientRect();
        const carousel = getComputedStyle(list).overflowX !== 'visible';
        for (const card of document.querySelectorAll<HTMLElement>('.lp-cards .lp-card')) {
          // the price and the old price on one line: their vertical centres meet (works with or without the .price-row wrapper)
          const pr = card.querySelector('dd .price')?.getBoundingClientRect(), old = card.querySelector('dd s')?.getBoundingClientRect();
          if (pr && old && Math.abs((pr.top + pr.bottom) / 2 - (old.top + old.bottom) / 2) > 6) out.push(`price «${card.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim()}»: the old price on another line`);
          if (!carousel && card.getBoundingClientRect().right > lb.right + 0.5) out.push(`a card ends ${Math.round(card.getBoundingClientRect().right - lb.right)} px past the list`);
          for (const el of card.querySelectorAll('dt, dd')) for (const w of (el.textContent || '').split(/[\s\u00a0]+/).filter(Boolean)) {
            const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n: Node | null;
            while ((n = tw.nextNode())) { const i = n.textContent!.indexOf(w); if (i < 0) continue; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length);
              if (new Set([...r.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size > 1) out.push(`«${w}» split mid-word`); break; }
          }
        }
        return [...new Set(out)];
      });
      bad.push(...found.map((x) => `${width}×${height} ${url}: ${x}`));
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

/** Instagram on an iPhone SE (375×448, Brand Designer L03): the form button whole on the first screen with ≥ 8 px to spare
 * (it ended 53 / 33 px below on /a / /b). ≤ 450 px high only: the top bar 48 px, the sub-line for screen readers. */
test('LP in Instagram on an iPhone SE (375×448): the form button whole on the first screen', async ({ browser }, ti) => {
  test.skip(ti.project.name !== 'A-iphone-se', 'one WebKit project');
  const ctx = await browser.newContext({ viewport: { width: 375, height: 448 }, baseURL: ti.project.use.baseURL, isMobile: true, hasTouch: true, userAgent: ti.project.use.userAgent });
  await ctx.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'gate' })));
  const page = await ctx.newPage(); const bad: string[] = [];
  for (const url of PAGES) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const spare = await page.evaluate(() => innerHeight - document.querySelector('.lp-hero .lp-form button[type="submit"]')!.getBoundingClientRect().bottom);
    if (spare < 8) bad.push(`${url}: the form button ${Math.round(-spare)} px past the first screen (8 px spare needed)`);
  }
  await ctx.close();
  expect(bad).toEqual([]);
});

/**
 * RC-6 (lead + AD): a late web font moves nothing. Manrope delayed 800 ms (a slow mobile line — the ad traffic): the H1,
 * the sub-line, the form and its CTA (?form=sheet: the hero's sheet button) stay where the first frame put them, ≤ 1 px,
 * sampled per rAF from the document's creation. With swap the copy re-wrapped when the font arrived: /lp/a 375 — 32 px,
 * /lp/b 768 — the form 47 px, /lp/a 1280 — 62 px (MO-15 390: CLS 0.108). Now display: optional + a metric-calibrated
 * fallback. 320 / 390 / 768 / 1280; /lp/a, /lp/b, /lp/a?form=sheet. One Chromium and one WebKit project.
 */
type LpBox = { k: string; b: number[] };
test('a late web font moves nothing on the first screen: H1, sub-line, form and CTA stay put (≤ 1 px)', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(480_000);
  const baseURL = ti.project.use.baseURL!;
  const SEL = ['#lp-h1', '.lp-copy .sub', '#lp-f1', '#lp-f1 button[type="submit"]', '.lp-hero button[aria-haspopup="dialog"]'];
  const bad: string[] = [];
  for (const path of ['/ru/lp/a/', '/ru/lp/b/', '/ru/lp/a/?form=sheet']) for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1280, 800]]) {
    const phone = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, baseURL, ...(phone ? { deviceScaleFactor: 2, hasTouch: true } : {}) });
    await ctx.route(/\.woff2(\?|$)/, async (route) => { const r = await route.fetch(); await new Promise((res) => setTimeout(res, 800)); await route.fulfill({ response: r }); });
    await ctx.addInitScript((sel) => {
      localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' }));
      const wnd = window as unknown as { __lpf: LpBox[][] };
      wnd.__lpf = [];
      const tick = () => {
        const f: LpBox[] = [];
        for (const sl of sel) { const e = document.querySelector(sl); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.top < innerHeight) f.push({ k: sl, b: [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10) }); }
        wnd.__lpf.push(f);
        if (performance.now() < 2400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, SEL);
    const page = await ctx.newPage();
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForTimeout(Math.max(0, 2500 - (await page.evaluate(() => performance.now()))));
    const F = await page.evaluate(() => (window as unknown as { __lpf: LpBox[][] }).__lpf);
    await ctx.close();
    const first = new Map<string, number[]>();
    let d = 0, what = '';
    for (const f of F) for (const x of f) {
      const b0 = first.get(x.k);
      if (!b0) { first.set(x.k, x.b); continue; }
      x.b.forEach((v, j) => { const dd = Math.abs(v - b0[j]); if (dd > d) { d = dd; what = `${x.k} ${['x', 'y', 'w', 'h'][j]} ${b0[j]} → ${v}`; } });
    }
    if (!first.size) bad.push(`${path} ${w}×${h}: nothing tracked on the first screen`);
    if (d > 1) bad.push(`${path} ${w}×${h}: moved ${d.toFixed(1)} px when the font came — ${what}`);
  }
  expect(bad).toEqual([]);
});
