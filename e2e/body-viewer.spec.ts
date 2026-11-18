import { expect, test, type Page } from '@playwright/test';

const slot = (page: Page) => page.locator('.b3d-slot[data-mode="viewer"]');
const canvas = (page: Page) => slot(page).locator('canvas');
const zone = (page: Page, id: string) => page.locator(`.b2d-zone[data-zone-id="${id}"]`);
const callout = (page: Page, id: string) => page.locator(`.body-viewer__callouts [data-zone="${id}"] .body-viewer__label`);
const outline = (page: Page) => page.evaluate(() => window.__bm3d?.outline?.());
const view = (page: Page) => page.evaluate(() => window.__bm3d!.view!());
const distance = ({ camera, target }: Awaited<ReturnType<typeof view>>) => Math.hypot(...camera.map((n, i) => n - target[i]));
const forbidden = 'header, footer, form, dialog, .cookie, .book-floating, .booking, .b3d-pin, [data-testid="b2d"]';

async function expectFullscreen(page: Page, locale: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator(forbidden)).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(2);
  await expect(slot(page)).not.toHaveAttribute('data-mode2d');
  await expect(page.locator('a')).toHaveCount(1);
  await expect(page.locator('.body-viewer__languages [aria-current="page"]')).toHaveText(locale.toUpperCase());
  await expect(page.getByRole('link')).toHaveAttribute('href', `/${locale === 'ru' ? 'en' : 'ru'}/body-model/`);
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
});

test.describe('EN viewer with a mobile touchscreen', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

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
