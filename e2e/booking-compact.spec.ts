/**
 * Booking on short screens and landscape phones (design audit BD F25–F27, RC-2): phones under 700 px of visible height and
 * landscape phones (768–1023 wide, ≤ 480 high). Level A every gate run, level B / in-app with GATE_MATRIX.
 *  - steps 2–6: «Шаг N из 7» and the H1 share one row; the first service card starts in the top third of the screen and
 *    is whole above the sticky «Назад / Далее» (was 239 px on every phone: 44 % on SE, 53 % in the Instagram browser);
 *  - landscape, step 1: the model takes ≥ 60 % of the visible height (was 0: banner + header + stepper + H1 ate it).
 */
import { test, expect } from '@playwright/test';
import { seedConsent, settle3D } from './helpers';

const compact = (w: number, h: number) => (w < 768 && h < 700) || (w >= 768 && w <= 1023 && h <= 480);

test('booking steps 2–6 on short screens: one head row, the first card in the top third, whole above the bar', async ({ page }) => {
  const vp = page.viewportSize()!;
  test.skip(!compact(vp.width, vp.height), 'short screens and landscape phones only');
  await seedConsent(page);
  await page.goto('/ru/booking/?step=2&service=101', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const card = document.querySelector('.bk-step input[name="service"]')!.closest('label, .rcard, li, article')!.getBoundingClientRect();
    const bar = document.querySelector('.bk-step:not(.bk-step--zones) .bk-actions')!.getBoundingClientRect();
    const h1 = document.querySelector('.bk-step h1')!.getBoundingClientRect();
    const label = document.querySelector('.booking > nav .mstep b')!.getBoundingClientRect();
    return { cardTop: card.top, cardBottom: card.bottom, barTop: bar.top, sameRow: Math.abs((h1.top + h1.bottom) / 2 - (label.top + label.bottom) / 2) < 6, overlap: label.right > h1.left + 84 };
  });
  // portrait: the top third; landscape (334–360 high): the card still starts in the upper 45 % and is whole above the bar
  expect(m.cardTop / vp.height, `first card at ${Math.round(m.cardTop)} px of ${vp.height}`).toBeLessThanOrEqual(vp.width >= 768 ? 0.45 : 0.33);
  expect(m.cardBottom, 'the first card is whole above «Назад / Далее»').toBeLessThanOrEqual(m.barTop + 0.5);
  if (vp.width >= 360) expect(m.sameRow, '«Шаг 2 из 7» and the H1 share one row').toBe(true); // < 360: own rows (RC-3 S01)
});

test('booking steps 2–4 on short screens: the progress line never crosses the H1 (320: «Выберите дату и время»)', async ({ page }) => {
  const vp = page.viewportSize()!;
  test.skip(!compact(vp.width, vp.height), 'short screens and landscape phones only');
  await seedConsent(page);
  const sizes = [vp, ...(['A-iphone-se', 'A-moto-g4'].includes(test.info().project.name) ? [{ width: 320, height: 560 }, { width: 344, height: 640 }] : [])];
  const bad: string[] = [];
  for (const s of sizes) {
    await page.setViewportSize(s);
    for (const step of [2, 3, 4]) {
      await page.goto(`/ru/booking/?step=${step}&service=101`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const h1 = document.querySelector('.bk-step h1')!; const r = document.createRange(); r.selectNodeContents(h1);
        const lines = [...r.getClientRects()].filter((x) => x.width > 2);
        const prog = document.querySelector('.booking > nav .mstep .prog')!.getBoundingClientRect();
        const label = document.querySelector('.booking > nav .mstep b')!.getBoundingClientRect();
        const h1b = h1.getBoundingClientRect();
        return { crossed: lines.some((x) => prog.bottom > x.top + 1 && prog.top < x.bottom - 1 && prog.right > x.left && prog.left < x.right), labelAbove: label.bottom <= h1b.top + 0.5, text: h1.textContent };
      });
      if (m.crossed) bad.push(`${s.width}×${s.height} step ${step}: the progress line crosses «${m.text}»`);
      if (s.width < 360 && !m.labelAbove) bad.push(`${s.width}×${s.height} step ${step}: «Шаг N из 7» is not above the H1`);
    }
  }
  expect(bad).toEqual([]);
});

test('booking step 1 in landscape: two columns, the model takes most of the screen (also short landscape phones under 768)', async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  // 768–1023 × ≤ 480 on the device itself; since RC-3 also SE 667×325 and 740×360 (LAND_PHONE_MQ), set on one WebKit and
  // one Chrome phone
  const sizes = [...(vp.width >= 768 && vp.width <= 1023 && vp.height <= 480 ? [vp] : []), ...(['A-iphone-se', 'A-moto-g4'].includes(ti.project.name) ? [{ width: 667, height: 325 }, { width: 740, height: 360 }] : [])];
  test.skip(!sizes.length, 'landscape phones only');
  await seedConsent(page);
  const bad: string[] = [];
  for (const s of sizes) {
    await page.setViewportSize(s);
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const slot = document.querySelector('.booking-3d__model .b3d-slot')!.getBoundingClientRect();
      const right = document.querySelector('.booking-3d__right')!.getBoundingClientRect();
      const twoD = document.querySelector('[data-testid="switch-2d"]')!.getBoundingClientRect();
      const sheet = document.querySelector('.bk-step--zones .bsheet');
      return { visible: Math.min(slot.bottom, innerHeight) - Math.max(slot.top, 0), side: right.left >= slot.right - 1 && right.top < innerHeight, twoD: twoD.bottom <= Math.min(slot.bottom, innerHeight) + 0.5,
        sheetChrome: !!sheet && getComputedStyle(sheet.querySelector('.bsheet__head')!).display !== 'none' };
    });
    const at = `${s.width}×${s.height}`;
    if (m.visible / s.height < 0.6) bad.push(`${at}: model ${Math.round(m.visible)} px of ${s.height} (< 60 %)`);
    if (!m.side) bad.push(`${at}: «Запись» is not a column next to the model`);
    if (!m.twoD) bad.push(`${at}: «Схема тела (2D)» leaves the model`);
    if (m.sheetChrome) bad.push(`${at}: «Запись» still has the bottom-sheet chrome`);
  }
  expect(bad).toEqual([]);
});

test('booking step 1 in 2D on phones: «М / Ж» + «Модель (3D)» fit in one row next to «?» (RU: «3D» under 375)', async ({ page }) => {
  const vp = page.viewportSize()!;
  test.skip(vp.width >= 768, 'phones only');
  await seedConsent(page);
  await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
  await page.getByTestId('switch-2d').click();
  const back = page.getByTestId('switch-3d');
  await expect(back).toBeVisible();
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.booking-3d .b3d-toolbar') as HTMLElement;
    const b = document.querySelector('[data-testid="switch-3d"]')!.getBoundingClientRect();
    return { over: bar.scrollWidth - bar.clientWidth, right: b.right, barRight: bar.getBoundingClientRect().right, h: b.height, w: b.width, text: (document.querySelector('[data-testid="switch-3d"]') as HTMLElement).innerText.trim() };
  });
  expect(m.over, 'the 2D row does not scroll').toBeLessThanOrEqual(1);
  expect(m.right, '«Модель (3D)» is whole inside the row').toBeLessThanOrEqual(m.barRight + 0.5);
  expect(Math.min(m.w, m.h), 'a 44 px target').toBeGreaterThanOrEqual(44);
  expect(m.text).toBe(vp.width < 375 ? '3D' : 'Модель (3D)');
  expect((await back.getAttribute('aria-label'))?.replace(/\u00a0/g, ' '), 'the accessible name stays full').toBe('Модель (3D). Вернуться к 3D-модели');
});

test('booking step 1 on phones: the floating controls never overlap each other or the «Запись» sheet and stay on the model (incl. in-app SE 375×448, landscape)', async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  test.skip(vp.width >= 768, 'phones only');
  // ≤ 500 px high «Сброс вида» and «Список зон» move to a right column under «?» (they overlapped by 26–30 px)
  // landscape SE 667×325, 740×360: the two-column landscape layout since RC-3 (as 768–1023 × ≤ 480: «Список зон» under «?»)
  const sizes = [vp, ...(['A-iphone-se', 'A-moto-g4'].includes(ti.project.name) ? [{ width: 375, height: 448 }, { width: 320, height: 480 }, { width: 393, height: 559 }, { width: 640, height: 300 }, { width: 667, height: 325 }, { width: 740, height: 360 }, { width: 812, height: 340 }, { width: 852, height: 334 }] : [])]; // 640×300: Moto G4 landscape (HR step1_check, RC-3)
  await seedConsent(page);
  const bad: string[] = [];
  for (const s of sizes) {
    await page.setViewportSize(s);
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const found = await page.evaluate(() => {
      const els: Record<string, string> = { switch: '.booking-3d .b3d-switch', tools: '.booking-3d .b3d-toolbar > [role="group"]:not(.b3d-switch)', reset: '.booking-3d .b3d-toolbar > button:not([data-testid])',
        help: '.booking-3d__model .b3d-help-btn', twoD: '[data-testid="switch-2d"]', list: '.b3d-list-link', sheet: '.bk-step--zones .bsheet' };
      const R: Record<string, DOMRect> = {};
      // a control scrolled out of the toolbar row is clipped by it: compare what is visible
      const bar = document.querySelector('.booking-3d .b3d-toolbar') as HTMLElement; const bb = bar.getBoundingClientRect();
      const clip = bar.scrollWidth > bar.clientWidth + 1;
      for (const [k, sel] of Object.entries(els)) {
        const el = document.querySelector(sel); const b = el?.getBoundingClientRect(); if (!el || !b || !b.width) continue;
        if (clip && bar.contains(el)) { const l = Math.max(b.left, bb.left), r = Math.min(b.right, bb.right); if (r - l < 1) continue; R[k] = new DOMRect(l, b.top, r - l, b.height); } else R[k] = b;
      }
      const slot = document.querySelector('.booking-3d__model .b3d-slot')!.getBoundingClientRect();
      const out: string[] = []; const ks = Object.keys(R);
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
        const a = R[ks[i]], b = R[ks[j]];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 0.5 && oy > 0.5) out.push(`${ks[i]} × ${ks[j]} overlap ${Math.round(ox)}×${Math.round(oy)} px`);
      }
      for (const k of ks) if (k !== 'sheet' && (R[k].bottom > slot.bottom + 0.5 || R[k].top < slot.top - 0.5)) out.push(`${k} leaves the model box`);
      // «Список зон» and «Схема тела (2D)» ≥ 8 px apart (Hard Reviewer MINOR, RC-3: they touched on 640×300)
      if (R.list && R.twoD) { const a = R.list, b = R.twoD; const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom); if (gap < 7.5) out.push(`list × twoD only ${Math.floor(gap)} px apart`); }
      return out;
    });
    bad.push(...found.map((x) => `${s.width}×${s.height}: ${x}`));
  }
  expect(bad).toEqual([]);
});

test('booking step 1 in landscape: the «Запись» card is one white ground — every visible line and button of it sits on the card (S04)', async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  const extra = ['A-iphone-se', 'A-moto-g4'].includes(ti.project.name) ? [{ width: 852, height: 334 }, { width: 915, height: 360 }, { width: 812, height: 340 }, { width: 956, height: 370 }, { width: 667, height: 325 }, { width: 740, height: 360 }] : [];
  const sizes = [...(vp.width > vp.height && vp.height <= 480 ? [vp] : []), ...extra];
  test.skip(!sizes.length, 'landscape phones only');
  await seedConsent(page);
  const bad: string[] = [];
  for (const s of sizes) {
    await page.setViewportSize(s);
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const found = await page.evaluate(() => {
      const col = document.querySelector('.bk-step--zones .booking-3d__right') as HTMLElement;
      if (!col || getComputedStyle(col).display === 'contents') return null; // the phone layout (bottom sheet): not this test
      const cb = col.getBoundingClientRect();
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
      const probe = document.createElement('i'); probe.style.color = surface; document.body.appendChild(probe); const white = getComputedStyle(probe).color; probe.remove();
      const ground = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return { e, bg }; } return null; };
      const out: string[] = [];
      for (const el of col.querySelectorAll('p, b, h2, h3, button, a, label, textarea, li')) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (r.bottom <= cb.top || r.top >= cb.bottom || r.bottom <= 0 || r.top >= innerHeight) continue; // scrolled away inside the card
        if (el.closest('.bsheet__head, .sr-only') || getComputedStyle(el).visibility === 'hidden') continue;
        const g = ground(el); if (!g) { out.push(`«${(el.textContent || el.tagName).trim().slice(0, 30)}» has no ground`); continue; }
        const btn = el.closest('button, a.btn, .btn'); // a filled button paints its own ground: check what is behind the button
        const g2 = btn && g.e === btn ? ground(btn.parentElement!) : g;
        if (g2 && g2.bg !== white) out.push(`«${(el.textContent || el.tagName).trim().slice(0, 30)}» on ${g2.bg}, not on the white card`);
      }
      // the card's title and the first line of the list stay whole above the pinned CTA and its 24 px fade (667×325: the
      // visible gate hint made the pinned block ~190 of 229 px and cut «Запись» in half — the hint is sr-only there)
      const cta = col.querySelector(':scope > .bk-cta')?.getBoundingClientRect();
      for (const [name, el] of [['«Запись»', col.querySelector('.b3d-panel h2')], ['the first line', col.querySelector('.b3d-panel > p')]] as const) {
        const r = el?.getBoundingClientRect(); if (!r || !r.height || !cta) continue;
        if (r.top < cb.top - 0.5 || r.bottom > cta.top - 24 + 0.5) out.push(`${name} is not whole above the pinned CTA (${Math.round(r.top)}–${Math.round(r.bottom)}, CTA from ${Math.round(cta.top)})`);
      }
      return out;
    });
    if (found) bad.push(...found.map((x) => `${s.width}×${s.height}: ${x}`));
  }
  expect([...new Set(bad)]).toEqual([]);
});

/**
 * RC-4 (lead; FB + AD): short landscape phones — the figure itself ≥ 190 px high (main 6b101c5: 105 px on 640×300, 123 on
 * 667×325). Measured like Hard Reviewer's step1_check: the saturated-red pixels of the model on a screenshot of the canvas
 * (r > 150, g < 140, b < 140, r − g > 50; 0.5 % trimmed at each end), in CSS px. The front view at rest (reduced motion).
 */
test('booking step 1 on short landscape phones (640×300, 667×325): the figure ≥ 190 px, not cut at the top or bottom, a tap on it sets a marker', async ({ page }, ti) => {
  test.skip(!['A-iphone-se', 'A-moto-g4'].includes(ti.project.name), 'one WebKit + one Chrome phone set the landscape windows');
  await seedConsent(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const bad: string[] = [];
  for (const s of [{ width: 640, height: 300 }, { width: 667, height: 325 }]) {
    await page.setViewportSize(s);
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    await settle3D(page);
    if (await page.locator('.b3d-slot[data-mode2d]').count()) { test.info().annotations.push({ type: 'skipped size', description: `${s.width}×${s.height}: 2D fallback (load)` }); continue; }
    const f0 = await page.evaluate(() => window.__bm3d?.frames ?? 0);
    await page.waitForFunction((f) => (window.__bm3d?.frames ?? 0) > f + 10, f0, { timeout: 15_000 }).catch(() => {});
    const slot = page.locator('.booking-3d__model .b3d-slot');
    const png = (await slot.screenshot()).toString('base64');
    const m = await page.evaluate(async (data) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; const ys: number[] = [], xs: number[] = [];
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        const k = (y * c.width + x) * 4, r = d[k], gg = d[k + 1], b = d[k + 2];
        if (r > 150 && gg < 140 && b < 140 && r - gg > 50) { ys.push(y); xs.push(x); }
      }
      if (ys.length < 50) return null;
      const k = devicePixelRatio, n = ys.length; const sy = [...ys].sort((p, q) => p - q), sx = [...xs].sort((p, q) => p - q); const t = Math.floor(n / 200);
      // trimmed height (as step1_check); the untrimmed extremes for «not cut»; the trimmed centre for the tap
      return { h: (sy[n - 1 - t] - sy[t]) / k, top: sy[0] / k, bottom: (c.height - 1 - sy[n - 1]) / k, cx: (sx[t] + sx[n - 1 - t]) / 2 / k, cy: (sy[t] + sy[n - 1 - t]) / 2 / k };
    }, png);
    const at = `${s.width}×${s.height}`;
    if (!m) { bad.push(`${at}: no model on the canvas`); continue; }
    if (m.h < 190) bad.push(`${at}: the figure ${Math.round(m.h)} px (< 190)`);
    if (m.top < 2 || m.bottom < 2) bad.push(`${at}: the model touches the canvas edge (top ${Math.round(m.top)} px, bottom ${Math.round(m.bottom)} px)`);
    // a tap at the middle of the figure sets a marker (the tap-vs-double-tap delay, then the marker appears)
    const box = (await slot.boundingBox())!;
    const n0 = await page.locator('[data-testid="b3d-marker"]').count();
    await page.touchscreen.tap(box.x + m.cx, box.y + m.cy);
    if (!(await page.waitForFunction((n) => document.querySelectorAll('[data-testid="b3d-marker"]').length > n, n0, { timeout: 4_000 }).then(() => true, () => false))) bad.push(`${at}: a tap on the figure set no marker`);
  }
  expect(bad).toEqual([]);
});
