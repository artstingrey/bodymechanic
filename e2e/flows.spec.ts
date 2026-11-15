/**
 * Flow & site-wide checks (one width, 1280 unless stated):
 * route inventory (§04), robots, root language pick, 404, deep links + F5, persistent 3D canvas hero → booking,
 * 3D after first paint, GLB weight, booking state in the URL (Back / F5) up to the confirmation, language switch
 * keeps path + query, hero canvas lets the page scroll, overflow at 360, no 100vh in CSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import en from '../messages/en.json';
import { LOCALES, ROOT, NEXT, REQUIRED, builtPages, templateOf, matrixPages, guard, settle3D, domChecks, expectClean, expectNoDemoLabels, seedConsent, tapMarksRightAway, deepLinksEveryStep } from './helpers';

test.beforeEach(async ({ page }) => { await seedConsent(page); }); // the cookie card would cover the 3D slot

test('route inventory: every §04 template built for both locales, no unknown pages', () => {
  for (const l of LOCALES) {
    const pages = builtPages(l);
    const templates = new Set(pages.map(templateOf));
    for (const r of REQUIRED) expect(templates.has(r), `/${l}/${r} missing in the build`).toBe(true);
    for (const p of pages) expect(REQUIRED.includes(templateOf(p)), `unexpected page /${l}/${p}`).toBe(true);
  }
});

test('robots.txt disallows everything (DEL-13)', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(/User-agent:\s*\*\s*[\r\n]+Disallow:\s*\/\s*$/im); // app/robots.ts (Next writes «User-Agent»)
});

test.describe('root / picks the language in the browser', () => {
  test('English browser → /en/', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/');
    await page.waitForURL('**/en/');
    expectClean((await g.problems()), 'root (en)');
  });
  test('Russian browser → /ru/', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU', baseURL });
    const page = await ctx.newPage();
    const g = guard(page, baseURL!);
    await page.goto('/');
    await page.waitForURL('**/ru/');
    expectClean((await g.problems()), 'root (ru)');
    await ctx.close();
  });
  test('saved choice wins over the browser language', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ locale: 'ru-RU', baseURL });
    await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForURL('**/en/');
    await ctx.close();
  });
  test('root HTML itself is noindex', async ({ request }) => {
    expect(await (await request.get('/')).text()).toMatch(/<meta name="robots" content="noindex, ?nofollow"/);
  });
});

test.describe('404 (DEL-12)', () => {
  for (const u of ['/en/no-such-page/', '/ru/services/no-such-service/', '/nope']) {
    test(`${u} → 404 with the site's page`, async ({ page, baseURL }) => {
      const g = guard(page, baseURL!, { allowStatus: (url, st) => st === 404 && new URL(url).pathname === u });
      const res = await page.goto(u, { waitUntil: 'networkidle' });
      expect(res?.status()).toBe(404);
      await expectNoDemoLabels(page);
      const lang = u.startsWith('/ru/') ? 'ru' : 'en';
      await expect(page.locator(`main a[href="/${lang}/"], main a[href="/${lang}"]`).filter({ visible: true })).toHaveCount(1);
      if (u.includes('/services/')) await expect(page.locator('main .nf')).toBeVisible();
      else await expect(page.locator(`header.site-header[data-nf="${lang}"]`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
      // R-FINAL (Market Analyst): one language variant in the DOM — exactly one h1, one site header
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('header.site-header')).toHaveCount(1);
      expect((await page.locator('meta[name="robots"]').evaluateAll((ms) => ms.map((m) => m.getAttribute('content')).join(', ')))).toMatch(/noindex.*nofollow|nofollow.*noindex/);
      // Chrome logs the 404 of the document itself as a console error — that one is the point of the test.
      expectClean((await g.problems()).filter((p) => !/console\.error: Failed to load resource: .*404/.test(p)), u);
    });
  }
});

test('deep links open directly and survive F5 (DEL-12)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  const deep = ['/ru/services/sports/', '/en/team/specialist-2/', '/en/booking/?step=4', '/ru/journal/demo-article-3/',
    '/en/services/?category=13688468', '/ru/account/', '/en/account/record/9001/demo-hash/', '/ru/account/record/777/zzz/', '/en/prices/', '/ru/contacts/'];
  for (const u of deep) {
    const r1 = await page.goto(u, { waitUntil: 'networkidle' });
    expect(r1?.status(), u).toBe(200);
    const h1 = await page.locator('h1').first().textContent();
    const r2 = await page.reload({ waitUntil: 'networkidle' });
    expect(r2?.status(), `${u} after F5`).toBe(200);
    expect(await page.locator('h1').first().textContent(), `${u} same screen after F5`).toBe(h1);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(u);
  }
  expectClean((await g.problems()), 'deep links');
});

test('persistent 3D: hero → booking keeps the WebGL context and never re-requests the model', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  await settle3D(page);
  const before = await page.evaluate(() => ({ id: window.__bm3d?.contextId, url: window.__bm3d?.url('male') }));
  expect(before.id, '3D runtime started on the home page').toBeTruthy();

  // 3D starts after the first paint (DEL-07 / ТЗ §06): the first GLB request begins after the load event.
  const order = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const glb = performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.glb')).map((e) => e.startTime);
    return { loadEnd: nav.loadEventEnd, firstGlb: Math.min(...glb) };
  });
  expect(order.firstGlb).toBeGreaterThanOrEqual(order.loadEnd);

  // hero: vertical pans scroll the page; booking: all gestures go to the model
  expect(await page.locator('.b3d-slot canvas').evaluate((c) => getComputedStyle(c).touchAction)).toBe('pan-y');

  await page.locator('main .btn-book').first().click(); // client-side navigation (Link)
  await page.waitForURL('**/en/booking/');
  await settle3D(page);
  const after = await page.evaluate(() => ({
    id: window.__bm3d?.contextId,
    inBooking: !!document.querySelector('.b3d-slot[data-mode="booking"] .b3d-host canvas'),
    glb: performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.glb')).map((e) => new URL(e.name).pathname),
  }));
  expect(after.id, 'same WebGL context after navigation').toBe(before.id);
  expect(after.inBooking, 'canvas moved into the booking slot').toBe(true);
  expect(after.glb.filter((u) => before.url && u === new URL(before.url, 'http://x').pathname).length, `model requested once: ${after.glb}`).toBe(1);
  expect(await page.locator('.b3d-slot canvas').evaluate((c) => getComputedStyle(c).touchAction)).toBe('none');
  expectClean((await g.problems()), 'hero → booking');
});

test('GLB weight ≤ 5 MB each (DEL-07)', () => {
  const dir = path.join(ROOT, 'public', 'models');
  const glbs = fs.readdirSync(dir).filter((f) => f.endsWith('.glb'));
  expect(glbs.length).toBeGreaterThan(0);
  for (const f of glbs) expect(fs.statSync(path.join(dir, f)).size, f).toBeLessThanOrEqual(5 * 1024 * 1024);
});

/**
 * RC-9 (security review В-5): the authors' notes must not reach the visitor. The landing config was imported whole by
 * client code — its notes («решение лида…», «пока юристы не ответили…», «когда клиент подтвердит…», tracking rules with
 * their reasons, a path of the team's folder) were readable in a public JS file; the demo catalogue carried «confirm with
 * the client» flags, the generated JSON «… do not edit» lines. Two guards:
 *  - the JSON files under src/ (imported → bundled) have none of the note keys at any depth;
 *  - no text file of the build contains a note key or a marker word of those notes.
 */
test('no internal notes in the JSON the app imports nor in the build (В-5)', () => {
  const NOTE_KEYS = new Set(['_source', '_comment', 'note', 'servicesNote', 'confirmWithClient', 'todoKeys', 'reuse', 'tracking', 'adminViewForMarks', 'splitRule', 'otherServiceCards', 'adsLaunchBlocker']);
  const filesOf = (dir: string, rx: RegExp): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesOf(path.join(dir, e.name), rx) : rx.test(e.name) ? [path.join(dir, e.name)] : []));
  const src = path.resolve(__dirname, '..', 'src');
  const noteKeys: string[] = [];
  const visit = (o: unknown, at: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (!Array.isArray(o) && NOTE_KEYS.has(k)) noteKeys.push(`${at}: ${k}`);
      visit(v, at);
    }
  };
  const jsons = filesOf(src, /\.json$/);
  expect(jsons.length, 'JSON files under src/').toBeGreaterThan(5);
  for (const f of jsons) visit(JSON.parse(fs.readFileSync(f, 'utf8')), path.relative(src, f).replace(/\\/g, '/'));
  expect(noteKeys, 'note keys in the JSON the app imports').toEqual([]);

  const MARKERS: [string, RegExp][] = [
    ['a _source / _comment key', /(?<![A-Za-z0-9_])_(?:source|comment)(?![A-Za-z0-9_])/],
    ['«do not edit»', /do not edit/i],
    ['a note key of the deck', /confirmWithClient|servicesNote|adminViewForMarks|todoKeys|splitRule|otherServiceCards|adsLaunchBlocker|stripMethod|utmNaming/],
    ['«лид» (the team lead)', /(?<![а-яё])лид(?:а|у|ом|е)?(?![а-яё])/i],
    ['«юрист»', /юрист/i],
    ['«клиент подтвердит»', /клиент подтвердит/i],
    ['a path of the team folders', /site\/copy|copy\/_src/],
    ['an internal ticket number', /\((?:R-LP|J|D|L)-\d+/],
  ];
  const built = [
    ...filesOf(path.join(NEXT, 'static'), /\.(?:js|css)$/),
    ...filesOf(path.join(NEXT, 'server', 'app'), /\.(?:html|rsc|body)$/),
    ...filesOf(path.join(ROOT, 'public'), /\.(?:js|html|txt|json|css|xml|webmanifest)$/),
  ];
  expect(built.length, 'public build files').toBeGreaterThan(100);
  const hits: string[] = [];
  for (const f of built) {
    const s = fs.readFileSync(f, 'utf8');
    for (const [name, rx] of MARKERS) {
      const m = rx.exec(s);
      if (m) hits.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: ${name} — «…${s.slice(Math.max(0, m.index - 30), m.index + 50).replace(/\s+/g, ' ')}…»`);
    }
  }
  expect(hits, `internal notes in the build:\n  ${hits.slice(0, 12).join('\n  ')}`).toEqual([]);
});

test('zone colours are recorded for every model (no colouring on the main thread after load — R-FINAL perf)', () => {
  const lib = path.resolve(__dirname, '..', 'src', 'lib', 'body3d');
  const assets = JSON.parse(fs.readFileSync(path.join(lib, 'assets.json'), 'utf8')) as { models: Record<string, Record<string, string | number>> };
  const colours = JSON.parse(fs.readFileSync(path.join(lib, 'zone-colours.json'), 'utf8')) as Record<string, unknown>;
  for (const g of Object.values(assets.models)) for (const lod of ['lod0', 'lod1']) {
    const file = String(g[lod]).split('/').pop()!;
    expect(Array.isArray(colours[file]), `${file}: rerun scripts/zone-colours.mjs after the models change`).toBe(true);
  }
});

test('booking: step and choices live in the URL/session — Back and F5 work, mock flow reaches the confirmation (DEL-10)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  // step 1 → pick a zone in the always-available list (no 3D gesture needed)
  await page.locator('#zone-list input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: en.body3d.panel.cta }).click();
  await page.waitForURL(/step=2/);
  await page.locator('input[name="service"]').first().check();
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=3/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#st3')).toBeVisible();
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForURL(/step=2/);
  await expect(page.locator('input[name="service"]').first()).toBeChecked();
  await page.goForward();
  await page.waitForURL(/step=3/);
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=4/);
  await page.locator('.dates button:not([aria-disabled])').first().click();
  // 13:30 is the mock "slot taken" case — pick another time
  await page.locator('.times button').filter({ hasNotText: '13:30' }).first().click();
  await page.getByRole('button', { name: en.common.actions.next }).click();
  await page.waitForURL(/step=5/);
  await page.locator('input[autocomplete="name"]').fill('Demo');
  await page.locator('input[type="tel"]').fill('+971500000000');
  for (const c of await page.locator('form input[type="checkbox"]').all()) await c.check();
  await page.getByRole('button', { name: en.booking.contacts.next }).click();
  await page.waitForURL(/step=6/);
  await expect(page.locator('input[autocomplete="one-time-code"]'), 'SMS is off (BOOKING_SMS_REQUIRED=false)').toHaveCount(0);
  await page.getByRole('button', { name: en.booking.review.confirm }).click();
  await page.waitForURL(/step=7/);
  await expect(page.locator('#st7')).toBeVisible();
  expectClean((await g.problems()), 'booking flow');
});

// RC-10 (Ж-9): the service is handed over at the click, the address is the bare /booking/ — it used to be /booking/?service=ID
test('service page CTA preselects the service in the booking; the address stays the bare /booking/', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/services/manual/', { waitUntil: 'networkidle' });
  const title = (await page.locator('h1').textContent())!.trim();
  await page.locator('main .btn-book').first().click();
  await page.waitForURL(/\/en\/booking\/$/);
  await page.getByRole('button', { name: en.body3d.panel.skip }).click();
  await page.waitForURL(/\/en\/booking\/\?step=2$/);
  await expect(page.locator('li', { has: page.locator('input[name="service"]:checked') })).toContainText(title);
  await page.reload({ waitUntil: 'networkidle' }); // the preset was persisted, not only held in memory
  await expect(page.locator('li', { has: page.locator('input[name="service"]:checked') })).toContainText(title);
  expectClean((await g.problems()), 'service → booking preset');
});

/**
 * RC-10 (security review Ж-9): no page of the build links into the booking with a choice in the address — not in the
 * markup, not in the router's copy of the page data (inside the HTML and in the RSC responses it fetches on a navigation).
 * The one named exception: JSON-LD of a service page, whose Offer.url is the outside address of the booking
 * (…/booking/?service=ID, ТЗ §07) — a link from outside still works, it is cleaned as the page opens.
 */
test('no page of the build carries a booking choice in a link address; JSON-LD is the one named exception (Ж-9)', () => {
  const filesOf = (dir: string, rx: RegExp): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesOf(path.join(dir, e.name), rx) : rx.test(e.name) ? [path.join(dir, e.name)] : []));
  const CHOICE = /[?&](?:amp;)?(?:service|staff)=/;
  const LD = /<script type="application\/ld\+json">[\s\S]*?<\/script>/g;
  const ROUTER_DATA = /<script>\(?self\.__next_f[\s\S]*?<\/script>/g;
  const OFFER_URL = /"url":"https?:\/\/[^"/]+\/(?:ru|en)\/booking\/?\?service=\d+"/g; // JSON-LD and the router's copy of it
  const plain = (s: string) => s.replace(/\\+"/g, '"').replace(/\\u0026/g, '&');
  const bad: string[] = [];
  let inJsonLd = 0, files = 0;
  for (const f of filesOf(path.join(NEXT, 'server', 'app'), /\.(?:html|rsc)$/)) {
    files++;
    const raw = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const isHtml = f.endsWith('.html');
    if (isHtml) {
      const markup = raw.replace(LD, (m) => { if (CHOICE.test(m)) inJsonLd++; return ''; }).replace(ROUTER_DATA, '');
      if (CHOICE.test(markup)) bad.push(`${rel}: the markup — ${markup.match(/.{0,40}[?&](?:amp;)?(?:service|staff)=.{0,12}/)?.[0]}`);
    }
    const data = plain(isHtml ? (raw.match(ROUTER_DATA) ?? []).join('\n') : raw);
    if (CHOICE.test(data.replace(OFFER_URL, ''))) bad.push(`${rel}: the router's data`);
    if (/"query":\{[^}]*"(?:service|staff|date|time)"/.test(data)) bad.push(`${rel}: a link object with the choice in its query`);
  }
  expect(files).toBeGreaterThan(200);
  expect(bad).toEqual([]);
  expect(inJsonLd, 'JSON-LD of the service pages names the outside address of the booking').toBeGreaterThan(0);
});

/**
 * RC-10: only the interface code and the dictionaries are sources of Tailwind classes (globals.css: `source(none)` and two
 * `@source` lines). Left to itself Tailwind reads every file git does not ignore: in RC-9 the word `backdrop-filter` in
 * docs/KNOWN-ISSUES.md became a utility (+1387 bytes — the deployed stylesheet was not the one the gate had run on), and
 * `shrink` and `tabular-nums` had long been coming from comments in the tests. None of the three is used by the interface.
 * That the CSS does not depend on documents, tests or new files is proved by `npm run gate:clean` (it builds twice);
 * here, against the build under test: the three utilities are absent although the words are still written in docs/ and
 * e2e/ — this very file names them.
 */
test('only src/ and messages/ feed Tailwind: the utilities that documents and tests once brought in are absent from the built CSS', () => {
  const filesOf = (dir: string, rx: RegExp): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesOf(path.join(dir, e.name), rx) : rx.test(e.name) ? [path.join(dir, e.name)] : []));
  const built = filesOf(path.join(NEXT, 'static'), /\.css$/);
  expect(built.length).toBeGreaterThan(0);
  const UTILITY = /\.backdrop-filter\s*\{|\.shrink\s*\{|\.tabular-nums\s*\{|@property --tw-backdrop-|@property --tw-numeric-/;
  const hits = built.filter((f) => UTILITY.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
  expect(hits, 'stylesheets with a utility that only a document or a test names').toEqual([]);
  const docs = [...filesOf(path.join(ROOT, 'docs'), /\.md$/), path.join(ROOT, 'README.md')].filter((f) => fs.existsSync(f));
  expect(docs.some((f) => fs.readFileSync(f, 'utf8').includes('`backdrop-filter`')), 'the documents still name the word in backticks').toBe(true);
  const css = fs.readFileSync(path.join(ROOT, 'src', 'app', 'globals.css'), 'utf8');
  expect(css).toMatch(/^@import "tailwindcss" source\(none\);/);
  expect([...css.matchAll(/^@source\s+(.+);$/gm)].map((m) => m[1]), 'the whole list of sources').toEqual(['"../"', '"../../messages"']);
});

test('language switch keeps the page and the query', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/services/?category=13838712', { waitUntil: 'networkidle' });
  await page.locator('header a[hreflang="ru"]').first().click();
  await page.waitForURL('**/ru/services/?category=13838712');
  expectClean((await g.problems()), 'lang switch');
});

test('no horizontal overflow at 360 px on any page (DEL-05)', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, baseURL });
  const page = await ctx.newPage();
  const bad: string[] = [];
  for (const l of LOCALES) for (const p of matrixPages(l)) {
    await page.goto(`/${l}/${p}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    bad.push(...(await domChecks(page, l)).filter((x) => x.startsWith('horizontal overflow')).map((x) => `/${l}/${p}: ${x}`));
  }
  await ctx.close();
  expectClean(bad, 'overflow at 360');
});

test('CSS uses svh/dvh, not 100vh (DEL-05)', () => {
  const dir = path.join(NEXT, 'static');
  const hits: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.css') && /(^|[^.\d])100vh/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
  } };
  walk(dir);
  expect(hits, `100vh found in ${hits.join(', ')}`).toEqual([]);
});

test('Altegio comment: bilingual by default, ru | en | both reproduce copy/comment-template.json, ≤1000 chars', async () => {
  const { formatComment, COMMENT_EXAMPLES, DEFAULT_COMMENT_LANGUAGE } = await import('../src/lib/altegio/formatComment');
  const input = {
    source: '3d' as const, gender: 'male' as const, age: 34,
    markers: [{ zoneId: 'lumbar', intensity: 6, note: 'тянет после бега' }, { zoneId: 'hamstrings_l', intensity: 4 }],
    generalNote: 'готовлюсь к полумарафону, боль после длинных пробежек',
    utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'sports_massage' },
  };
  expect(DEFAULT_COMMENT_LANGUAGE).toBe('both');
  for (const lang of ['ru', 'en', 'both'] as const) expect(formatComment(input, lang), lang).toBe(COMMENT_EXAMPLES[lang]);
  expect(formatComment(input)).toBe(COMMENT_EXAMPLES.both);
  // overflow: only the client's free text is shortened, labels and zone names stay whole
  const long = { ...input, generalNote: 'x'.repeat(900), markers: input.markers.map((m) => ({ ...m, note: 'y'.repeat(400) })) };
  const out = formatComment(long);
  expect(out.length).toBeLessThanOrEqual(1000);
  for (const keep of ['[Сайт/3D]', 'Поясничный отдел / Lower back', 'Задняя поверхность бедра, левая сторона / Back of thigh, left side', 'Состояние / Condition:', 'UTM: google / cpc / sports_massage']) expect(out).toContain(keep);
});

test('hero rotation toggle: constant name, aria-pressed = paused (R-3D-01 F-03)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  const btn = page.getByTestId('b3d-rotation');
  await expect(btn).toHaveAttribute('aria-label', en.home.hero.pauseRotation);
  await expect(btn).toHaveAttribute('aria-pressed', 'false'); // rotating
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true'); // paused
  await expect(btn).toHaveAttribute('aria-label', en.home.hero.pauseRotation);
  expectClean((await g.problems()), 'rotation toggle');
});

test('quality fallback path: DPR ≤ 1.5 + MeshStandard (forced with ?debug=reduced)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 }, baseURL });
  const page = await ctx.newPage();
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/?debug=reduced', { waitUntil: 'networkidle' });
  await settle3D(page);
  await page.locator('.b3d-slot').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__bm3d?.quality() === 'reduced' && window.__bm3d?.dpr() === 1.5, null, { timeout: 10_000 });
  expectClean((await g.problems()), 'reduced quality');
  await ctx.close();
});

/** Pixel stats of the 3D slot: pixels close to the outline colour #26221F and mean luminance (PNG decoded in the page). */
async function slotStats(page: import('@playwright/test').Page) {
  const png = await page.locator('.b3d-slot').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let dark = 0, lum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 0x26) + Math.abs(d[i + 1] - 0x22) + Math.abs(d[i + 2] - 0x1f) < 60) dark++;
      lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    return { dark, lum: lum / (d.length / 4) };
  }, png.toString('base64'));
}

for (const reduced of [false, true]) {
  test(`zone highlight: ${reduced ? 'reduced quality → veil only, no outline' : 'screen-space veil + continuous outline'} (F-07)`, async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto(`/en/booking/${reduced ? '?debug=reduced' : ''}`, { waitUntil: 'networkidle' });
    await settle3D(page);
    await page.addStyleTag({ content: '.b3d-pin { visibility: hidden !important; }' }); // the disc has its own 1 px outline
    await page.locator('.b3d-slot').scrollIntoViewIfNeeded();
    const frames = () => page.evaluate(() => window.__bm3d?.frames ?? 0);
    let f = await frames();
    await page.waitForFunction((n) => (window.__bm3d?.frames ?? 0) > n + 5, f);
    const before = await slotStats(page);
    await page.getByRole('checkbox', { name: en.body3d.zones.chest, exact: true }).check();
    await page.waitForFunction((m) => window.__bm3d?.outline?.() === m, reduced ? 'veil' : 'screen');
    f = await frames();
    await page.waitForFunction((n) => (window.__bm3d?.frames ?? 0) > n + 5, f);
    const after = await slotStats(page);
    const dDark = after.dark - before.dark, dLum = after.lum - before.lum;
    test.info().annotations.push({ type: 'pixels', description: `dark +${dDark}, luminance +${dLum.toFixed(2)}` });
    expect(dLum, 'the white veil brightens the zone').toBeGreaterThan(0.2);
    if (reduced) expect(dDark, 'no outline in the reduced mode').toBeLessThan(40);
    else expect(dDark, 'outline drawn around the zone').toBeGreaterThan(150);
    expectClean((await g.problems()), 'zone highlight');
  });
}

test('3D anchors API for call-outs: zones and markers in screen space (lib/body3d/anchors)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await settle3D(page);
  await page.locator('.b3d-slot').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !!window.__bm3d?.anchors);
  await page.evaluate(() => window.__bm3d!.anchors!.watch());
  await page.waitForFunction(() => window.__bm3d!.anchors!.get().zones.length > 0);
  const a = await page.evaluate(() => window.__bm3d!.anchors!.get());
  const z = (id: string) => a.zones.find((q) => q.zoneId === id)!;
  expect(a.mode).toBe('booking');
  expect(a.zones.length, 'an anchor for every zone of the model').toBeGreaterThanOrEqual(25);
  expect(z('chest').visible, 'front view: chest visible').toBe(true);
  expect(z('chest').x).toBeGreaterThan(0); expect(z('chest').x).toBeLessThan(a.width);
  expect(z('lumbar').visible, 'front view: lower back hidden').toBe(false);
  expect(z('knee_l').x, "client's left knee is on the viewer's right in the front view").toBeGreaterThan(z('knee_r').x);
  await page.getByRole('checkbox', { name: en.body3d.zones.chest, exact: true }).check();
  await page.waitForFunction(() => window.__bm3d!.anchors!.get().markers.length === 1);
  const m = (await page.evaluate(() => window.__bm3d!.anchors!.get())).markers[0];
  expect(m.n).toBe(1);
  expect(m.visible).toBe(true);
  expect(Math.hypot(m.x - z('chest').x, m.y - z('chest').y), 'list marker sits on the zone anchor').toBeLessThan(3);
  expectClean(await g.problems(), 'anchors');
});

test('tap on the front of the shin → marker shin_l; tap on the head → hint, no marker (zone shin, 2026-11-06)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/booking/', { waitUntil: 'networkidle' });
  await settle3D(page);
  await page.locator('.b3d-slot').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !!window.__bm3d?.anchors);
  await page.evaluate(() => window.__bm3d!.anchors!.watch());
  await page.waitForFunction(() => window.__bm3d!.anchors!.get().zones.some((z) => z.zoneId === 'shin_l' && z.visible));
  const a = await page.evaluate(() => window.__bm3d!.anchors!.get());
  const z = (id: string) => a.zones.find((q) => q.zoneId === id)!;
  const box = (await page.locator('.b3d-slot canvas').boundingBox())!;
  await page.getByRole('button', { name: en.body3d.toolbar.marker, exact: true }).click();
  await page.mouse.click(box.x + z('shin_l').x, box.y + z('shin_l').y);
  await expect(page.getByTestId('b3d-live')).toContainText(en.body3d.zones.left.replace('{zone}', en.body3d.zones.shin));
  await page.waitForFunction(() => window.__bm3d!.anchors!.get().markers.some((m) => m.zoneId === 'shin_l'));
  // head: above the neck anchor by the neck–chest distance → outside the zone list
  const neck = z('neck_collar'), chest = z('chest');
  await page.waitForTimeout(400); // past the double-tap window
  await page.mouse.click(box.x + neck.x, box.y + neck.y - (chest.y - neck.y));
  await expect(page.locator('.b3d-hint')).toHaveText(en.body3d.hint.outOfZones);
  expect((await page.evaluate(() => window.__bm3d!.anchors!.get())).markers.length).toBe(1);
  expectClean(await g.problems(), 'shin tap');
});

test.describe('R-FINAL F-04: «Marker» by default — a tap on the model right after load marks it', () => {
  test('1280, mouse', async ({ page, baseURL }) => {
    await seedConsent(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await tapMarksRightAway(page, false);
    expectClean(await g.problems(), 'tap 1280');
  });
  test('390, touch (Chrome)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL });
    const page = await ctx.newPage();
    await seedConsent(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await tapMarksRightAway(page, true);
    expectClean(await g.problems(), 'tap 390');
    await ctx.close();
  });
});

test('hero sway ±20° (DECISION): anchors move, rest coordinates stay; pause stops the sway; reduced motion → still front view', async ({ page, browser, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  await settle3D(page);
  await page.waitForFunction(() => !!window.__bm3d?.anchors);
  await page.evaluate(() => window.__bm3d!.anchors!.watch());
  await page.waitForFunction(() => window.__bm3d!.anchors!.get().zones.length > 0);
  const chest = () => page.evaluate(() => { const z = window.__bm3d!.anchors!.get().zones.find((q) => q.zoneId === 'chest')!; return { x: z.x, restX: z.restX }; });
  const a = await chest(); await page.waitForTimeout(700); const b = await chest();
  expect(Math.abs(a.x - b.x), 'the hero sways').toBeGreaterThan(0.5);
  expect(Math.abs(a.restX - b.restX), 'rest coordinates are steady').toBeLessThan(0.5);
  await page.getByTestId('b3d-rotation').click(); // pause
  await page.waitForTimeout(200);
  const c = await chest(); await page.waitForTimeout(700); const d = await chest();
  expect(Math.abs(c.x - d.x), 'pause stops the sway').toBeLessThan(0.5);
  expectClean(await g.problems(), 'hero sway');
  // reduced motion: no sway, the model stands in the front view
  const ctx = await browser.newContext({ reducedMotion: 'reduce', baseURL, viewport: { width: 1280, height: 800 } });
  const p2 = await ctx.newPage();
  await p2.goto('/en/', { waitUntil: 'networkidle' });
  await settle3D(p2);
  await p2.waitForFunction(() => !!window.__bm3d?.anchors);
  await p2.evaluate(() => window.__bm3d!.anchors!.watch());
  await p2.waitForFunction(() => window.__bm3d!.anchors!.get().zones.length > 0);
  const e = await p2.evaluate(() => window.__bm3d!.anchors!.get().zones.find((q) => q.zoneId === 'chest')!);
  expect(Math.abs(e.x - e.restX)).toBeLessThan(1);
  await ctx.close();
});

for (const [w, h] of [[390, 844], [1280, 800], [1440, 900], [1920, 1080]] as const) {
  test(`hero fallback without WebGL at ${w}px: poster + index on the poster, no 2D, no pause, nothing over the header (lead)`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, baseURL });
    const page = await ctx.newPage();
    await seedConsent(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/?debug=nowebgl', { waitUntil: 'networkidle' });
    const slot = page.locator('.b3d-slot[data-mode="hero"]');
    await expect(slot).toHaveAttribute('data-fallback', 'true');
    await expect(slot.locator('.b3d-poster img')).toBeVisible();
    // the hero shows the poster, not the 2D scheme: no «mark areas on the diagram» announcement (R-CODE-02 MINOR)
    await expect(slot.getByTestId('b3d-live')).not.toContainText(en.body3d.live.mode2d);
    await expect(page.locator('.b2d-mode')).toHaveCount(0);
    await expect(page.getByTestId('b3d-rotation')).toHaveCount(0);
    await page.waitForFunction(() => document.querySelectorAll('.atlas-dot[data-visible="1"]').length >= 4);
    const geo = await page.evaluate(() => {
      const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const img = document.querySelector<HTMLImageElement>('.b3d-slot[data-mode="hero"] .b3d-poster img')!;
      const ir = img.getBoundingClientRect(), k = Math.min(ir.width / img.naturalWidth, ir.height / img.naturalHeight);
      const pw = img.naturalWidth * k, ph = img.naturalHeight * k, px = ir.left + (ir.width - pw) / 2, py = ir.top + (ir.height - ph) / 2;
      const dots = [...document.querySelectorAll<HTMLElement>('.atlas-dot')].map((d) => ({ v: d.dataset.visible, c: (() => { const b = d.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })() }));
      return {
        poster: { x: px, y: py, w: pw, h: ph }, dots,
        header: r(document.querySelector('header')), top: r(document.querySelector('.atlas-top')),
        rows: [...document.querySelectorAll('.atlas-index li')].map((li) => li.getBoundingClientRect()),
        texts: [...document.querySelectorAll('.hero h1, .hero p, .atlas-index li')].map((e) => e.getBoundingClientRect()),
      };
    });
    const inside = (p: { x: number; y: number }) => p.x >= geo.poster.x && p.x <= geo.poster.x + geo.poster.w && p.y >= geo.poster.y && p.y <= geo.poster.y + geo.poster.h;
    const vis = geo.dots.filter((d) => d.v === '1');
    for (const d of vis) expect(inside(d.c), 'index anchors sit on the poster').toBe(true);
    for (let i = 1; i < vis.length; i++) expect(vis[i].c.y, 'neck → chest → abdomen → knee → ankle').toBeGreaterThan(vis[i - 1].c.y);
    const hit = (a: DOMRect | { left: number; right: number; top: number; bottom: number } | null, b: DOMRect | null) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const t of geo.texts) expect(hit(t, geo.header), 'no hero text under the header').toBe(false);
    for (const row of geo.rows) expect(hit(row, geo.top), 'index rows clear of the model switch').toBe(false);
    expectClean(await g.problems(), `hero fallback ${w}`);
    await ctx.close();
  });
}

test('/booking deep links: every step by direct link, Back / Forward between steps — the linked step, step 1 never flashes (option A)', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await seedConsent(page);
  const g = guard(page, baseURL!);
  await deepLinksEveryStep(page);
  expectClean(await g.problems(), 'booking deep links');
});
