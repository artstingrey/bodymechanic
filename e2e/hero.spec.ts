/**
 * Home hero (RC-7, client: «the 3D model on the home page is not centred and turns on the left»): the FIGURE stands in the
 * middle — of the screen on phones and tablets, of its column on desktop — and the index is an anatomical atlas: each label
 * beside its point, left and right of the figure. (RC-3/4 centred the «model + index» group: the figure stood 82 px left of the
 * screen centre on 375–440, 132 px in the 1440 column.) The visible figure spans 0.288…0.703 of the canvas width in the front
 * pose; its DRAWN (red) centre at 0.5013 (styles/sections.css). Margins and centres from the hero band, not the window (a desktop profile
 * reserves a scrollbar gutter).
 */
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { seedConsent, guard, expectClean, settle3D } from './helpers';

const readView = (page: Page) => page.evaluate(() => window.__bm3d!.view!());
const yawGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const distance = ({ camera, target }: Awaited<ReturnType<typeof readView>>) => Math.hypot(...camera.map((n, i) => n - target[i]));
const viewGap = (a: Awaited<ReturnType<typeof readView>>, b: typeof a) =>
  Math.max(yawGap(a.yaw, b.yaw), Math.abs(a.zoom - b.zoom),
    ...a.camera.map((n, i) => Math.abs(n - b.camera[i])), ...a.target.map((n, i) => Math.abs(n - b.target[i])));

async function liveCanvas(page: Page, mode: 'hero' | 'booking') {
  const slot = page.locator(`.b3d-slot[data-mode="${mode}"]`);
  await expect(slot).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const canvas = slot.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => !!window.__bm3d?.view && !!window.__bm3d.anchors?.get().zones.length)).toBe(true);
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

test('stage 11: desktop hero mouse gestures and the shared booking camera', async ({ browser, baseURL }, ti) => {
  test.skip(ti.project.name !== 'A-pixel-7', 'one Chromium project with a desktop context');
  const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 800 } });
  try {
    await seedConsent(page);
    await page.goto('/ru/');
    let { x, y } = await liveCanvas(page, 'hero');
    const pause = page.getByTestId('b3d-rotation');
    await expect.poll(async () => Math.abs((await readView(page)).yaw)).toBeGreaterThan(0.05);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const front = await readView(page);
    const drag = async (dx: number, dy: number) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
    };
    await drag(0, -90);
    expect(await readView(page)).toEqual(front);
    await page.mouse.up();
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await drag(92, -65);
    const turned = await readView(page);
    expect(turned.yaw - front.yaw, 'right drag turns the front of the model right').toBeGreaterThan(0.4);
    expect({ ...turned, yaw: front.yaw }).toEqual(front);
    await page.mouse.up();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const released = await readView(page);
    await page.waitForTimeout(650); // longer than the old 500 ms automatic return
    expect(await readView(page)).toEqual(released);
    await drag(-60, 0);
    await expect.poll(async () => (await readView(page)).yaw - released.yaw).toBeLessThan(-0.4);
    await page.mouse.up();
    const held = await readView(page);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => yawGap((await readView(page)).yaw, held.yaw)).toBeGreaterThan(0.035);
    expect(yawGap((await readView(page)).yaw, held.yaw)).toBeLessThan(0.7);
    await pause.click();
    const paused = await readView(page);
    const restAnchors = () => page.evaluate(() => window.__bm3d!.anchors!.get().zones.map(({ zoneId, restX, restY }) => [zoneId, restX, restY]));
    const male = await restAnchors();
    const femaleButton = page.locator('.atlas').getByRole('button', { name: 'Женщина', exact: true });
    await femaleButton.click();
    await expect(femaleButton).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(restAnchors).not.toEqual(male);
    await expect(page.locator('.atlas-line[data-visible="1"]').first()).toBeAttached();
    expect(await readView(page)).toEqual(paused);

    await page.mouse.move(x, y);
    const scroll = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 180);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll + 60);
    expect(await readView(page)).toEqual(paused);

    const contextId = await page.evaluate(() => window.__bm3d!.contextId);
    const book = () => page.locator('a.btn-book:visible').first().click();
    await book();
    await page.waitForURL(/\/booking\//);
    ({ x, y } = await liveCanvas(page, 'booking'));
    const reset = page.locator('.b3d-reset');
    const rotate = page.getByRole('button', { name: 'Поворот', exact: true });
    const zoom = page.getByRole('button', { name: 'Масштаб', exact: true });
    await rotate.click();
    const bookingFront = { camera: front.camera, target: front.target, zoom: 1, yaw: 0 };
    await expect.poll(async () => viewGap(await readView(page), bookingFront)).toBeLessThan(0.01);
    await drag(80, -60);
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await readView(page)).camera[0])).toBeGreaterThan(0.5);
    await reset.click();
    await expect.poll(async () => viewGap(await readView(page), bookingFront)).toBeLessThan(0.01);
    await zoom.click();
    await drag(0, -80);
    await page.mouse.up();
    await expect.poll(async () => distance(await readView(page))).toBeLessThan(distance(bookingFront) - 0.4);
    // Return to hero while Zoom is still selected, then return to booking on the same WebGL context.
    await page.goBack();
    ({ x, y } = await liveCanvas(page, 'hero'));
    expect(await page.evaluate(() => window.__bm3d!.contextId)).toBe(contextId);
    const heroAgain = await readView(page);
    await drag(-82, -70);
    const turnedAgain = await readView(page);
    expect(turnedAgain.yaw - heroAgain.yaw, 'left drag turns the front of the model left').toBeLessThan(-0.4);
    expect({ ...turnedAgain, yaw: heroAgain.yaw }).toEqual(heroAgain);
    await page.mouse.up();
    await book();
    await page.waitForURL(/\/booking\//);
    ({ x, y } = await liveCanvas(page, 'booking'));
    expect(await page.evaluate(() => window.__bm3d!.contextId)).toBe(contextId);
    await expect(zoom).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => viewGap(await readView(page), bookingFront)).toBeLessThan(0.01);
    const point = await page.evaluate(({ x, y }) => {
      for (let dy = -40; dy <= 60; dy += 5) {
        if (window.__bm3d!.pick!(x, y + dy)) return { x, y: y + dy };
      }
      return null;
    }, { x, y });
    expect(point).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  } finally {
    await page.close();
  }
});

test('stage 11: touch swipes, pinch and cancellation in the hero', async ({ page, context }, ti) => {
  test.skip(!['A-moto-g4', 'A-pixel-7'].includes(ti.project.name), 'Chromium touch input on two phone widths');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedConsent(page);
  await page.goto('/ru/');
  const { x, y } = await liveCanvas(page, 'hero');
  const canvasWidth = await page.locator('.atlas canvas').evaluate((canvas) => canvas.clientWidth);
  const swipeDistance = Math.round(canvasWidth * 0.3);
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', ...touchPoints: { x: number; y: number; id?: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const front = await readView(page);
  expect(front.yaw).toBe(0);
  await touch('touchStart', { x, y });
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: x + Math.round(swipeDistance * i / 8), y: y - i * 2 });
  await expect.poll(async () => (await readView(page)).yaw - front.yaw, { message: 'one right swipe reaches the back' }).toBeCloseTo(Math.PI, 1);
  const turned = await readView(page);
  expect({ ...turned, yaw: front.yaw }).toEqual(front);
  await touch('touchEnd');
  expect(await readView(page)).toEqual(turned);

  const scroll = await page.evaluate(() => scrollY);
  await touch('touchStart', { x, y });
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x, y: y - i * 12 });
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll + 45);
  expect(await readView(page)).toEqual(turned);

  // A new swipe after native scrolling continues from the saved back view.
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), scroll);
  await touch('touchStart', { x, y });
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: x + Math.round(swipeDistance * 1.25 * i / 8), y });
  await expect.poll(async () => (await readView(page)).yaw - turned.yaw).toBeCloseTo(1.25 * Math.PI, 1);
  const fullTurn = await readView(page);
  await touch('touchCancel');
  expect(await readView(page)).toEqual(fullTurn);

  await touch('touchStart', { x, y });
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: x - Math.round(swipeDistance * i / 8), y });
  await expect.poll(async () => (await readView(page)).yaw - fullTurn.yaw).toBeCloseTo(-Math.PI, 1);
  const afterLeftSwipe = await readView(page);
  await touch('touchEnd');
  expect(await readView(page)).toEqual(afterLeftSwipe);

  await touch('touchStart', { x: x - 20, y, id: 0 }, { x: x + 20, y, id: 1 });
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: x - 20 - i * 6, y, id: 0 }, { x: x + 20 + i * 6, y, id: 1 });
  expect(await readView(page)).toEqual(afterLeftSwipe);
  await touch('touchEnd');
  expect(await readView(page)).toEqual(afterLeftSwipe);
});

const FIG_CENTRE = 0.5013; // the drawn (red) centre of the figure in the slot — sections.css; the pixel test checks the drawing itself

/** the figure centre vs the reference centre, each label's box, and the leader lines vs their labels */
const heroGeo = (page: Page, ref: 'hero' | 'stage', edge: 'screen' | 'grid') => page.evaluate(([FC, refBy, edgeBy]) => {
  const q = (s: string) => document.querySelector(s)!.getBoundingClientRect();
  const slot = q('.atlas-stage .b3d-slot'), hero = q('.hero'), stage = q('.atlas-stage'), grid = q('.hero__grid');
  const box = refBy === 'hero' ? hero : stage;
  const off = slot.left + slot.width * FC - (box.left + box.width / 2);
  const edgeL = edgeBy === 'screen' ? hero.left + 4 : grid.left - 0.5, edgeR = edgeBy === 'screen' ? hero.right - 4 : grid.right + 0.5;
  const rows = [...document.querySelectorAll<HTMLElement>('.atlas-index li')].map((li) => {
    const r = document.createRange(); r.selectNodeContents(li);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0);
    return { text: li.textContent!.trim(), side: li.dataset.side ?? '', lines: Math.round(li.querySelector('span')!.getBoundingClientRect().height / parseFloat(getComputedStyle(li).lineHeight)), words: li.querySelector('span')!.textContent!.trim().split(/\s+/).length, /* RC-8: the word's lines; on phones ≥ 360 the number stands over it */ left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)), top: Math.min(...rects.map((x) => x.top)), bottom: Math.max(...rects.map((x) => x.bottom)) };
  });
  const lineBad: string[] = [];
  // .atlas-line[i] belongs to .atlas-index li[i]: both are rendered from the same ZONES array, in its order (HeroAtlas)
  [...document.querySelectorAll<HTMLElement>('.atlas-line')].forEach((l, i) => {
    if (l.dataset.visible !== '1') return;
    const b = l.getBoundingClientRect(), row = rows[i];
    if (row.side === 'R' && b.right > row.left + 1) lineBad.push(`line ${i + 1} runs ${(b.right - row.left).toFixed(1)} px into «${row.text}»`);
    if (row.side === 'L' && b.left < row.right - 1) lineBad.push(`line ${i + 1} runs ${(row.right - b.left).toFixed(1)} px into «${row.text}»`);
  });
  // desktop: the H1 must end before the left labels (the text column and the atlas column are side by side)
  const h1 = document.querySelector('.hero__text h1');
  const h1Right = h1 ? Math.max(...[...(() => { const r = document.createRange(); r.selectNodeContents(h1); return r.getClientRects(); })()].filter((x) => x.width > 0).map((x) => x.right)) : -Infinity;
  const fonts = [...document.querySelectorAll('.atlas-index li, .atlas-index b')].map((e) => parseFloat(getComputedStyle(e).fontSize));
  const h1Lines = h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)) : 0;
  // the Мужчина / Женщина switch on the same axis (lead, RC-7); the pause button clear of it and inside the row
  const swb = document.querySelector('.atlas-top .b3d-switch')!.getBoundingClientRect(), rot = document.querySelector('.atlas-top .b3d-rot');
  const switchOff = Math.round(((swb.left + swb.right) / 2 - (box.left + box.width / 2)) * 10) / 10;
  const rb = rot && getComputedStyle(rot).display !== 'none' ? rot.getBoundingClientRect() : null;
  const pauseBad = rb ? (rb.left < swb.right + 8 ? 'the pause button touches the switch' : rb.right > edgeR + 0.5 ? 'the pause button past the edge' : '') : '';
  // the caption under the model is centred like the figure (lead, RC-7): its text's centre vs the same reference centre
  const cr = document.createRange(); cr.selectNodeContents(document.querySelector('.atlas > .cap')!); const cb = cr.getBoundingClientRect();
  const capOff = Math.round(((cb.left + cb.right) / 2 - (box.left + box.width / 2)) * 10) / 10;
  return { off: Math.round(off * 10) / 10, capOff, switchOff, pauseBad, slotW: slot.width, minFont: Math.min(...fonts), rows, lineBad, edgeL, edgeR, h1Right, h1Lines };
}, [FIG_CENTRE, ref, edge] as const);

/** labels inside the edges, one-word labels on one line, none over two lines */
const rowProblems = (g: Awaited<ReturnType<typeof heroGeo>>, label: string, maxLines = 2) => {
  const bad: string[] = [];
  for (const r of g.rows) {
    if (r.left < g.edgeL) bad.push(`${label}: «${r.text}» ${(g.edgeL - r.left).toFixed(1)} px past the left edge`);
    if (r.right > g.edgeR) bad.push(`${label}: «${r.text}» ${(r.right - g.edgeR).toFixed(1)} px past the right edge`);
    if (r.words === 1 && r.lines > 1) bad.push(`${label}: one-word «${r.text}» in ${r.lines} lines`);
    if (r.lines > maxLines) bad.push(`${label}: «${r.text}» in ${r.lines} lines (≤ ${maxLines})`);
  }
  // rows of the same side do not touch (a second line hangs below its first)
  for (const side of ['L', 'R']) {
    const s = g.rows.filter((r) => r.side === side).sort((a, b) => a.top - b.top);
    for (let i = 1; i < s.length; i++) if (s[i].top < s[i - 1].bottom + 2) bad.push(`${label}: «${s[i - 1].text}» touches «${s[i].text}»`);
  }
  return [...bad, ...g.lineBad.map((x) => `${label}: ${x}`)];
};

for (const locale of ['ru', 'en'] as const) {
  test(`home hero (${locale}): the figure in the middle of the phone, the labels beside it inside the screen, lines stop before them`, async ({ page }) => {
    const vp = page.viewportSize()!;
    test.skip(vp.width >= 768, 'phones (tablets and desktop: below)');
    await seedConsent(page);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // the front pose, no sway
    await page.goto(`/${locale}/`, { waitUntil: 'networkidle' });
    await page.locator('.atlas').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const g = await heroGeo(page, 'hero', 'screen');
    expect(Math.abs(g.off), `the figure centre vs the screen centre: ${g.off} px`).toBeLessThanOrEqual(2);
    expect(Math.abs(g.capOff), `the caption centre vs the screen centre: ${g.capOff} px`).toBeLessThanOrEqual(2);
    expect(Math.abs(g.switchOff), `the model switch centre vs the screen centre: ${g.switchOff} px`).toBeLessThanOrEqual(2);
    expect(g.pauseBad).toBe('');
    expect(rowProblems(g, `${vp.width}`)).toEqual([]);
    // the canvas follows the width but leaves room for the longest one-word label on each side (RC-7). The figure (0.415 of the
    // canvas) on the build: 27.5 % of the screen on 320 (88 px — the price of labels on both sides there), 33 % on 360, 36–37 %
    // from 375 (FB review: thresholds just under these, so an accidental shrink is caught). Above ~530 the share is capped by the
    // canvas: phones/stack cap the height at 600 px (sections.css) → 450 px wide → the figure 187 px (FB, B-tab-s9 640: 187 vs 224);
    // there the check is «the canvas reached its cap» (−2 px for rounding)
    const minShare = vp.width < 360 ? 0.27 : vp.width < 375 ? 0.32 : 0.35;
    const capFig = 600 * 0.75 * 0.415 - 2;
    expect(g.slotW * 0.415, `the figure on ${vp.width}: ${Math.round(g.slotW * 0.415)} px`).toBeGreaterThanOrEqual(Math.min(minShare * vp.width, capFig));
    expect(g.minFont).toBeGreaterThanOrEqual(13);
  });
}

/** Tablets and desktop, 768–2560 in landscape and the iPad Pro in portrait (tablet layout: the figure under the text, centred
 * on the screen; ≥ 1024 landscape: centred in its column, the text column beside it). One Chromium and one WebKit project. */
const WIDE = [[768, 1024], [820, 1180], [984, 1016], [1024, 1366], [1024, 768], [1100, 800], [1180, 820], [1279, 800], [1280, 800], [1366, 657], [1440, 789], [1920, 969], [2560, 1300]];
test('home hero on tablets and desktop: the figure centred, the labels beside it inside the content edge, clear of the H1', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(240_000);
  const bad: string[] = [];
  for (const [width, height] of WIDE) {
    const ctx = await browser.newContext({ viewport: { width, height }, baseURL: ti.project.use.baseURL, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await seedConsent(page);
    const desktop = width >= 1024 && width > height;
    for (const locale of ['ru', 'en']) {
      await page.goto(`/${locale}/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const g = await heroGeo(page, desktop ? 'stage' : 'hero', 'grid');
      const label = `${width}×${height} ${locale}`;
      if (Math.abs(g.off) > 2) bad.push(`${label}: the figure centre ${g.off} px off the ${desktop ? 'column' : 'screen'} centre`);
      if (Math.abs(g.capOff) > 2) bad.push(`${label}: the caption centre ${g.capOff} px off the ${desktop ? 'column' : 'screen'} centre`);
      if (Math.abs(g.switchOff) > 2) bad.push(`${label}: the model switch ${g.switchOff} px off the ${desktop ? 'column' : 'screen'} centre`);
      if (g.pauseBad) bad.push(`${label}: ${g.pauseBad}`);
      // one line on desktop ≥ 1024 landscape (desktop audit S1, lead RC-7; --side = the longest row); two allowed on tablets
      bad.push(...rowProblems(g, label, desktop ? 1 : 2));
      const leftLabels = g.rows.filter((r) => r.side === 'L');
      if (desktop && leftLabels.length && g.h1Right > Math.min(...leftLabels.map((r) => r.left)) - 8) bad.push(`${label}: the H1 runs into the left labels`);
      // the 6 / 6 grid: the RU H1 keeps its two designed lines (it fits its column, 9.6cqi)
      if (desktop && locale === 'ru' && g.h1Lines > 2) bad.push(`${label}: the H1 in ${g.h1Lines} lines (2 designed)`);
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

/**
 * RC-3 (lead; the RC-2 mobile:100 flake): the models' one embedded PNG — the palette's base colour, every other texture is
 * KTX2 — loads through our plugin (runtime/loader.ts). Its first decode fails on purpose: one retry, the texture is
 * delivered (the palette keeps its colour), the real error goes to a console warning, no console error. iOS 18 (GLTFLoader
 * would use ImageBitmapLoader), iOS 16.4 (it would use an <img>) and Chrome.
 */
test('3D: an embedded texture whose first decode fails is retried — the model keeps its colour, no console error', async ({ page, baseURL }, ti) => {
  test.skip(!['A-iphone-16', 'A-iphone-se', 'A-pixel-9'].includes(ti.project.name), 'iOS 18, iOS 16.4 and Chrome');
  await seedConsent(page);
  // the first decode fails, whichever path the device takes: createImageBitmap (Chrome, iOS ≥ 17) or an <img> on a blob:
  // URL (iOS < 17)
  await page.addInitScript(() => {
    const real = window.createImageBitmap.bind(window);
    let failed = false;
    window.createImageBitmap = ((...a: Parameters<typeof createImageBitmap>) => {
      if (!failed) { failed = true; return Promise.reject(new DOMException('e2e: injected decode failure', 'InvalidStateError')); }
      return real(...a);
    }) as typeof createImageBitmap;
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get() { return src.get!.call(this); },
      set(v: string) { if (!failed && typeof v === 'string' && v.startsWith('blob:')) { failed = true; v = 'data:image/png;base64,AAAA'; } src.set!.call(this, v); },
    });
  });
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  await settle3D(page);
  test.skip((await page.locator('.b3d-slot[data-mode2d]').count()) > 0, 'this device shows the 2D poster, no model');
  const s = await page.evaluate(() => (window as unknown as { __bmTextures?: Record<string, number> }).__bmTextures);
  expect(s, 'texture counters').toMatchObject({ retried: 1, fellBack: 0, failed: 0 });
  expect(s!.decoded, 'the palette texture delivered').toBeGreaterThanOrEqual(1);
  expect(g.warnings.some((w) => /decoding failed/.test(w)), `the real error in a warning: ${g.warnings.join(' | ')}`).toBe(true);
  expectClean(await g.problems(), '3D texture retry');
});

/**
 * RC-5 (lead; FB + AD): the poster → model handover on the home hero. While the model loads the index stands on the
 * poster's anchors (usePosterAnchors), so when the live 3D anchors take over nothing moves: every index row and every dot
 * within 2 px, and the lines with their dots are there already on the poster (they used to appear only with the model,
 * the rows jumped 27–37 px). The model's GLB is held until the poster state is read. Reduced motion (no sway).
 * The first frame too (lead): before any JS (the scripts blocked, the server HTML + CSS only) the rows already stand where
 * the live 3D anchors put them, Δ ≤ 2 px from the stage top — no move at the hydration, none at the swap.
 * Every level A phone; on one Chromium and one WebKit project also tablets and desktop windows (AD). Δ ≤ 2 px per LOD
 * (lead): the phones (< 768) load LOD1, the wider windows LOD0 — each case checks the model it really loaded (lib/body3d/lod).
 * The model from the cache (lead, HM-04): a second visit with the GLB cached and the full intro (no reduced motion) — on
 * the last poster frame before ready the overlay is shown with 5/5 lines and dots, the rows within 2 px of the model's,
 * no line redrawn after the swap.
 * ≥ 768 the LOD is known only at the hydration (lead): the rows are hidden on the first frame and fade in once placed on the
 * anchors of the right LOD — no visible row moves more than 2 px from its first visible frame on, CLS 0; one window with
 * deviceMemory 2 (an Android tablet: LOD1 on a wide screen). Phones: the rows are visible from the first frame.
 */
type Use = { viewport?: { width: number; height: number } | null; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean; userAgent?: string; baseURL?: string; mem?: number };
type AnchorsProbe = { __bmAnchors?: { get: () => { mode: string | null; source?: string } } };
type Frame = { t: number; st: string; src: string; intro: string; shown: boolean; rows: number[]; op: number[]; dots: string[]; dp: ([number, number] | null)[]; lines: { v: string; len: number; miss: number }[] };
type FrameProbe = { __hf: Frame[]; __cls: number | null };
/** One handover check on a fresh context with `use` (a device of the matrix, or a tablet / desktop window). */
async function heroHandover(browser: Browser, use: Use, label0: string, ti: TestInfo, extra = false): Promise<string[]> {
  let label = label0;
  const opts = { viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile, hasTouch: use.hasTouch, userAgent: use.userAgent, baseURL: use.baseURL, reducedMotion: 'reduce' as const };
  const rowsFromStage = () => {
    const s = document.querySelector('.atlas-stage')!.getBoundingClientRect().top;
    return [...document.querySelectorAll('.atlas-index li')].map((e) => e.getBoundingClientRect().top - s);
  };
  // the first frame: the same device, no JS at all (the scripts are not fetched); measured once the network and the web
  // fonts have settled (a label in a fallback font may wrap → its translateY(-50%) moves the row). Its screenshot and the
  // stage / font state go with a mismatch (a first-frame flake on two Pixel projects, RC-5 run 3, did not reproduce)
  const noJs = await browser.newContext(opts);
  const p0 = await noJs.newPage();
  await p0.route('**/*.js', (r) => r.abort());
  await p0.goto('/ru/', { waitUntil: 'load' });
  // ≥ 768 hidden until placed (failsafe: shown after 3 s without JS), phones visible — read right after the load event
  const firstOp = await p0.evaluate(() => ({ t: performance.now(), op: [...document.querySelectorAll('.atlas-index li')].map((e) => +getComputedStyle(e).opacity) }));
  await p0.waitForLoadState('networkidle');
  await p0.evaluate(async () => { document.body.getBoundingClientRect(); await document.fonts.ready; });
  const first = await p0.evaluate(rowsFromStage);
  const firstState = await p0.evaluate(() => {
    const st = document.querySelector('.atlas-stage')!.getBoundingClientRect();
    const fonts = [...document.fonts].map((f) => f.status);
    return `stage ${Math.round(st.width)}×${Math.round(st.height)}, row heights ${[...document.querySelectorAll('.atlas-index li')].map((e) => Math.round(e.getBoundingClientRect().height)).join('/')}, fonts ${fonts.filter((f) => f === 'loaded').length}/${fonts.length} loaded, sheets ${document.styleSheets.length}`;
  });
  await p0.locator('.atlas-stage').scrollIntoViewIfNeeded();
  const firstShot = await p0.screenshot();
  await noJs.close();

  const ctx = await browser.newContext(opts);
  if (use.mem) await ctx.addInitScript((m) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true }), use.mem);
  const page = await ctx.newPage();
  await seedConsent(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/models/*.glb', async (route) => { await gate; await route.continue().catch(() => {}); });
  const glb = new Set<string>();
  page.on('request', (r) => { if (/\.glb(\?|$)/.test(r.url())) glb.add(r.url()); });
  await page.goto('/ru/', { waitUntil: 'load' });
  await page.locator('.atlas-stage').scrollIntoViewIfNeeded(); // landscape phones: the canvas sleeps off-screen
  const read = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.atlas-index li')].map((e) => e.getBoundingClientRect().top),
    dots: [...document.querySelectorAll<HTMLElement>('.atlas-dot')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: e.dataset.visible }; }),
    // a line counts as shown when it is visible AND drawn: the intro draws them 0 → length (len = scaleX = its length in px)
    lines: [...document.querySelectorAll<HTMLElement>('.atlas-line')].map((e) => {
      const len = +((e.style.transform.match(/scaleX\(([-\d.e]+)\)/) ?? [])[1] ?? 0);
      return { v: e.dataset.visible === '1' && len > 4 ? '1' : '0', len };
    }),
    shown: getComputedStyle(document.querySelector('.atlas-ov')!).visibility === 'visible',
  }));
  const bad: string[] = [];
  // the poster state: its anchors are published (a dot is visible) and the index intro has run on the poster (it starts
  // with the first anchors, at the hydration: .atlas-ov[data-intro] play → done) while the GLB is held
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.atlas-dot')].some((d) => d.dataset.visible === '1')
    && !!document.querySelector('.atlas-ov[data-intro="done"]'), null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const before = await read();
  if ((await page.locator('.b3d-slot').getAttribute('data-status')) === 'ready') bad.push(`${label}: the model was ready before the poster was read`);
  // HR HM-04: on the poster (the model still loading) the overlay is shown with 5/5 lines and dots
  if (!before.shown) bad.push(`${label}: the overlay is still hidden on the poster`);
  if (before.lines.filter((l) => l.v === '1').length < 5) bad.push(`${label}: ${before.lines.filter((l) => l.v === '1').length}/5 lines drawn on the poster`);
  if (before.dots.filter((d) => d.v === '1').length < 5) bad.push(`${label}: ${before.dots.filter((d) => d.v === '1').length}/5 dots on the poster`);
  release();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.b3d-slot')?.dataset.status === 'ready', null, { timeout: 60_000 });
  // the runtime's OWN anchors: it publishes on its first projection, once the BVH is built — until then the store still
  // holds the poster's (source: 'poster') and «after» would compare the poster with itself
  await page.waitForFunction(() => { const a = (window as unknown as AnchorsProbe).__bmAnchors?.get(); return a?.mode === 'hero' && a.source !== 'poster'; }, null, { timeout: 30_000 });
  await page.waitForTimeout(500); // the 300 ms cross-fade, a few frames
  const after = await read();
  const live = await page.evaluate(rowsFromStage);
  // the LOD this case covers (lib/body3d/lod): phones LOD1, ≥ 768 LOD0 unless deviceMemory ≤ 4 (a test window: ≥ 8 or none)
  const want = (use.viewport?.width ?? 0) < 768 || (use.mem ?? 8) <= 4 ? 'lod1' : 'lod0';
  const got = [...glb].map((u) => (u.includes('.lod1.') ? 'lod1' : 'lod0'));
  if (got.length !== 1 || got[0] !== want) bad.push(`${label}: expected the ${want} model, loaded ${[...glb].map((u) => u.split('/').pop()).join(', ') || 'none'}`);
  label = `${label} ${want}`;
  const phone = (use.viewport?.width ?? 0) < 768;
  if (phone && firstOp.op.some((o) => o < 0.99)) bad.push(`${label}: rows hidden on the first frame of a phone (opacity ${firstOp.op.join('/')})`);
  if (!phone && firstOp.t < 2500 && firstOp.op.some((o) => o > 0.01)) bad.push(`${label}: rows visible on the first frame ≥ 768 before the LOD is known (opacity ${firstOp.op.join('/')})`);
  await ctx.close();
  // the swap, frame by frame: cold and from the cache everywhere; reduced motion, skip and the failsafe once per project
  for (const v of (extra ? ['cold', 'cache', 'reduce', 'skip', 'nointro'] : ['cold', 'cache']) as Variant[]) bad.push(...await heroSwap(browser, opts, use.mem, label, v));
  const firstBad = first.map((y, i) => ((phone || want === 'lod0') && Math.abs(live[i] - y) > 2 ? `${label}: row ${i + 1}, first frame (no JS) → model: ${Math.round(y)} → ${Math.round(live[i])} from the stage top` : '')).filter(Boolean);
  if (firstBad.length) {
    bad.push(...firstBad, `${label}: the first frame (no JS): ${firstState}`);
    await ti.attach(`first frame, no JS — ${label}`, { body: firstShot, contentType: 'image/png' });
  }
  before.rows.forEach((y, i) => { if (Math.abs(after.rows[i] - y) > 2) bad.push(`${label}: row ${i + 1}: ${Math.round(y)} → ${Math.round(after.rows[i])}`); });
  before.dots.forEach((d, i) => {
    const a = after.dots[i];
    if (d.v === '1' && a.v === '1' && Math.hypot(a.x - d.x, a.y - d.y) > 2) bad.push(`${label}: dot ${i + 1}: (${Math.round(d.x)}, ${Math.round(d.y)}) → (${Math.round(a.x)}, ${Math.round(a.y)})`);
    if (d.v !== a.v) bad.push(`${label}: dot ${i + 1}: visible ${d.v} on the poster → ${a.v} with the model`);
  });
  before.lines.forEach((l, i) => {
    const a = after.lines[i];
    if (l.v !== a.v) bad.push(`${label}: line ${i + 1}: shown ${l.v} on the poster → ${a.v} with the model`);
    if (l.v === '1' && a.len < 0.5 * l.len) bad.push(`${label}: line ${i + 1} redrawn with the model: ${Math.round(l.len)} → ${Math.round(a.len)} px`); // HM-04
  });
  return bad;
}

type Variant = 'cold' | 'cache' | 'reduce' | 'skip' | 'nointro';
/**
 * The swap itself, sampled every frame (rAF), on its own context (lead, RC-5): the model is shown only once the index intro
 * has drawn its lines on the poster (lib/body3d/heroIntro). On the last poster frame (data-status not yet «ready») the intro
 * is done and all 5 lines are whole — each line's end on its row (index left − 8, the row's centre) within 2 px —, the dots
 * of the first model frame within 2 px of the poster's (the sway starts at the reveal, eased in), no visible row moves more
 * than 2 px from its first visible frame, no line redrawn, CLS 0 (Chromium). Variants: cold (no cache), cache (a second
 * visit: Playwright's WebKit on Windows keeps no HTTP cache — there «at once» = fetched in ≤ 50 ms from the local server),
 * reduce (reduced motion: 150 ms intro), skip (a key during the intro), nointro (?debug=nointro — the failsafe: shown
 * ≤ 1.0 s after ready). The delay ready → shown is logged ([reveal]).
 */
async function heroSwap(browser: Browser, opts: Parameters<Browser['newContext']>[0], mem: number | undefined, label0: string, variant: Variant): Promise<string[]> {
  const label = `${label0} (${variant})`;
  const ctx = await browser.newContext({ ...opts, reducedMotion: variant === 'reduce' ? 'reduce' : 'no-preference' });
  if (mem) await ctx.addInitScript((m) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true }), mem);
  await ctx.addInitScript(() => localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' })));
  if (variant === 'cache') { // fills the HTTP cache
    const warm = await ctx.newPage();
    await warm.goto('/ru/', { waitUntil: 'load' });
    await warm.waitForFunction(() => document.querySelector<HTMLElement>('.b3d-slot')?.dataset.status === 'ready', null, { timeout: 60_000 });
    await warm.close();
  }
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as FrameProbe & AnchorsProbe;
    w.__hf = [];
    w.__cls = PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ? 0 : null; // WebKit: no layout-shift entries
    if (w.__cls !== null) new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls! += e.value; }).observe({ type: 'layout-shift', buffered: true });
    const tr = (e: HTMLElement) => { const m = e.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/); return m ? [+m[1], +m[2]] : null; };
    let last = '';
    const tick = () => {
      const stage = document.querySelector('.atlas-stage'), ov = document.querySelector<HTMLElement>('.atlas-ov'), index = document.querySelector<HTMLElement>('.atlas-index');
      if (stage && ov && index) {
        const s = stage.getBoundingClientRect().top;
        const li = [...document.querySelectorAll<HTMLElement>('.atlas-index li')];
        const f = {
          st: document.querySelector<HTMLElement>('.b3d-slot')?.dataset.status ?? '',
          src: w.__bmAnchors?.get().source ?? '3d',
          intro: ov.dataset.intro ?? '',
          shown: getComputedStyle(ov).visibility === 'visible',
          rows: li.map((e) => Math.round((e.getBoundingClientRect().top - s) * 10) / 10),
          op: li.map((e) => Math.round(+getComputedStyle(e).opacity * 100) / 100),
          dots: [...document.querySelectorAll<HTMLElement>('.atlas-dot')].map((e) => (e.dataset.visible === '1' && +getComputedStyle(e.firstElementChild ?? e).opacity > 0.5 ? '1' : '0')),
          dp: [...document.querySelectorAll<HTMLElement>('.atlas-dot')].map((e) => tr(e)),
          lines: [...document.querySelectorAll<HTMLElement>('.atlas-line')].map((e, i) => {
            const len = +((e.style.transform.match(/scaleX\(([-\d.e]+)\)/) ?? [])[1] ?? 0);
            const a = +((e.style.transform.match(/rotate\(([-\d.e]+)rad\)/) ?? [])[1] ?? 0), o = tr(e);
            // the line's end vs where draw() aims it: 8 px before its own row (RC-7 two columns: the row's left edge on the right
            // side, its right edge on the left side) at the row's first line (offsetTop = the anchor)
            const r = li[i], tx = index.offsetLeft + (r.dataset.side === 'L' ? r.offsetLeft + r.offsetWidth + 8 : r.offsetLeft - 8);
            const miss = o ? Math.round(Math.hypot(o[0] + len * Math.cos(a) - tx, o[1] + len * Math.sin(a) - (index.offsetTop + r.offsetTop)) * 10) / 10 : -1;
            return { v: e.dataset.visible === '1' && len > 4 && +getComputedStyle(e).opacity > 0.5 ? '1' : '0', len: Math.round(len), miss };
          }),
        };
        const k = JSON.stringify(f);
        if (k !== last) { last = k; w.__hf.push({ t: performance.now(), ...f } as Frame); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(variant === 'nointro' ? '/ru/?debug=nointro' : '/ru/', { waitUntil: 'load' });
  await page.locator('.atlas-stage').scrollIntoViewIfNeeded();
  if (variant === 'skip') { // a key while the intro plays → finish() → the intro ends at once
    await page.waitForFunction(() => document.querySelector('.atlas-ov')?.getAttribute('data-intro') === 'play', null, { timeout: 20_000 }).catch(() => {});
    await page.keyboard.press('Shift');
  }
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.b3d-slot')?.dataset.status === 'ready', null, { timeout: 60_000 });
  await page.waitForFunction(() => { const a = (window as unknown as AnchorsProbe).__bmAnchors?.get(); return a?.mode === 'hero' && a.source !== 'poster'; }, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const { F, cached, cls, rv } = await page.evaluate(() => ({
    F: (window as unknown as FrameProbe).__hf,
    cls: (window as unknown as FrameProbe).__cls,
    rv: (window as unknown as { __bmHeroReveal?: { introDoneAt?: number; readyAt?: number; shownAt?: number; late?: boolean } }).__bmHeroReveal ?? {},
    cached: performance.getEntriesByType('resource').filter((e) => /\.glb/.test(e.name)).every((e) => (e as PerformanceResourceTiming).transferSize === 0 || e.duration <= 50),
  }));
  await ctx.close();
  const bad: string[] = [];
  const delay = rv.readyAt !== undefined && rv.shownAt !== undefined ? Math.round(rv.shownAt - rv.readyAt) : null;
  const introAfter = rv.readyAt !== undefined && rv.introDoneAt !== undefined ? Math.round(rv.introDoneAt - rv.readyAt) : null;
  console.log(`[reveal] ${label}: ready → shown ${delay} ms${rv.late ? ' (failsafe)' : ''}, intro done ${introAfter} ms after ready`);
  if (delay === null) bad.push(`${label}: no reveal recorded (ready ${rv.readyAt}, shown ${rv.shownAt})`);
  if (variant === 'cache' && !cached) bad.push(`${label}: the model was neither cached nor there at once`);
  if (variant === 'nointro') {
    if (!rv.late) bad.push(`${label}: shown without the failsafe — the intro signal fired with ?debug=nointro`);
    if (delay !== null && delay > 1050) bad.push(`${label}: shown ${delay} ms after ready (failsafe 1.0 s)`);
  } else if (rv.late) bad.push(`${label}: shown by the failsafe (${delay} ms after ready), not by the intro`);
  if (cls !== null && cls > 0) bad.push(`${label}: CLS ${cls.toFixed(4)}`);
  const r0 = F.findIndex((f) => f.st === 'ready');
  const P = r0 > 0 ? F[r0 - 1] : null, Q = r0 >= 0 ? F[r0] : null; // the last poster frame, the first model frame
  if (!P || !Q) return [...bad, `${label}: no poster frame before ready (${F.length} frames)`];
  if (variant !== 'nointro') {
    if (P.intro !== 'done') bad.push(`${label}: the intro still «${P.intro}» on the last poster frame`);
    const whole = P.lines.filter((l) => l.v === '1' && l.miss >= 0 && l.miss <= 2).length;
    if (whole < 5) bad.push(`${label}: ${whole}/5 lines whole on the last poster frame (end off its row: ${P.lines.map((l) => l.miss).join(' / ')} px)`);
  }
  if (!P.shown) bad.push(`${label}: the overlay hidden on the last poster frame`);
  if (P.dots.filter((d) => d === '1').length < 5) bad.push(`${label}: ${P.dots.filter((d) => d === '1').length}/5 dots on the last poster frame`);
  const pp = F.slice(0, r0).filter((f) => f.src === 'poster').at(-1); // the last frame on the poster's own anchors
  if (pp) F.slice(0, r0).filter((f) => f.src !== 'poster' && f.t > pp.t).forEach((f) => {
    const d = Math.max(...f.dp.map((x, i) => (x && pp.dp[i] ? Math.hypot(x[0] - pp.dp[i]![0], x[1] - pp.dp[i]![1]) : 0)));
    if (d > 2) bad.push(`${label}: the runtime's anchors before the reveal moved a dot ${d.toFixed(1)} px off the poster's`);
  });
  const dd = P.dp.map((d, i) => (d && Q.dp[i] ? Math.hypot(Q.dp[i]![0] - d[0], Q.dp[i]![1] - d[1]) : 0));
  if (Math.max(...dd) > 2) bad.push(`${label}: dots moved at the swap: ${dd.map((x) => x.toFixed(1)).join(' / ')} px`);
  // no visible row moves: from its first frame with opacity > 0 on, every row within 2 px (≥ 768 hidden until placed)
  F[0].rows.forEach((_, i) => {
    const v0 = F.findIndex((f) => f.op[i] > 0.01);
    if (v0 < 0) { bad.push(`${label}: row ${i + 1} never shown`); return; }
    const dev = F.slice(v0).map((f) => Math.abs(f.rows[i] - F[v0].rows[i])), moved = Math.max(...dev);
    const at = F[v0 + dev.indexOf(moved)];
    if (moved > 2) bad.push(`${label}: row ${i + 1} moved ${moved.toFixed(1)} px after it became visible — ${F[v0].rows[i]} (${F[v0].st || 'before hydration'}, ${Math.round(F[v0].t)} ms, src ${F[v0].src}) → ${at.rows[i]} (${at.st}, ${Math.round(at.t)} ms, src ${at.src}, opacity ${at.op[i]})`);
  });
  F.slice(r0).forEach((f) => f.lines.forEach((l, i) => {
    if (P.lines[i].v === '1' && l.len < 0.5 * P.lines[i].len) bad.push(`${label}: line ${i + 1} redrawn after the swap: ${P.lines[i].len} → ${l.len} px`);
  }));
  return [...new Set(bad)];
}

/**
 * Back on the home page by a client navigation with the model live (AD): no hold, no intro over the live model — the slot is
 * «ready» on its first frame, the intro «done», the lines whole. And /booking is untouched by the hero reveal (lead): no
 * hold (no heroReveal probe, the poster never raised over the canvas), no sway (the anchors stand still). One Chromium and one
 * WebKit phone.
 */
test('3D: back on the home page with the model live the hero shows it at once; /booking has no reveal hold and no sway', async ({ page }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit phone');
  test.setTimeout(120_000);
  await seedConsent(page);
  await page.goto('/ru/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.b3d-slot')?.dataset.status === 'ready', null, { timeout: 60_000 });
  // to /booking by the hero's CTA (client navigation, the canvas lives on)
  await page.locator('a.btn-book:visible').first().click(); // the hero's CTA (the header's is hidden on phones)
  await page.waitForURL(/\/booking/);
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.b3d-slot[data-mode="booking"]')?.dataset.status === 'ready', null, { timeout: 60_000 });
  await page.waitForTimeout(700); // the booking brings the model back to the front view (450 ms) — then it stands still
  const booking = await page.evaluate(async () => {
    const slot = document.querySelector<HTMLElement>('.b3d-slot[data-mode="booking"]')!;
    const a0 = (window as unknown as { __bmAnchors: { get: () => { zones: { zoneId: string; x: number; y: number }[] } } }).__bmAnchors.get().zones.map((z) => [z.x, z.y]);
    let raised = false;
    const statuses = new Set<string>();
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) {
      await new Promise((r) => requestAnimationFrame(r));
      raised ||= !!(slot.querySelector<HTMLElement>('.b3d-poster')?.style.zIndex);
      statuses.add(slot.dataset.status ?? '');
    }
    const a1 = (window as unknown as { __bmAnchors: { get: () => { zones: { zoneId: string; x: number; y: number }[] } } }).__bmAnchors.get().zones.map((z) => [z.x, z.y]);
    const drift = Math.max(0, ...a1.map((p, i) => (a0[i] ? Math.hypot(p[0] - a0[i][0], p[1] - a0[i][1]) : 0)));
    return { raised, statuses: [...statuses], drift };
  });
  expect(booking.raised, '/booking: the poster raised over the canvas').toBe(false);
  expect(booking.statuses, '/booking: the slot status').toEqual(['ready']);
  expect(booking.drift, '/booking: the model sways (anchors drift px in 1.2 s)').toBeLessThanOrEqual(0.5);
  // back home (client navigation): the hero mounts with the model live
  await page.evaluate(() => {
    const w = window as unknown as { __back: { st: string; intro: string; miss: number }[] };
    w.__back = [];
    const tick = () => {
      const slot = document.querySelector<HTMLElement>('.b3d-slot[data-mode="hero"]'), ov = document.querySelector<HTMLElement>('.atlas-ov'), index = document.querySelector<HTMLElement>('.atlas-index');
      if (slot && ov && index) {
        const li = [...document.querySelectorAll<HTMLElement>('.atlas-index li')];
        const miss = Math.max(...[...document.querySelectorAll<HTMLElement>('.atlas-line')].map((e, i) => {
          const t = e.style.transform, len = +((t.match(/scaleX\(([-\d.e]+)\)/) ?? [])[1] ?? 0), a = +((t.match(/rotate\(([-\d.e]+)rad\)/) ?? [])[1] ?? 0);
          const m = t.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/);
          // RC-7: the atlas has two columns — a line ends 8 px before its own row: the row's left edge on the right side, its
          // right edge on the left side (HeroAtlas draw(); .atlas-line[i] ↔ li[i], both from ZONES)
          const r = li[i], tx = index.offsetLeft + (r.dataset.side === 'L' ? r.offsetLeft + r.offsetWidth + 8 : r.offsetLeft - 8);
          return m && e.dataset.visible === '1' ? Math.hypot(+m[1] + len * Math.cos(a) - tx, +m[2] + len * Math.sin(a) - (index.offsetTop + r.offsetTop)) : 0;
        }));
        w.__back.push({ st: slot.dataset.status ?? '', intro: ov.dataset.intro ?? '', miss: Math.round(miss * 10) / 10 });
      }
      if (w.__back.length < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goBack();
  await page.waitForFunction(() => ((window as unknown as { __back?: unknown[] }).__back?.length ?? 0) >= 30, null, { timeout: 30_000 });
  const back = await page.evaluate(() => (window as unknown as { __back: { st: string; intro: string; miss: number }[] }).__back);
  const drawn = back.filter((f) => f.intro === 'done');
  expect(back.filter((f) => f.st !== 'ready'), 'back home: frames with the live model held under the poster').toEqual([]);
  expect(back.filter((f) => f.intro === 'play'), 'back home: the intro replayed over the live model').toEqual([]);
  expect(drawn.length, 'back home: the index drawn').toBeGreaterThan(0);
  expect(Math.max(...drawn.map((f) => f.miss)), 'back home: a line end off its row (px)').toBeLessThanOrEqual(2);
});

/**
 * The hero's first frames, sampled from the document's creation (init script + rAF — not after load; lead + AD, RC-5): the
 * first style pass can miss rules the next one applies, and a transition then shows the difference.
 *  (a) ≥ 768, LOD0 and LOD1 (deviceMemory 2): until .atlas-index[data-placed] every index row has opacity 0 on every frame
 *      (the li opacity transition ran 1 → 0: the rows showed for 2–3 frames on the LOD0 positions, 16 of 24 loads);
 *  (b) reduced motion, 768 / 1280 / a 440 phone: the stage, the slot and the index stand still — every frame within 0.5 px
 *      of the first (the * 120 ms reset animated them: 3 px).
 * Eight loads per case (the early pass does not come on every load: 1–2 of 6 in Chromium on d4a68f1, 0 in WebKit). One Chromium and one WebKit project.
 */
type Early = { t: number; placed: boolean; op: number[]; box: number[][] };
const EARLY_A = [{ w: 768, h: 1024, reduce: true }, { w: 1280, h: 800, reduce: true, mem: 2 }, { w: 768, h: 1024, reduce: false }, { w: 1440, h: 789, reduce: false, mem: 2 }];
const EARLY_B = [{ w: 768, h: 1024 }, { w: 1280, h: 800 }, { w: 440, h: 763, phone: true }];
const LOADS = 8;
async function earlyFrames(browser: Browser, baseURL: string, c: { w: number; h: number; reduce: boolean; mem?: number; phone?: boolean }): Promise<Early[]> {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, baseURL, reducedMotion: c.reduce ? 'reduce' : 'no-preference',
    ...(c.phone ? { deviceScaleFactor: 3, hasTouch: true } : {}) });
  if (c.mem) await ctx.addInitScript((m) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true }), c.mem);
  await ctx.addInitScript(() => {
    localStorage.setItem('bm.consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, at: 'e2e' }));
    const w = window as unknown as { __early: Early[] };
    w.__early = [];
    const r = (sel: string) => { const e = document.querySelector(sel); if (!e) return [-1, -1, -1, -1]; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((x) => Math.round(x * 10) / 10); };
    const tick = () => {
      const index = document.querySelector<HTMLElement>('.atlas-index');
      if (index) w.__early.push({ t: Math.round(performance.now()), placed: index.dataset.placed !== undefined,
        op: [...index.querySelectorAll('li')].map((e) => Math.round(+getComputedStyle(e).opacity * 100) / 100),
        box: [r('.atlas-stage'), r('.atlas-stage .b3d-slot'), r('.atlas-index')] });
      if (performance.now() < 2500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage();
  await page.goto('/ru/', { waitUntil: 'load' });
  await page.waitForTimeout(Math.max(0, 2600 - (await page.evaluate(() => performance.now()))));
  const F = await page.evaluate(() => (window as unknown as { __early: Early[] }).__early);
  await ctx.close();
  return F;
}
test('home hero, first frames: ≥ 768 no index row before it is placed; under reduced motion the stage, the slot and the index stand still', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(600_000);
  const baseURL = ti.project.use.baseURL!;
  const bad: string[] = [];
  for (const c of EARLY_A) {
    let hit = 0, worst = 0;
    for (let k = 0; k < LOADS; k++) {
      const F = await earlyFrames(browser, baseURL, c);
      if (!F.some((f) => f.placed)) { bad.push(`(a) ${c.w}×${c.h}${c.mem ? ' 2 GB' : ''}: never placed in 2.5 s`); continue; }
      const early = F.filter((f) => !f.placed && f.op.some((o) => o > 0));
      if (early.length) { hit++; worst = Math.max(worst, ...early.flatMap((f) => f.op)); }
    }
    console.log(`[early] (a) ${c.w}×${c.h}${c.mem ? ' 2 GB' : ''}${c.reduce ? ' reduce' : ''}: a row visible before placed in ${hit}/${LOADS} loads (max opacity ${worst})`);
    if (hit) bad.push(`(a) ${c.w}×${c.h}${c.mem ? ' 2 GB' : ''}${c.reduce ? ' reduce' : ''}: a row visible before data-placed in ${hit}/${LOADS} loads (opacity up to ${worst})`);
  }
  for (const c of EARLY_B) {
    let worst = 0, hit = 0;
    for (let k = 0; k < LOADS; k++) {
      const F = await earlyFrames(browser, baseURL, { ...c, reduce: true });
      const f0 = F.find((f) => f.box.every((b) => b[2] > 0));
      if (!f0) { bad.push(`(b) ${c.w}×${c.h}: no stage`); continue; }
      const d = Math.max(...F.slice(F.indexOf(f0)).flatMap((f) => f.box.flatMap((b, i) => b.map((v, j) => Math.abs(v - f0.box[i][j])))));
      worst = Math.max(worst, d); if (d > 0.5) hit++;
    }
    console.log(`[early] (b) ${c.w}×${c.h} reduce: stage / slot / index moved > 0.5 px in ${hit}/${LOADS} loads (max ${worst.toFixed(1)} px)`);
    if (hit) bad.push(`(b) ${c.w}×${c.h} reduce: the stage / slot / index moved up to ${worst.toFixed(1)} px in ${hit}/${LOADS} loads`);
  }
  expect(bad).toEqual([]);
});

/** Tablets and desktop windows (the 3D slot up to 880–1240 px high: the biggest jump) — on one Chromium and one WebKit project. */
const HANDOVER_WIDE = [[768, 1024], [1024, 1366], [1280, 800], [1440, 789], [1920, 969], [1024, 1366, 2]]; // [w, h, deviceMemory]
test('home hero: the poster → model handover keeps the index in place (first frame, poster, model: rows and dots Δ ≤ 2 px, the lines already on the poster)', async ({ browser }, ti) => {
  test.skip(!ti.project.name.startsWith('A-'), 'level A phones');
  const wide = ['A-pixel-7', 'A-iphone-16'].includes(ti.project.name);
  test.setTimeout(wide ? 1_200_000 : 360_000);
  const u = ti.project.use as Use;
  const bad = await heroHandover(browser, u, ti.project.name, ti, true);
  if (wide) for (const [width, height, mem] of HANDOVER_WIDE) bad.push(...await heroHandover(browser, { viewport: { width, height }, baseURL: u.baseURL, mem }, `${width}×${height}${mem ? ` ${mem} GB` : ''}`, ti, width === 1280 && !mem));
  if (wide) { // scripting off (≥ 768): no LOD switch will come → the rows are shown at once, not after the 8 s failsafe
    const off = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: u.baseURL, javaScriptEnabled: false });
    const p = await off.newPage();
    await p.goto('/ru/', { waitUntil: 'load' });
    const op = await p.locator('.atlas-index li').evaluateAll((li) => li.map((e) => +getComputedStyle(e).opacity));
    if (op.some((o) => o < 0.99)) bad.push(`1280×800, JavaScript off: rows hidden (opacity ${op.join('/')})`);
    await off.close();
  }
  expect(bad).toEqual([]);
});

/**
 * RC-6 (BD + AD): the index rows sit on their FIRST line (translateY(-0.6em)), so a label that wraps — «03 Брюшная полость» in a
 * fallback font while the web font is late (2 lines, 31.7 px; Manrope: 1 line) — does not move its top when the font arrives
 * (it jumped 8.0 px with -50 %). Font-independent check: the first line's centre = the anchor (offsetTop) within 1.5 px, as
 * rendered and with the row forced narrow (2+ lines).
 */
test('home hero: index rows sit on their first line — a wrapped label keeps its place (RC-6)', async ({ page }) => {
  await seedConsent(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/models/*.glb', () => {}); // the poster is enough: rows placed by its anchors
  await page.goto('/ru/', { waitUntil: 'load' });
  await page.locator('.atlas-stage').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !!document.querySelector('.atlas-ov[data-intro="done"]'), null, { timeout: 20_000 });
  const off = await page.evaluate(() => {
    const idx = document.querySelector<HTMLElement>('.atlas-index')!, out: string[] = [];
    // RC-8: the word's first line is on the anchor; on phones ≥ 360 the number stands over the word
    const firstLineOff = (li: HTMLElement) => {
      const word = li.querySelector<HTMLElement>('span')!, r = document.createRange(); r.selectNodeContents(word);
      const first = [...r.getClientRects()].filter((x) => x.width > 0).sort((a, b) => a.top - b.top)[0];
      const anchor = idx.getBoundingClientRect().top + li.offsetTop;
      return { d: (first.top + first.bottom) / 2 - anchor, lines: Math.round(word.getBoundingClientRect().height / parseFloat(getComputedStyle(li).lineHeight)) };
    };
    for (const li of idx.querySelectorAll<HTMLElement>('li')) {
      const a = firstLineOff(li);
      // force a wrap whatever the font: the label gets 55 % of its own one-line width and may break inside a word
      // (a fixed 64 px did not wrap the one-word labels, a flex item does not shrink below its longest word)
      const label = li.querySelector<HTMLElement>('span')!, num = li.querySelector<HTMLElement>('b')!;
      const stacked = getComputedStyle(li).display === 'grid'; // RC-8: the number over the word — the word alone sets the width
      const narrow = (stacked ? 0 : num.getBoundingClientRect().width + parseFloat(getComputedStyle(li).columnGap || '0')) + Math.max(12, label.getBoundingClientRect().width * 0.55);
      li.style.right = 'auto'; li.style.width = `${narrow}px`; label.style.overflowWrap = 'anywhere';
      const b = firstLineOff(li);
      li.style.right = ''; li.style.width = ''; label.style.overflowWrap = '';
      const name = li.textContent!.trim();
      if (Math.abs(a.d) > 1.5) out.push(`«${name}»: first line ${a.d.toFixed(1)} px off its anchor (${a.lines} line)`);
      if (b.lines < 2) out.push(`«${name}»: did not wrap at ${Math.round(narrow)} px (test setup)`);
      else if (Math.abs(b.d) > 1.5) out.push(`«${name}» wrapped in ${b.lines} lines: first line ${b.d.toFixed(1)} px off its anchor`);
    }
    return out;
  });
  expect(off).toEqual([]);
});

/**
 * RC-6 (lead + AD): no loading badge over the hero figure (it was cut by the screen edge on 320 and hid line 02 / dot 03);
 * the caption under the model carries the progress while the model loads — tabular figures, aria-hidden (LiveRegion
 * announces the load) — and «drag to rotate» once the model is there, in the same one-line box (CLS 0).
 */
test('home hero: the loading status is in the caption, not over the figure (RC-6)', async ({ page }) => {
  test.setTimeout(90_000);
  await seedConsent(page);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/models/*.glb', async (route) => { await held; await route.continue().catch(() => {}); });
  await page.goto('/ru/', { waitUntil: 'load' });
  const cap = page.locator('.atlas > .cap');
  // RC-7: both texts live in the caption's one cell, only one is visible
  await expect(cap.locator('.cap__status')).toBeVisible();
  await expect(cap.locator('.cap__status')).toHaveText(/%/);
  await expect(cap.locator('.cap__hint')).toBeHidden();
  await expect(cap).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('.atlas .b3d-loader').count(), 'no badge over the hero figure').toBe(0);
  expect(await cap.evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain('tabular-nums');
  const h0 = (await cap.boundingBox())!.height;
  release();
  await settle3D(page);
  test.skip((await page.locator('.atlas .b3d-slot[data-mode2d], .atlas .b3d-slot[data-fallback]').count()) > 0, 'this device keeps the poster (the caption is hidden there)');
  await expect(cap.locator('.cap__hint')).toBeVisible();
  await expect(cap.locator('.cap__status')).toBeHidden();
  expect(await cap.getAttribute('aria-hidden')).toBeNull();
  expect(Math.abs((await cap.boundingBox())!.height - h0), 'the caption keeps its height (CLS 0)').toBeLessThanOrEqual(0.5);
});

/**
 * RC-6 (lead): the model fails (GLB 404 → status error, the poster stays) — the caption must not promise a rotation either:
 * it is hidden by the fallback rule (sections.css, .atlas:has(.b3d-slot[data-status="error"…])) with its box kept (CLS 0),
 * and there is still no badge over the figure.
 */
test('home hero: the model fails to load — no «drag to rotate», the caption keeps its box (RC-6)', async ({ page }) => {
  await seedConsent(page);
  await page.route('**/models/*.glb', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/ru/', { waitUntil: 'load' });
  const cap = page.locator('.atlas > .cap');
  const h0 = (await cap.boundingBox())!.height;
  await page.waitForFunction(() => { const s = document.querySelector<HTMLElement>('.atlas .b3d-slot'); return !!s && (s.dataset.status === 'error' || !!s.dataset.mode2d || !!s.dataset.fallback); }, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
  expect(await cap.evaluate((e) => getComputedStyle(e).visibility), 'the caption is hidden on the fallback poster').toBe('hidden');
  expect(Math.abs((await cap.boundingBox())!.height - h0), 'its box stays (CLS 0)').toBeLessThanOrEqual(0.5);
  expect(await page.locator('.atlas .b3d-loader').count(), 'no badge over the hero figure').toBe(0);
});

/**
 * RC-6 (BD): with the web font missing each engine draws its own fallback — Chromium the metric-adjusted Arial («manrope
 * Fallback», «03 Брюшная полость» in 1 line), WebKit without the adjusted face (2 lines, 31.7 px). Whatever wraps: each row's
 * first line on its anchor (±1.5 px) and no two rows touching (a second line hangs down — 01 → 02 are only 26 px apart).
 * The woff2 is blocked for good (= a font that never arrives).
 */
test('home hero: rows in the fallback font — first line on the anchor, no two rows touching (RC-6)', async ({ page }) => {
  await seedConsent(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/\.woff2(\?|$)/, (route) => route.abort());
  await page.route('**/models/*.glb', () => {});
  await page.goto('/ru/', { waitUntil: 'load' });
  await page.locator('.atlas-stage').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !!document.querySelector('.atlas-ov[data-intro="done"]'), null, { timeout: 20_000 });
  const bad = await page.evaluate(() => {
    const idx = document.querySelector<HTMLElement>('.atlas-index')!, out: string[] = [];
    const rows = [...idx.querySelectorAll<HTMLElement>('li')].map((li) => {
      const r = document.createRange(); r.selectNodeContents(li);
      const rects = [...r.getClientRects()].filter((x) => x.width > 0);
      const wr = document.createRange(); wr.selectNodeContents(li.querySelector('span')!); // RC-8: the word's first line is on the anchor; the number may stand over it
      const first = [...wr.getClientRects()].filter((x) => x.width > 0).sort((a, b) => a.top - b.top)[0];
      return { name: li.textContent!.trim(), side: li.dataset.side ?? '', d: (first.top + first.bottom) / 2 - (idx.getBoundingClientRect().top + li.offsetTop), top: Math.min(...rects.map((x) => x.top)), bottom: Math.max(...rects.map((x) => x.bottom)) };
    });
    rows.forEach((x, i) => {
      if (Math.abs(x.d) > 1.5) out.push(`«${x.name}»: first line ${x.d.toFixed(1)} px off its anchor`);
      // RC-7: two atlas columns — a row's neighbour is the next one on the SAME side
      const next = rows.slice(i + 1).find((r) => r.side === x.side);
      if (next && x.bottom > next.top - 2) out.push(`«${x.name}» touches «${next.name}» (${(x.bottom - next.top).toFixed(1)} px)`);
    });
    return out;
  });
  expect(bad).toEqual([]);
});

/**
 * RC-7 (FB review): the figure centred as DRAWN, not as computed. A screenshot of the 3D slot with everything else in the hero
 * hidden (the index, the overlay, the caption, the switch row, the text): the columns that differ from the background give
 * the figure's extent → its centre vs the screen (phones, tablets) / column (desktop) centre. Catches a drift of the
 * 0.288…0.703 calibration behind the CSS (another GLB, camera, poster, pose or LOD) that the geometry tests cannot see.
 */
async function drawnFigureCentre(page: Page, ref: 'hero' | 'stage') {
  const hide = await page.addStyleTag({ content: '.atlas-ov, .atlas-index, .atlas > .cap, .atlas > .cap > span, .atlas-top, .hero__text, header { visibility: hidden !important; }' });
  // the hide must be PAINTED before the capture: in WebKit with the live WebGL canvas it came later than a 120 ms pause and the
  // terracotta label numbers 01–05 (on both sides of the figure) read as «red figure» — 337 px instead of 258, the centre in
  // place (FB's d002826 run; AD's probe rc7_reveal_scale.cjs: 258 = 258 on poster and model once painted). Two frames + 250 ms
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.atlas-index b')!).visibility), 'the index hidden before the capture').toBe('hidden');
  // the slot ∩ the stage: on desktop the slot (660 px on 1440) is wider than its column and reaches up into the header (its
  // terracotta CTA read as «figure»); the figure itself lies inside the stage (head 0.02 × --sh below its top)
  const box = await page.evaluate((r) => {
    const s = document.querySelector('.atlas-stage .b3d-slot')!.getBoundingClientRect(), st = document.querySelector('.atlas-stage')!.getBoundingClientRect(), b = document.querySelector(r === 'hero' ? '.hero' : '.atlas-stage')!.getBoundingClientRect();
    const l = Math.max(s.left, st.left), t = Math.max(s.top, st.top), rr = Math.min(s.right, st.right), bb = Math.min(s.bottom, st.bottom);
    return { x: l + scrollX, y: t + scrollY, w: rr - l, h: bb - t, slotW: s.width, ref: b.left + b.width / 2 + scrollX };
  }, ref);
  const png = await page.screenshot({ fullPage: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  await hide.evaluate((e) => (e as Element).remove());
  const ext = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
    const { data, width, height } = x.getImageData(0, 0, c.width, c.height);
    // the model's saturated red (the muscles; Hard Reviewer's center_px.py: r > 150, g < 140, b < 140, r − g > 50): a column
    // counts when it has ≥ 3 such pixels (every second row) — the figure's left and right edges, the white tendons aside
    let min = width, max = -1;
    for (let col = 0; col < width; col++) {
      let n = 0;
      for (let row = 0; row < height && n < 3; row += 2) { const i = (row * width + col) * 4; if (data[i] > 150 && data[i + 1] < 140 && data[i + 2] < 140 && data[i] - data[i + 1] > 50) n++; }
      if (n >= 3) { min = Math.min(min, col); max = Math.max(max, col); }
    }
    return { min, max, width };
  }, png.toString('base64'));
  const k = ext.width / box.w; // screenshot px per CSS px
  // FB: an empty slot (no poster, an empty / black canvas) has no red at all — its «centre» would be the slot's own, ≈ 1.6 px
  // off the screen centre, and pass. The figure must be found and plausibly wide: 0.30…0.55 of the slot (calibrated 0.415; the
  // build's poster and settled model measure 0.39)
  const w = (ext.max - ext.min) / k, found = ext.max > ext.min && w >= 0.3 * box.slotW && w <= 0.55 * box.slotW;
  return { off: Math.round((box.x + (ext.min + ext.max) / 2 / k - box.ref) * 10) / 10, w: Math.round(w), slotW: Math.round(box.slotW), found };
}

const PIXEL_SIZES = [[390, 844], [768, 1024], [1440, 900]];
test('home hero: the DRAWN figure is centred — on the poster and on the model, by its red pixels, ±2 px (RC-7)', async ({ browser }, ti) => {
  test.skip(!['A-pixel-7', 'A-iphone-16'].includes(ti.project.name), 'one Chromium and one WebKit project');
  test.setTimeout(240_000);
  const bad: string[] = [], seen: string[] = [];
  for (const [width, height] of PIXEL_SIZES) {
    const phone = width < 768, desktop = width >= 1024 && width > height;
    const ctx = await browser.newContext({ viewport: { width, height }, baseURL: ti.project.use.baseURL, reducedMotion: 'reduce', hasTouch: phone });
    const page = await ctx.newPage();
    await seedConsent(page);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/models/*.glb', async (route) => { await held; await route.continue().catch(() => {}); });
    await page.goto('/ru/', { waitUntil: 'load' });
    await page.locator('.atlas-stage').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!document.querySelector('.atlas-ov[data-intro="done"]'), null, { timeout: 20_000 });
    const label = `${width}×${height}`, ref = desktop ? 'stage' : 'hero';
    const poster = await drawnFigureCentre(page, ref);
    seen.push(`${label} poster ${poster.off} px (figure ${poster.w} px)`);
    if (!poster.found) bad.push(`${label}: no figure drawn on the poster (red extent ${poster.w} px of a ${poster.slotW} px slot)`);
    else if (Math.abs(poster.off) > 2) bad.push(`${label}: the poster figure ${poster.off} px off the ${desktop ? 'column' : 'screen'} centre`);
    release();
    await settle3D(page);
    const shown = await page.evaluate(() => { const s = document.querySelector<HTMLElement>('.atlas .b3d-slot')!; return s.dataset.status === 'ready' && !s.dataset.fallback && !s.dataset.mode2d; });
    if (shown) {
      await page.waitForTimeout(900); // the cross-fade
      // FB, d002826 WebKit 1440: one capture read the model 337 px wide (poster 258), while the handover test (dots at the
      // reveal) passed — a transient (the canvas / camera still settling after the reveal). Measure until two captures 500 ms
      // apart agree (width ±2 px, centre ±0.5 px); a real scale jump stays and fails below
      let model = await drawnFigureCentre(page, ref);
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(500);
        const next = await drawnFigureCentre(page, ref);
        const steady = Math.abs(next.w - model.w) <= 2 && Math.abs(next.off - model.off) <= 0.5;
        model = next;
        if (steady) break;
      }
      seen.push(`${label} model ${model.off} px (figure ${model.w} px)`);
      if (!model.found) bad.push(`${label}: no figure drawn on the model (red extent ${model.w} px of a ${model.slotW} px slot)`);
      else if (Math.abs(model.off) > 2) bad.push(`${label}: the model ${model.off} px off the ${desktop ? 'column' : 'screen'} centre`);
    }
    await ctx.close();
  }
  console.log(`drawn figure centres (${ti.project.name}): ${seen.join('; ')}`);
  expect(bad).toEqual([]);
});

/** RC-7 (FB review, MINOR): the model sways ON THE SPOT (no reduced motion: the ±20° sway runs) — the drawn centre over a
 * sway cycle (9 s) stays put; the silhouette's extent changes a little with the turned arms. */
test('home hero: the model sways on the spot — the drawn centre over a sway cycle (RC-7)', async ({ browser }, ti) => {
  test.skip(ti.project.name !== 'A-pixel-7', 'one Chromium project (WebGL)');
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: ti.project.use.baseURL, hasTouch: true });
  const page = await ctx.newPage();
  await seedConsent(page);
  await page.goto('/ru/', { waitUntil: 'load' });
  await page.locator('.atlas-stage').scrollIntoViewIfNeeded();
  await settle3D(page);
  test.skip(await page.evaluate(() => { const s = document.querySelector<HTMLElement>('.atlas .b3d-slot')!; return s.dataset.status !== 'ready' || !!s.dataset.fallback || !!s.dataset.mode2d; }), 'no model on this run');
  await page.waitForTimeout(1500); // the sway eases in over 0.6 s
  // lead: 3 frames across the 9 s cycle, the drawn centre's spread ≤ 4 px
  const offs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await drawnFigureCentre(page, 'hero');
    expect(c.found, `frame ${i + 1}: the model is drawn (red extent ${c.w} px of a ${c.slotW} px slot)`).toBe(true);
    offs.push(c.off); await page.waitForTimeout(3000);
  }
  const spread = Math.round((Math.max(...offs) - Math.min(...offs)) * 10) / 10;
  console.log(`sway: drawn centre offsets ${offs.join(' / ')} px, spread ${spread} px`);
  expect(spread, `the drawn centre during the sway: ${offs.join(' / ')} px`).toBeLessThanOrEqual(4);
  await ctx.close();
});
