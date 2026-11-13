/**
 * Level B layout smoke (README-CONTEXT «ВСЕ iPhone И ВСЕ Android»): key pages × ru / en on ~18 more sizes (e2e/devices.ts
 * LEVEL_B, visible areas, landscape, Fold, tablet). Run with `npm run test:matrix`.
 * Per page: domChecks (one h1, viewport, buttons ≥ 44, fields ≥ 16, no horizontal overflow, no dead links), no clipped
 * text, text ≥ 13 px, fixed bottom bars with env(safe-area-inset-bottom) that leave the page end readable; /booking on
 * phones: the bottom sheet fits the screen and scrolls; landscape: side safe areas (notch / Dynamic Island).
 */
import { test, expect, type Page } from '@playwright/test';
import { domChecks, guard, expectClean, seedConsent } from './helpers';
import en from '../messages/en.json';

const PAGES = ['', 'booking/', 'services/', 'services/sports/', 'journal/', 'contacts/', 'account/'];

/** CSS rules that apply to the element and mention the given text (env(safe-area-inset-…) checks) */
async function ruleMentions(page: Page, selector: string, text: string) {
  return page.evaluate(([sel, needle]) => {
    const el = document.querySelector(sel); if (!el) return null;
    let found = false;
    const walk = (rules: CSSRuleList) => {
      for (const r of [...rules]) {
        if (r instanceof CSSMediaRule && !window.matchMedia(r.conditionText).matches) continue;
        if (r instanceof CSSStyleRule) { try { if (el.matches(r.selectorText) && r.style.cssText.includes(needle)) found = true; } catch { /* nested */ } }
        if ('cssRules' in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
      }
    };
    for (const s of [...document.styleSheets]) { try { walk(s.cssRules); } catch { /* cross-origin */ } }
    return found;
  }, [selector, text] as const);
}

async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const p: string[] = [];
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.sr-only,[aria-hidden="true"],template'); };
    const name = (el: Element) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    // clipped text: a box that hides its own overflowing text (ellipsis = intended truncation, not reported)
    for (const el of document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,li,a,button,label,dt,dd,span,strong,b')) {
      if (!visible(el) || !el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      // visually hidden text (1 px clip technique) and the FAB label (its wrapper clips by design) are not clipped text
      if (el.clientWidth <= 2 || el.closest('.fab-wrap') || /skip-link/.test(String(el.className))) continue; // skip links: hidden until focused
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) p.push(`clipped text ${name(el)} ${el.scrollWidth}>${el.clientWidth}: "${el.textContent.trim().slice(0, 30)}"`);
    }
    // text ≥ 13 px (own text nodes only)
    const small = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement; if (!el || !n.textContent?.trim() || !visible(el) || el.closest('svg')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 13) small.add(`${name(el)} ${fs}px "${n.textContent.trim().slice(0, 24)}"`);
    }
    for (const s of [...small].slice(0, 6)) p.push(`text < 13 px: ${s}`);
    // the end of the page stays readable above fixed bottom bars (the floating FAB is a button by design)
    window.scrollTo(0, document.documentElement.scrollHeight);
    const bars = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const cs = getComputedStyle(el); if (cs.position !== 'fixed' || !visible(el) || el.closest('.fab-wrap')) return false;
      const r = el.getBoundingClientRect(); return r.bottom >= window.innerHeight - 2 && r.height < window.innerHeight * 0.5 && r.width > window.innerWidth * 0.6;
    });
    const footer = document.querySelector('footer');
    if (bars.length && footer) {
      const top = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
      const fb = footer.getBoundingClientRect().bottom;
      if (fb > top + 1) p.push(`page end hidden under a fixed bar: footer bottom ${Math.round(fb)} > bar top ${Math.round(top)} (${bars.map(name).join(', ')})`);
    }
    window.scrollTo(0, 0);
    return p;
  });
}

for (const locale of ['ru', 'en'] as const) {
  for (const path of PAGES) {
    test(`/${locale}/${path}`, async ({ page, baseURL }) => {
      await seedConsent(page);
      const g = guard(page, baseURL!);
      await page.goto(`/${locale}/${path}`, { waitUntil: 'networkidle' });
      const problems = [...(await domChecks(page, locale)), ...(await layoutProblems(page))];
      const vp = page.viewportSize()!;
      // fixed bottom bars over the home indicator
      for (const sel of ['.fab-wrap', '.bk-ctabar', '.bk-cta']) {
        const has = await page.locator(sel).first().isVisible().catch(() => false);
        if (has && (await page.locator(sel).first().evaluate((el) => getComputedStyle(el).position === 'fixed' || getComputedStyle(el).position === 'sticky')) && !(await ruleMentions(page, sel, 'safe-area-inset-bottom'))) problems.push(`${sel}: no env(safe-area-inset-bottom)`);
      }
      // landscape phones: the notch / Dynamic Island side — the header and the page container keep clear of it
      if (vp.width > vp.height && vp.height < 500) {
        for (const sel of ['.site-header .container, .site-header', 'main .container']) {
          if ((await ruleMentions(page, sel.split(',')[0].trim(), 'safe-area-inset-left')) === false && (await ruleMentions(page, sel.split(',').pop()!.trim(), 'safe-area-inset-left')) === false) problems.push(`landscape: ${sel} has no env(safe-area-inset-left/right)`);
        }
      }
      // /booking on phones: the «Запись» sheet fits the screen when open and its body scrolls
      if (path === 'booking/' && (await page.locator('.bsheet__grab').isVisible().catch(() => false))) {
        // fully open (↑ twice from peek): the sheet is inside the screen, its body scrolls when the content is longer
        await page.locator('.bsheet__grab').focus();
        await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
        await expect(page.locator('.bsheet')).toHaveAttribute('data-snap', 'full');
        await page.waitForTimeout(450);
        const r = await page.locator('.bsheet').evaluate((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
        if (r.top < -1 || r.top > vp.height * 0.5) problems.push(`open bottom sheet top at ${Math.round(r.top)} of ${vp.height}`);
        const body = page.locator('.bsheet [id]').filter({ has: page.locator('*') }).last();
        const scroll = await body.evaluate((el) => { const before = el.scrollTop; el.scrollTop = 99999; const moved = el.scrollTop !== before; const b = el.getBoundingClientRect(); return { overflow: el.scrollHeight > el.clientHeight + 1, moved, bottom: b.bottom }; }).catch(() => null);
        if (scroll && scroll.overflow && !scroll.moved) problems.push('open bottom sheet: content longer than the sheet does not scroll');
        if (scroll && scroll.bottom > vp.height + 1) problems.push(`open bottom sheet body ends below the screen: ${Math.round(scroll.bottom)} > ${vp.height}`);
      }
      expect(problems, `/${locale}/${path} @ ${vp.width}×${vp.height}`).toEqual([]);
      expectClean(await g.problems(), `smoke /${locale}/${path}`);
    });
  }
}

// /booking step 4 (calendar + slots) on narrow phones — the page smoke above stops at step 1 (R-FINAL-2: 7 × 44 px days
// did not fit 288 px at 320). Zones from the list → first service → any specialist → step 4, then the same layout checks.
test('/en/booking/ step 4 (calendar) on narrow phones', async ({ page, baseURL }) => {
  const vp = page.viewportSize()!;
  test.skip(vp.width > 360 || vp.width > vp.height, 'narrow portrait phones only (320–360)');
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  if (await page.locator('.b3d-list-link').isVisible().catch(() => false)) await page.locator('.b3d-list-link').click();
  await page.locator('#zone-list input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: en.body3d.panel.cta }).first().click();
  await page.waitForURL(/step=2/);
  await page.locator('input[name="service"]').first().check();
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=3/);
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=4/);
  await page.locator('.dates button:not([aria-disabled])').first().waitFor();
  const problems = [...(await domChecks(page, 'en')), ...(await layoutProblems(page))];
  // every day button keeps the 44 px target and stays inside the screen
  const days = await page.locator('.dates button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, l: r.left, r: r.right }; }));
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  if (days.some((d) => d.l < -0.5 || d.r > vw + 0.5)) problems.push('calendar day outside the screen');
  if (days.some((d) => d.w < 43.5)) problems.push(`calendar day narrower than 44 px: ${Math.min(...days.map((d) => d.w)).toFixed(1)}`);
  expect(problems, `/en/booking/?step=4 @ ${vp.width}×${vp.height}`).toEqual([]);
  expectClean(await g.problems(), 'smoke /en/booking/ step 4');
});

// Web Art Director, desktop audit: Tailwind v4's own .container utility (max-width 40 / 48 / 64 / 80 / 96rem, @layer
// utilities) capped our .container below the --container token on every width ≥ 640 (iPad mini 640 instead of 712, Fold
// 768 instead of 936, 1100–1279 → 1024, 2560 → 1536 instead of 1680; landscape phones 42–73 px side space instead of 24).
// The device sizes above miss most of these widths, so the test sets them: on each, every visible .container is as wide
// as the token (± 1 px) and centred (|left − right| ≤ 1). One Chrome and one WebKit project; LP has no .container.
const CONTAINER_WIDTHS = [[744, 1133], [852, 393], [915, 412], [984, 1016], [1100, 800], [1180, 820], [1280, 800], [1440, 900], [2560, 1440]];
test('content container = the --container token on tablets, landscape phones and desktops (no Tailwind max-width cap)', async ({ page }, ti) => {
  test.skip(!['B-pixel-9pro', 'B-iphone-8plus'].includes(ti.project.name), 'one Chrome + one WebKit project: the test sets its own widths');
  const bad: string[] = [];
  for (const url of ['/ru/', '/en/services/', '/ru/services/sports/', '/en/journal/', '/ru/contacts/']) {
    for (const [i, [w, h]] of CONTAINER_WIDTHS.entries()) {
      await page.setViewportSize({ width: w, height: h });
      if (i === 0) await page.goto(url, { waitUntil: 'domcontentloaded' }); else await page.waitForTimeout(50);
      bad.push(...(await page.evaluate(() => {
        const probe = document.createElement('div'); // the token's value at this width
        probe.style.cssText = 'width: var(--container); height: 0; visibility: hidden';
        document.body.append(probe);
        const token = probe.getBoundingClientRect().width; probe.remove();
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.container')].filter((c) => c.getBoundingClientRect().width > 0).flatMap((c) => {
          const r = c.getBoundingClientRect(); const lr = Math.abs(r.left - (vw - r.right));
          return Math.abs(r.width - token) > 1 || lr > 1
            ? [`${location.pathname} ${innerWidth}px: .container ${Math.round(r.width)} px, token ${Math.round(token)} px, |L − R| ${Math.round(lr)} (max-width ${getComputedStyle(c).maxWidth})`] : [];
        });
      })));
    }
  }
  expect([...new Set(bad)]).toEqual([]);
});
