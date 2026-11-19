import { devices, expect, test, type Page } from '@playwright/test';
import { VIEWER_IDLE_MS, VIEWER_LEVEL_MS } from '../src/lib/body3d/viewer-timing';

const slot = (page: Page) => page.locator('.b3d-slot[data-mode="viewer"]');
const canvas = (page: Page) => slot(page).locator('canvas');
const zone = (page: Page, id: string) => page.locator(`.b2d-zone[data-zone-id="${id}"]`);
const callout = (page: Page, id: string) => page.locator(`.body-viewer__callouts [data-zone="${id}"] .body-viewer__label`);
const outline = (page: Page) => page.evaluate(() => window.__bm3d?.outline?.());
const view = (page: Page) => page.evaluate(() => window.__bm3d!.view!());
const yaw = async (page: Page) => (await view(page)).yaw;
const distance = ({ camera, target }: Awaited<ReturnType<typeof view>>) => Math.hypot(...camera.map((n, i) => n - target[i]));
const elevation = ({ camera, target }: Awaited<ReturnType<typeof view>>) =>
  Math.asin((camera[1] - target[1]) / Math.hypot(...camera.map((n, i) => n - target[i])));
const azimuth = ({ camera, target }: Awaited<ReturnType<typeof view>>) =>
  Math.atan2(camera[0] - target[0], camera[2] - target[2]);
const forbidden = 'header, footer, form, dialog, .cookie, .book-floating, .booking, .b3d-pin, [data-testid="b2d"]';

async function expectFullscreen(page: Page, locale: string, path = 'body-model') {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator(forbidden)).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(path === 'body-model-auto' ? 4 : 2);
  await expect(slot(page)).not.toHaveAttribute('data-mode2d');
  await expect(page.locator('a')).toHaveCount(1);
  await expect(page.locator('.body-viewer__languages [aria-current="page"]')).toHaveText(locale.toUpperCase());
  await expect(page.getByRole('link')).toHaveAttribute('href', `/${locale === 'ru' ? 'en' : 'ru'}/${path}/`);
  expect(await page.evaluate(() => {
    const { top, bottom, width, height } = document.querySelector('.b3d-slot')!.getBoundingClientRect();
    return bottom >= innerHeight - 1 && bottom <= innerHeight + 1 && width === innerWidth &&
      height >= innerHeight * 0.65 &&
      document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth &&
      Array.from(document.querySelectorAll('.body-viewer__controls :is(button, a)')).every((control) => {
        const r = control.getBoundingClientRect();
        return r.height >= 44 && r.width >= 44 && r.top >= 0 && r.bottom <= top && r.left >= 0 && r.right <= innerWidth;
      });
  })).toBe(true);
}

async function liveModel(page: Page) {
  await expect(slot(page)).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__bm3d?.pick))).toBe(true);
  return (await canvas(page).boundingBox())!;
}

async function chestPoint(page: Page) {
  return page.evaluate(() => {
    const r = document.querySelector('.b3d-slot canvas')!.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    for (let fraction = 0.20; fraction < 0.6; fraction += 0.015) {
      const y = Math.round(r.top + r.height * fraction);
      if (window.__bm3d?.pick?.(x, y) === 'chest') return { x, y };
    }
    return null;
  });
}

test('RU viewer fills the desktop, supports mouse gestures and carries highlights across models', async ({ page }) => {
  const response = await page.goto('/ru/body-model');
  expect(response?.ok()).toBe(true);
  expect(response?.request().redirectedFrom()?.url()).toMatch(/\/ru\/body-model$/);
  await expect(page).toHaveURL(/\/ru\/body-model\/$/);
  const { x, y, width, height } = await liveModel(page);
  await expectFullscreen(page, 'ru');
  await expect(callout(page, 'chest')).toBeVisible();
  await expect(callout(page, 'chest')).toHaveText('Грудной отдел');
  await expect(callout(page, 'lumbar')).toBeHidden();
  const cx = x + width / 2;
  const cy = y + height / 2;
  const chest = await chestPoint(page);
  expect(chest).not.toBeNull();
  await page.mouse.click(chest!.x, chest!.y);
  await expect.poll(() => outline(page)).toMatch(/^(screen|veil)$/);
  const female = page.getByRole('button', { name: 'Женщина' });
  await female.click();
  await expect(female).toHaveAttribute('aria-pressed', 'true');
  await liveModel(page);
  await expect.poll(() => outline(page)).toMatch(/^(screen|veil)$/);

  await page.getByRole('button', { name: 'Мужчина' }).click();
  await liveModel(page);
  await expect.poll(() => outline(page)).toMatch(/^(screen|veil)$/);
  await page.mouse.click(chest!.x, chest!.y);
  await expect.poll(() => outline(page)).toBe('off');

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + height / 2, cy, { steps: 8 });
  await page.mouse.up();
  await expect(callout(page, 'lumbar')).toBeVisible();
  await expect(callout(page, 'lumbar')).toHaveText('Поясничный отдел');
  await expect(callout(page, 'chest')).toBeHidden();
  await expect.poll(() => outline(page)).toBe('off');
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => distance(await view(page))).toBeLessThan(2.8);
  expect(await yaw(page)).toBe(0);
});

test('auto viewer levels the tilted back view before rotating again', async ({ page }) => {
  await page.clock.install();
  const response = await page.goto('/ru/body-model-auto');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/ru\/body-model-auto\/$/);
  const { x, y, width, height } = await liveModel(page);
  await expectFullscreen(page, 'ru', 'body-model-auto');
  await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(238, 233, 226)');
  await expect.poll(() => yaw(page)).toBeGreaterThan(0.025);
  const initialElevation = elevation(await view(page));
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  const stopped = await yaw(page);
  await page.clock.fastForward(VIEWER_IDLE_MS + 100);
  expect(await yaw(page)).toBe(stopped);
  await page.mouse.move(x + width / 2 + height / 2, y + height * 0.62, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await view(page)).camera[2]).toBeLessThan(-0.5);
  await page.clock.fastForward(VIEWER_IDLE_MS / 2);
  expect(await yaw(page)).toBe(stopped);

  const beforeWheel = distance(await view(page));
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => distance(await view(page))).toBeLessThan(beforeWheel - 0.05);
  await page.clock.runFor(1500);
  const tilted = await view(page);
  expect(Math.abs(elevation(tilted) - initialElevation)).toBeGreaterThan(0.3);
  await page.clock.fastForward(VIEWER_IDLE_MS / 2);
  expect(await yaw(page)).toBe(stopped);
  expect(elevation(await view(page))).toBeCloseTo(elevation(tilted), 3);

  await page.clock.fastForward(VIEWER_IDLE_MS / 2);
  await page.clock.runFor(VIEWER_LEVEL_MS / 3);
  expect(await yaw(page)).toBe(stopped);
  expect(Math.abs(elevation(await view(page)) - initialElevation)).toBeLessThan(Math.abs(elevation(tilted) - initialElevation));
  await expect.poll(() => yaw(page)).toBeGreaterThan(stopped + 0.025);
  const resumed = await view(page);
  expect(elevation(resumed)).toBeCloseTo(initialElevation, 5);
  expect(Math.cos(azimuth(resumed) - azimuth(tilted))).toBeCloseTo(1, 5);
  expect(distance(resumed)).toBeCloseTo(distance(tilted), 5);

  await slot(page).press('Space');
  const keyboardPause = await yaw(page);
  await page.clock.fastForward(VIEWER_IDLE_MS / 2);
  expect(await yaw(page)).toBe(keyboardPause);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('link', { name: /^EN\./ }).click();
  await expect(page).toHaveURL(/\/en\/body-model-auto\/$/);
  await liveModel(page);
  await expectFullscreen(page, 'en', 'body-model-auto');
  await page.clock.fastForward(VIEWER_IDLE_MS + VIEWER_LEVEL_MS);
  expect(await yaw(page)).toBe(0);
});

test('changing models keeps both active rotation and the existing pause deadline', async ({ page }) => {
  await page.clock.install();
  await page.goto('/en/body-model-auto/');
  await liveModel(page);
  await expect.poll(() => yaw(page)).toBeGreaterThan(0.025);

  const female = page.getByRole('button', { name: 'Female', exact: true });
  await female.click();
  await expect(female).toHaveAttribute('aria-pressed', 'true');
  await liveModel(page);
  const switched = await yaw(page);
  await page.clock.runFor(400);
  expect(await yaw(page)).toBeGreaterThan(switched + 0.025);

  await slot(page).press('Space');
  const paused = await yaw(page);
  await page.clock.fastForward(VIEWER_IDLE_MS / 2);
  const male = page.getByRole('button', { name: 'Male', exact: true });
  await male.click();
  await expect(male).toHaveAttribute('aria-pressed', 'true');
  await liveModel(page);
  await page.clock.runFor(400);
  expect(await yaw(page)).toBe(paused);
  await page.clock.fastForward(VIEWER_IDLE_MS / 2 + 100);
  await page.clock.runFor(400);
  expect(await yaw(page)).toBeGreaterThan(paused + 0.025);
});

test('the background picker applies a chosen colour and accepts HEX', async ({ page }) => {
  await page.goto('/ru/body-model-auto/');
  await liveModel(page);
  const main = page.getByRole('main');
  const toggle = page.getByRole('button', { name: 'Цвет фона' });
  const panel = page.getByRole('group', { name: 'Цвет фона' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();

  const picker = panel.getByLabel('Выбрать цвет');
  const hex = panel.getByRole('textbox', { name: 'HEX' });
  await picker.fill('#1a2b3c');
  await expect(main).toHaveCSS('background-color', 'rgb(26, 43, 60)');
  await expect(hex).toHaveValue('#1A2B3C');
  await expect(page.locator('.body-viewer__callouts')).toHaveCSS('color', 'rgb(255, 255, 255)');

  await hex.fill('AABBCC');
  await expect(main).toHaveCSS('background-color', 'rgb(170, 187, 204)');
  await expect(picker).toHaveValue('#aabbcc');
  await hex.fill('#123');
  await hex.press('Enter');
  await expect(main).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  await expect(hex).toHaveValue('#112233');

  await hex.fill('invalid');
  await hex.press('Enter');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  await expect(main).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  await hex.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});

test.describe('EN viewer with a mobile touchscreen', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

  test('a short touch pauses auto rotation and highlights the touched zone', async ({ page }) => {
    await page.clock.install();
    await page.goto('/en/body-model-auto/');
    await liveModel(page);
    await expectFullscreen(page, 'en', 'body-model-auto');
    await expect.poll(() => yaw(page)).toBeGreaterThan(0.025);
    const chest = await chestPoint(page);
    expect(chest).not.toBeNull();
    await page.touchscreen.tap(chest!.x, chest!.y);
    await expect.poll(() => outline(page)).toMatch(/^(screen|veil)$/);
    const stopped = await yaw(page);
    await page.clock.fastForward(VIEWER_IDLE_MS / 2);
    expect(await yaw(page)).toBe(stopped);
    await page.clock.fastForward(VIEWER_IDLE_MS / 2 + 100);
    await expect.poll(() => yaw(page)).toBeGreaterThan(stopped + 0.025);
    await expect.poll(() => outline(page)).toMatch(/^(screen|veil)$/);

    const toggle = page.getByRole('button', { name: 'Background colour' });
    await toggle.tap();
    const panel = page.getByRole('group', { name: 'Background colour' });
    await expect(panel).toBeVisible();
    const bounds = (await panel.boundingBox())!;
    const trigger = (await toggle.boundingBox())!;
    expect(bounds.y).toBeGreaterThan(trigger.y + trigger.height);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    await toggle.tap();
    await expect(panel).toBeHidden();
  });

  test('rotates and zooms by touch, picks on a tap, and fits short landscape', async ({ page, context }) => {
    await page.goto('/en/body-model/?debug=lowfps');
    await expect(page).toHaveURL(/\/en\/body-model\/\?debug=lowfps$/);
    await expect(page).toHaveTitle('Body model');
    const box = await liveModel(page);
    await expectFullscreen(page, 'en');
    expect(await page.evaluate(() => window.__bm3d?.quality())).toBe('reduced');
    await expect(callout(page, 'chest')).toBeVisible();
    await expect(callout(page, 'chest')).toHaveText('Chest');
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ...touchPoints: { x: number; y: number; id: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const chest = await chestPoint(page);
    expect(chest).not.toBeNull();
    await page.touchscreen.tap(chest!.x, chest!.y);
    await expect.poll(() => outline(page)).toMatch(/^(screen|veil)$/);
    await page.touchscreen.tap(chest!.x, chest!.y);
    await expect.poll(() => outline(page)).toBe('off');
    await touch('touchStart', { x, y, id: 0 });
    for (let i = 1; i <= 6; i++) await touch('touchMove', { x: x + i * 14, y, id: 0 });
    await touch('touchEnd');
    await expect.poll(async () => Math.abs((await view(page)).camera[0])).toBeGreaterThan(0.4);
    await expect.poll(() => outline(page)).toBe('off');

    await touch('touchStart', { x: x - 20, y, id: 0 }, { x: x + 20, y, id: 1 });
    for (let i = 1; i <= 6; i++) await touch('touchMove', { x: x - 20 - i * 8, y, id: 0 }, { x: x + 20 + i * 8, y, id: 1 });
    await touch('touchEnd');
    await expect.poll(async () => distance(await view(page))).toBeLessThan(2.6);
    await expect.poll(() => outline(page)).toBe('off');
    await page.setViewportSize({ width: 640, height: 300 });
    await liveModel(page);
    await expectFullscreen(page, 'en');

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole('link', { name: /Switch to Russian/ }).tap();
    await expect(page).toHaveURL(/\/ru\/body-model\/$/);
    await expect(page).toHaveTitle('Модель тела');
    await expectFullscreen(page, 'ru');
    await page.getByRole('link', { name: /^EN\./ }).tap();
    await expect(page).toHaveURL(/\/en\/body-model\/$/);
    await expect(page).toHaveTitle('Body model');
    await expectFullscreen(page, 'en');
  });
});

test.describe('Android fullscreen viewer', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent });

  test('enters and exits native full screen by touch in both languages', async ({ page }) => {
    for (const [locale, enterLabel, exitLabel] of [
      ['en', 'Enter full screen', 'Exit full screen'],
      ['ru', 'На весь экран', 'Выйти из полноэкранного режима'],
    ]) {
      await page.goto(`/${locale}/body-model-auto/`);
      await liveModel(page);
      await expectFullscreen(page, locale, 'body-model-auto');
      const enter = page.getByRole('button', { name: enterLabel, exact: true });
      const exit = page.getByRole('button', { name: exitLabel, exact: true });
      const languageBounds = (await page.locator('.body-viewer__languages').boundingBox())!;
      const fullscreenBounds = (await enter.boundingBox())!;
      const pickerBounds = (await page.locator('.body-viewer__background-toggle').boundingBox())!;
      expect(fullscreenBounds.x).toBeGreaterThanOrEqual(languageBounds.x + languageBounds.width);
      expect(pickerBounds.x).toBeGreaterThanOrEqual(fullscreenBounds.x + fullscreenBounds.width);
      expect(fullscreenBounds.y).toBeCloseTo(languageBounds.y + (languageBounds.height - fullscreenBounds.height) / 2);
      expect(pickerBounds.y).toBeCloseTo(fullscreenBounds.y);
      const fullscreenViewer = page.locator('main.body-viewer:fullscreen');
      await enter.tap();
      await expect(fullscreenViewer).toBeVisible();
      await expect(fullscreenViewer.locator('canvas')).toBeVisible();
      await exit.tap();
      await expect(fullscreenViewer).toHaveCount(0);
      await expect(enter).toBeVisible();

      await enter.tap();
      await expect(exit).toBeVisible();
      await page.evaluate(() => document.exitFullscreen());
      await expect(enter).toBeVisible();
    }
  });
});

test('WebGL disabled: the viewer shows a poster and ignores an existing booking draft', async ({ page }) => {
  await page.goto('/ru/booking/?debug=nowebgl');
  await page.getByRole('button', { name: 'Женщина' }).click();
  await zone(page, 'chest').press('Space');
  await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
  const draft = await page.evaluate(() => sessionStorage.getItem('bm.bookingDraft'));
  expect(JSON.parse(draft!)).toMatchObject({ model: 'female', markers: [{ zoneId: 'chest' }] });

  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || url.hostname.includes('altegio')) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    if (!location.pathname.endsWith('/body-model/')) return;
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        if (type.startsWith('webgl') || type === 'experimental-webgl') return null;
        return Reflect.apply(getContext, this, [type, options]);
      },
    });
    const draftAccess: string[] = [];
    Object.defineProperty(window, 'draftAccess', { value: draftAccess });
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method];
      Object.defineProperty(Storage.prototype, method, {
        value(this: Storage, key: string, ...args: string[]) {
          if (this === sessionStorage && /^bm\.booking/.test(key)) draftAccess.push(`${method}:${key}`);
          return Reflect.apply(original, this, [key, ...args]);
        },
      });
    }
  });
  await page.goto('/ru/body-model/');
  await expect(slot(page)).toHaveAttribute('data-status', 'unavailable');
  await expect(page.getByRole('button', { name: 'Мужчина' })).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas(page)).toHaveCount(0);
  const poster = slot(page).locator('.b3d-poster img');
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute('src', /hero-male/);
  await page.getByRole('button', { name: 'Женщина' }).click();
  await expect(poster).toHaveAttribute('src', /hero-female/);
  await expectFullscreen(page, 'ru');
  expect(await page.evaluate(() => Reflect.get(window, 'draftAccess'))).toEqual([]);
  expect(apiRequests).toEqual([]);
  await page.reload();
  await expect(poster).toHaveAttribute('src', /hero-male/);
  expect(await page.evaluate(() => Reflect.get(window, 'draftAccess'))).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('bm.bookingDraft'))).toBe(draft);
});

test('the selected model poster stays visible if the 3D file fails to load', async ({ page }) => {
  await page.route('**/*.glb', (route) => route.abort());
  await page.goto('/en/body-model/');
  await expect(slot(page)).toHaveAttribute('data-status', 'error');
  await expect(slot(page).locator('.b3d-poster img')).toBeVisible();
  await expect(callout(page, 'chest')).toBeHidden();
  await expectFullscreen(page, 'en');
});
