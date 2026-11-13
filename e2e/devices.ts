/**
 * Device matrix (README-CONTEXT «ВСЕ iPhone И ВСЕ Android», client 2026-11-07) — shared by the site gate and the LP.
 * Sizes are the VISIBLE area in CSS px (Safari / Chrome bars subtracted), not the screen: Playwright's older descriptors
 * give the screen (iPhone SE 3rd gen 375×667 — the real Safari area is 375×548).
 * Support floor: iOS / iPadOS 16.4+, Android Chrome / WebView 111+, Samsung Internet 22+.
 */
import { devices } from '@playwright/test';

type Use = Record<string, unknown>;
const IOS_UA = (v: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.split('_')[0]}.0 Mobile/15E148 Safari/604.1`;
const ANDROID_UA = (model: string, chrome = '131.0.0.0') => `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Mobile Safari/537.36`;
const SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';

/** an iPhone in WebKit with the given visible area */
export const iphone = (width: number, height: number, ios = '17_5', dpr = 3): Use => ({
  ...devices['iPhone 15'], viewport: { width, height }, screen: { width, height: Math.round(height * 1.25) }, deviceScaleFactor: dpr, userAgent: IOS_UA(ios),
});
/** an Android phone in Chromium (mobile UA, touch) with the given visible area */
export const android = (width: number, height: number, ua = ANDROID_UA('Pixel 7'), dpr = 2.625): Use => ({
  ...devices['Pixel 7'], viewport: { width, height }, screen: { width, height: Math.round(height * 1.12) }, deviceScaleFactor: dpr, userAgent: ua,
});

/** Level A — every functional scenario (booking by steps, forms with the keyboard, bottom sheets, sticky buttons). */
export const LEVEL_A: { name: string; use: Use }[] = [
  { name: 'A-iphone-se', use: iphone(375, 548, '16_4', 2) }, // iPhone 8 / SE 2–3: the smallest supported iPhone
  { name: 'A-iphone-13mini', use: iphone(375, 629) },
  { name: 'A-iphone-16', use: iphone(393, 659, '18_0') },
  { name: 'A-iphone-17promax', use: iphone(440, 763, '18_0') },
  { name: 'A-moto-g4', use: android(360, 640, ANDROID_UA('Moto G (4)', '111.0.0.0'), 3) }, // weak Android, Chrome 111 floor
  { name: 'A-pixel-9', use: android(360, 732, ANDROID_UA('Pixel 9')) },
  { name: 'A-pixel-7', use: android(412, 839) },
  { name: 'A-galaxy-a', use: android(384, 740, SAMSUNG_UA, 2.8125) }, // Samsung Internet
];

/** Level B — layout smoke of the other sizes (npm run test:matrix). */
export const LEVEL_B: { name: string; use: Use }[] = [
  { name: 'B-320', use: android(320, 560, ANDROID_UA('SM-A057F'), 2) }, // narrow / zoomed Android
  { name: 'B-iphone-8plus', use: iphone(414, 617, '16_4') },
  { name: 'B-iphone-11pro', use: iphone(375, 635) },
  { name: 'B-iphone-16e', use: iphone(390, 651, '18_0') },
  { name: 'B-iphone-12-14', use: iphone(390, 664) },
  { name: 'B-iphone-16pro', use: iphone(402, 681, '18_0') },
  { name: 'B-iphone-11-xr', use: iphone(414, 715, '17_5', 2) },
  { name: 'B-iphone-air', use: iphone(420, 719, '18_0') },
  { name: 'B-iphone-16plus', use: iphone(430, 739, '18_0') },
  { name: 'B-iphone-14promax', use: iphone(428, 746) },
  { name: 'B-fold7-cover', use: android(360, 764, ANDROID_UA('SM-F966B')) },
  { name: 'B-pixel-9pro', use: android(427, 876, ANDROID_UA('Pixel 9 Pro')) },
  { name: 'B-pixel-9proxl', use: android(448, 921, ANDROID_UA('Pixel 9 Pro XL')) },
  { name: 'B-galaxy-a55', use: android(480, 1040, SAMSUNG_UA, 2.25) },
  { name: 'B-fold7-open', use: android(984, 1016, ANDROID_UA('SM-F966B'), 2.2) },
  { name: 'B-tab-s9', use: { ...android(640, 1024, ANDROID_UA('SM-X710'), 2.5), isMobile: false } },
  { name: 'B-iphone-16-land', use: iphone(852, 334, '18_0') }, // landscape: notch / Dynamic Island on the side
  { name: 'B-pixel-7-land', use: android(915, 360) },
];

/** In-app browsers (ads open in them): the app's own bar takes ~100 px of the Safari / Chrome area. */
export const IN_APP: { name: string; use: Use }[] = [
  { name: 'inapp-instagram-ios', use: { ...iphone(393, 559, '18_0'), userAgent: `${IOS_UA('18_0').replace(' Safari/604.1', '')} Instagram 360.0.0.0.0 (iPhone15,4; iOS 18_0; ru_RU; ru; scale=3.00; 1179x2556; 0)` } },
  { name: 'inapp-facebook-ios', use: { ...iphone(393, 559, '18_0'), userAgent: `${IOS_UA('18_0').replace(' Safari/604.1', '')} [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1;FBDV/iPhone15,4;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBLC/ru_RU;FBOP/5]` } },
  { name: 'inapp-instagram-android', use: android(412, 739, `${ANDROID_UA('Pixel 7')} Instagram 360.0.0.0.0 Android (34/14; 420dpi; 1080x2400; Google; Pixel 7; panther; panther; ru_RU)`) },
  { name: 'inapp-facebook-android', use: android(412, 739, `${ANDROID_UA('Pixel 7')} [FB_IAB/FB4A;FBAV/480.0.0.0;]`) },
];

export const isWebKit = (use: Use) => (use as { defaultBrowserType?: string }).defaultBrowserType === 'webkit';
