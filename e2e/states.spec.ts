/**
 * States of the booking and the account (R-APP-01 F-01…F-07, N-04, N-05) — the reviewer's scenarios
 * (site/review/_src/app_v1/flows.py) ported to the gate, so the hi-fi layer cannot regress them.
 * Deterministic mock modes: ?mock=queued | slot_taken | offline | server | nodates (lib/api/mock-flags.ts).
 */
import { test, expect, chromium, type Page } from '@playwright/test';
import ru from '../messages/ru.json';
import en from '../messages/en.json';
import { guard, settle3D, expectClean, expectNoDemoLabels, seedConsent, toReview, testHook } from './helpers';
import zoneViews from '../src/lib/body3d/zone-views.json';
import { BASE_ZONES, PAIRED } from '../src/lib/body3d/zones';
import { calendarDays } from '../src/lib/api';

const ALL = BASE_ZONES.flatMap((z) => (PAIRED.has(z) ? [`${z}_l`, `${z}_r`] : [z])); // = Fallback2D ALL_KEYS (zone list order)

test.beforeEach(async ({ page }) => { await seedConsent(page); }); // the cookie card would cover the 3D slot
// RC-9 (S-3): `?mock=<mode>` is honoured only for the gate — every test of this file drives the stub's states (helpers.ts testHook)
test.beforeEach(async ({ page }) => { await testHook(page); });

test.describe('booking states (R-APP-01)', () => {
  test('F-01: ?step=7 without a booking does not show success — redirects to the first unfinished step', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?step=7', { waitUntil: 'networkidle' });
    await page.waitForURL(/step=2/);
    await expect(page.locator('h1')).not.toHaveText(en.booking.done.title);
    expectClean(await g.problems(), 'deep step 7');
  });

  test('F-01/F-02/F-04/F-06: full booking → step 7 with details and actions, F5 keeps it, the draft is cleared, focus moves', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await page.locator('#zone-list input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: en.body3d.panel.cta }).click();
    await page.waitForURL(/step=2/);
    // F-04: the focus lands on the step heading, the step is announced
    await expect(page.locator('#st2')).toBeFocused();
    await expect(page.getByTestId('booking-live')).toContainText(en.booking.step.service.title);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' }); // continue from step 1 with the same draft
    await toReview(page, { zones: 0 });
    // F-06: edit links per block, captcha place
    await expect(page.getByRole('button', { name: `${en.booking.review.edit}: ${en.booking.review.service}` })).toBeVisible();
    await page.getByRole('button', { name: en.booking.review.confirm }).click();
    await page.waitForURL(/step=7/);
    await expect(page.locator('#st7')).toHaveText(en.booking.done.title);
    await expect(page.locator('#st7')).toBeFocused();
    const done = page.locator('section[data-result="created"]');
    await expect(done).toContainText(en.booking.done.reference);
    await expect(done).toContainText(en.booking.done.date);
    await expect(done).toContainText(en.booking.done.specialist);
    // .ics is a real file
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: en.booking.done.calendarIcs }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.ics$/);
    const ics = await (await dl.createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8'));
    expect(ics).toMatch(/BEGIN:VCALENDAR[\s\S]*DTSTART:\d{8}T\d{6}Z/);
    await expect(page.getByRole('link', { name: en.booking.done.calendarGoogle })).toHaveAttribute('href', /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    await expect(page.getByRole('link', { name: en.booking.done.whatsapp })).toHaveAttribute('href', /^https:\/\/wa\.me\//);
    await expect(page.getByRole('button', { name: en.booking.done.pdf })).toBeVisible();
    // F5 keeps the confirmation; F-02: the draft is gone
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#st7')).toHaveText(en.booking.done.title);
    expect(await page.evaluate(() => [sessionStorage.getItem('bm.bookingDraft'), sessionStorage.getItem('bm.bookingSteps')])).toEqual([null, null]);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('b3d-marker')).toHaveCount(0);
    expectClean(await g.problems(), 'full booking');
  });

  test('F-01: ?mock=queued → «request received», never «confirmed», also after F5', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?mock=queued', { waitUntil: 'networkidle' });
    await toReview(page);
    await page.getByRole('button', { name: en.booking.review.confirm }).click();
    await page.waitForURL(/step=7/);
    await expect(page.locator('#st7')).toHaveText(en.booking.queued.title);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#st7')).toHaveText(en.booking.queued.title);
    expectClean(await g.problems(), 'queued');
  });

  test('F-04/F-07: slot_taken → back to step 4, the alert has the focus, the taken slot is no longer offered', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await toReview(page, { slot1330: true });
    await page.getByRole('button', { name: en.booking.review.confirm }).click();
    await page.waitForURL(/step=4/);
    await expect(page.locator('#booking-error')).toBeFocused();
    await expect(page.locator('#booking-error')).toContainText(en.booking.error.slotTaken);
    await expect(page.locator('.booking-loading')).toHaveCount(0);
    await page.locator('.times button').first().waitFor();
    await expect(page.locator('.times button', { hasText: '13:30' })).toHaveCount(0);
    expectClean(await g.problems(), 'slot taken');
  });

  test('F-07: network error → message + «Try again» → data', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?mock=offline', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: en.body3d.panel.skip }).click();
    await page.locator('input[name="service"]').first().check();
    await page.getByRole('button', { name: en.common.actions.next }).click();
    await expect(page.locator('.booking-error')).toContainText(en.booking.error.network);
    await page.getByRole('button', { name: en.common.actions.retry }).click();
    await expect(page.locator('input[name="staff"]')).not.toHaveCount(1); // «any» + the specialists
    expectClean(await g.problems(), 'offline');
  });

  test('F-07: 30-day calendar keeps unavailable days (aria-disabled), slots grouped by part of the day; no dates → WhatsApp', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: en.body3d.panel.skip }).click();
    await page.locator('input[name="service"]').first().check();
    await page.goto('/en/booking/?step=4', { waitUntil: 'networkidle' });
    await expect(page.locator('.dates button')).toHaveCount(30);
    expect(await page.locator('.dates button[aria-disabled="true"]').count()).toBeGreaterThan(0);
    await page.locator('.dates button:not([aria-disabled])').first().click();
    await expect(page.locator('.times [role="group"]').first()).toHaveAttribute('aria-label', /Morning|Afternoon|Evening/);
    await page.goto('/en/booking/?step=4&mock=nodates', { waitUntil: 'networkidle' });
    await expect(page.getByText(en.booking.time.noDates)).toBeVisible();
    await expect(page.getByRole('link', { name: en.common.actions.writeWhatsapp })).toHaveAttribute('href', /^https:\/\/wa\.me\//);
    await page.goto('/en/booking/?mock=off', { waitUntil: 'networkidle' });
    expectClean(await g.problems(), 'calendar');
  });
});

test.describe('3D panel states (R-APP-01)', () => {
  // RC-9 (security review Ж-5): sessionStorage lives as long as the tab and comes back with restored tabs — the draft
  // (zones, notes, name, phone) and the confirmation are dropped a day after their last change (lib/booking/draft-ttl)
  test('a draft older than a day is dropped: zones, notes, contacts and the confirmation do not wait in a restored tab', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await page.locator('#zone-list input[type="checkbox"]').first().check();
    await page.locator('textarea[maxlength="1000"]').fill('old knee injury');
    await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
    const stamp = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('bm.bookingDraft')!) as { savedAt?: number }).savedAt);
    expect(Math.abs(Date.now() - (stamp ?? 0)), 'the draft carries the time of its last change').toBeLessThan(60_000);
    const age = (hours: number) => page.evaluate((h) => {
      const at = Date.now() - h * 3600_000;
      const d = JSON.parse(sessionStorage.getItem('bm.bookingDraft')!);
      sessionStorage.setItem('bm.bookingDraft', JSON.stringify({ ...d, savedAt: at }));
      sessionStorage.setItem('bm.bookingSteps', JSON.stringify({ serviceId: 101, staffId: 0, date: null, datetime: null, contact: { fullname: 'Demo', phone: '+971500000000', email: '', consent: true, health: true }, savedAt: at }));
      sessionStorage.setItem('bm.bookingResult', JSON.stringify({ status: 'created', recordId: 9001, hash: 'demo-hash', datetime: '2026-11-20T11:00:00+04:00', serviceTitle: 'Demo', durationMin: 100, staffName: null, zones: ['lumbar'], at: new Date(at).toISOString() }));
    }, hours);
    const left = () => page.evaluate(() => ['bm.bookingDraft', 'bm.bookingSteps', 'bm.bookingResult'].filter((k) => sessionStorage.getItem(k) !== null));
    await age(23); // within the day: everything is still there
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
    await expect(page.getByText(en.booking.draft.restoreTitle)).toBeVisible();
    expect(await left()).toEqual(['bm.bookingDraft', 'bm.bookingSteps', 'bm.bookingResult']);
    await age(25); // later: gone from the page and from the storage
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('b3d-marker')).toHaveCount(0);
    await expect(page.getByText(en.booking.draft.restoreTitle)).toHaveCount(0);
    expect(await left()).toEqual([]);
    expectClean(await g.problems(), 'draft lifetime');
  });

  test('limit 10, F5 restores the draft with «Continue / Start over» (N-04), «Clear all» → confirm → «Undo» (F-03)', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    const boxes = page.locator('#zone-list input[type="checkbox"]');
    for (let i = 0; i < 11; i++) await boxes.nth(i).click();
    await expect(page.getByTestId('b3d-marker')).toHaveCount(10);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('b3d-marker')).toHaveCount(10);
    await expect(page.getByText(en.booking.draft.restoreTitle)).toBeVisible();
    await page.getByRole('button', { name: en.booking.draft.continue, exact: true }).click();
    await expect(page.getByText(en.booking.draft.restoreTitle)).toHaveCount(0);
    // F-03
    await page.getByRole('button', { name: en.body3d.panel.clearAll }).click();
    const dialog = page.locator('dialog.b3d-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: en.body3d.panel.clearConfirmNo })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('b3d-marker')).toHaveCount(10);
    await page.getByRole('button', { name: en.body3d.panel.clearAll }).click();
    await dialog.getByRole('button', { name: en.body3d.panel.clearConfirmYes }).click();
    await expect(page.getByTestId('b3d-marker')).toHaveCount(0);
    await page.getByRole('button', { name: en.body3d.panel.undo }).click();
    await expect(page.getByTestId('b3d-marker')).toHaveCount(10);
    expectClean(await g.problems(), '3D panel');
  });

  test('N-05: two adjacent selected zones keep a divider (chest | abdomen)', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await settle3D(page);
    await page.addStyleTag({ content: '.b3d-pin { visibility: hidden !important; }' });
    await page.locator('.b3d-slot').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!window.__bm3d?.anchors);
    await page.evaluate(() => window.__bm3d!.anchors!.watch());
    await page.waitForFunction(() => window.__bm3d!.anchors!.get().zones.length > 0);
    for (const z of [en.body3d.zones.chest, en.body3d.zones.abdomen]) await page.getByRole('checkbox', { name: z, exact: true }).check();
    await page.waitForFunction(() => window.__bm3d?.outline?.() === 'screen');
    const f0 = await page.evaluate(() => window.__bm3d!.frames);
    await page.waitForFunction((n) => window.__bm3d!.frames > n + 5, f0);
    const a = await page.evaluate(() => window.__bm3d!.anchors!.get());
    const chest = a.zones.find((z) => z.zoneId === 'chest')!, abdomen = a.zones.find((z) => z.zoneId === 'abdomen')!;
    const png = await page.locator('.b3d-slot').screenshot();
    // brightness profile of the column between the two anchors: both zones are selected (white veil), so only a divider
    // can make a clear dip in it
    const dip = await page.evaluate(async ({ b64, x, y0, y1 }) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g2 = c.getContext('2d')!; g2.drawImage(img, 0, 0);
      const k = img.width / document.querySelector('.b3d-slot')!.getBoundingClientRect().width;
      const lum: number[] = [];
      for (let y = Math.round((y0 + 8) * k); y < Math.round((y1 - 8) * k); y++) {
        let row = 255;
        for (let dx = -3; dx <= 3; dx++) { const d = g2.getImageData(Math.round(x * k) + dx, y, 1, 1).data; row = Math.min(row, 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]); }
        lum.push(row);
      }
      const sorted = [...lum].sort((p, q) => p - q);
      return sorted[Math.floor(sorted.length / 2)] - sorted[0]; // median − minimum
    }, { b64: png.toString('base64'), x: (chest.x + abdomen.x) / 2, y0: Math.min(chest.y, abdomen.y), y1: Math.max(chest.y, abdomen.y) });
    test.info().annotations.push({ type: 'divider dip', description: dip.toFixed(1) });
    expect(dip, 'a divider line between chest and abdomen (texture alone ≈ 5, divider ≈ 37 at DPR 1)').toBeGreaterThan(20);
    expectClean(await g.problems(), 'divider');
  });
});

test.describe('account (R-APP-01 F-05)', () => {
  test('login, too_late, cancel dialog (focus, Esc), cancel, reschedule with confirmation, book again pre-filled', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/account/', { waitUntil: 'networkidle' });
    await page.locator('#acc-phone').fill('+971501234567');
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await expect(page.getByRole('status')).toHaveText(en.account.login.codeNotice);
    await page.locator('input[autocomplete="one-time-code"]').fill('1234');
    await expect(page.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled();
    await page.getByRole('button', { name: en.account.login.submit }).click();
    const cards = page.getByTestId('account-record');
    await expect(cards).toHaveCount(3);
    await expect(page.getByText(en.account.sampleRecords)).toBeVisible();
    await expectNoDemoLabels(page);
    // the record in ~12 h: too late — actions disabled, WhatsApp offered
    const late = page.locator('[data-testid="account-record"][data-late]');
    await expect(late).toHaveCount(1);
    await expect(late.getByRole('button', { name: en.account.action.cancel })).toBeDisabled();
    await expect(late.getByRole('link', { name: en.common.actions.writeWhatsapp })).toBeVisible();
    // cancel dialog: focus inside, Esc closes and returns the focus
    const first = cards.first();
    const cancelBtn = first.getByRole('button', { name: en.account.action.cancel });
    await cancelBtn.click();
    const dlg = first.locator('dialog.account-cancel');
    await expect(dlg).toBeVisible();
    await expectNoDemoLabels(page);
    await expect(dlg.getByRole('button', { name: en.account.cancel.keep })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(cancelBtn).toBeFocused();
    // reschedule: dates and times of THIS record → PATCH → confirmation
    await first.getByRole('button', { name: en.account.action.reschedule }).click();
    // a day ≥ 3 days ahead: «tomorrow 10:30» is already within 24 h after 10:30 Dubai time → too_late, and the real cancel below
    // found its button disabled (the test failed by the clock, not by the site)
    await first.locator('.dates button:not([aria-disabled])').nth(3).click();
    await first.locator('.times button').first().click();
    await first.getByRole('button', { name: en.account.reschedule.confirm }).click();
    await expect(first.getByRole('status')).toContainText(en.account.reschedule.success.split('{')[0].trim());
    // cancel for real
    await cancelBtn.click();
    await dlg.getByRole('button', { name: en.account.cancel.confirm }).click();
    await expect(first).toContainText(en.account.status.cancelled);
    await expect(first.getByRole('status')).toContainText(en.account.cancel.success);
    await expectNoDemoLabels(page);
    // past: book again — the service and the specialist are handed over at the click, the link itself is bare (RC-10, Ж-9;
    // that they arrive: seo.spec «Book again» from the account)
    await expect(cards.last().getByRole('link', { name: en.common.actions.bookAgain })).toHaveAttribute('href', '/en/booking/');
    expectClean(await g.problems(), 'account');
  });
});

test.describe('2D mode — body2d-callouts (ТЗ 6.10/6.11)', () => {
  const zone = (page: Page, view: 0 | 1, id: string) => page.locator('.b2d-stage svg').nth(view).locator(`.b2d-zone[data-zone-id="${id}"]`);
  const to2d = async (page: Page) => {
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await page.getByTestId('switch-2d').click();
    await page.locator('.b2d-stage svg .b2d-zone').first().waitFor();
  };

  test('clicks on all 4 silhouettes, same numbering as the marker list, aria-live «Marker N: zone»', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await to2d(page);
    for (const model of ['male', 'female'] as const) {
      if (model === 'female') { await page.getByRole('button', { name: en.body3d.mode2d.tryAgain }).click(); await page.getByRole('button', { name: en.body3d.model.female, exact: true }).first().click(); await page.getByTestId('switch-2d').click(); await page.locator('.b2d-stage svg[data-model="female"]').first().waitFor(); }
      await zone(page, 0, 'chest').dispatchEvent('click');
      await zone(page, 1, 'lumbar').dispatchEvent('click');
    }
    // male: chest 1, lumbar 2; female: chest/lumbar already selected → toggled off; so re-add on the female figure
    await expect(page.getByTestId('b3d-marker')).toHaveCount(0);
    await zone(page, 0, 'knee_l').dispatchEvent('click');
    await expect(page.getByTestId('b3d-live')).toContainText(`Marker 1: ${en.body3d.zones.left.replace('{zone}', en.body3d.zones.knee)}`);
    await zone(page, 1, 'calves_r').dispatchEvent('click');
    await expect(zone(page, 0, 'knee_l')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.b2d-stage svg').nth(1).locator('.b2d-badge')).toContainText(['1', '2']);
    await expect(page.getByTestId('b3d-marker')).toHaveCount(2);
    expectClean(await g.problems(), '2D clicks');
  });

  test('keyboard: Tab reaches a zone (focus ring + crosshair), Space toggles it', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await to2d(page);
    const z = zone(page, 0, 'abdomen');
    await z.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // keyboard focus → :focus-visible
    await expect(z).toBeFocused();
    await expect(page.locator('.b2d-stage svg').first().locator('.b2d-focus-ring')).toHaveCount(1);
    await page.keyboard.press(' ');
    await expect(z).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(z).toHaveAttribute('aria-checked', 'false');
    expectClean(await g.problems(), '2D keyboard');
  });

  for (const [w, modes] of [[390, ['none']], [1280, ['compact', 'full']], [1920, ['compact', 'full']]] as const) {
    test(`callout mode at ${w}px: ${modes.join(' | ')}`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, baseURL });
      const page = await ctx.newPage();
      await seedConsent(page);
      await to2d(page);
      await zone(page, 0, 'chest').dispatchEvent('click');
      await page.waitForFunction(() => !!document.querySelector('.b2d-stage svg')?.getAttribute('data-callouts'));
      const mode = await page.locator('.b2d-stage svg').first().getAttribute('data-callouts');
      expect(modes as readonly string[]).toContain(mode);
      await ctx.close();
    });
  }

  test('3D ↔ 2D keeps the markers and their numbers', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/', { waitUntil: 'networkidle' });
    await settle3D(page);
    for (const z of [en.body3d.zones.chest, en.body3d.zones.abdomen]) await page.getByRole('checkbox', { name: z, exact: true }).check();
    await page.getByTestId('switch-2d').click();
    await page.locator('.b2d-stage svg .b2d-zone').first().waitFor();
    await expect(page.locator('.b2d-stage svg').first().locator('.b2d-badge')).toContainText(['1', '2']);
    await zone(page, 1, 'lumbar').dispatchEvent('click'); // marker 3 in 2D
    await page.getByRole('button', { name: en.body3d.mode2d.tryAgain }).click();
    await settle3D(page);
    await expect(page.getByTestId('b3d-marker')).toHaveCount(3);
    await expect(page.getByTestId('b3d-marker').nth(2)).toContainText(en.body3d.zones.lumbar);
    expectClean(await g.problems(), '3D ↔ 2D');
  });
});

test.describe('2D without WebGL on /booking (R-APP-02 F-01)', () => {
  const checks = async (page: Page, msgs: typeof en) => {
    const slot = page.locator('.b3d-slot[data-mode="booking"]');
    await expect(slot).toHaveAttribute('data-mode2d', 'noWebgl');
    const front = page.locator('.b2d-stage svg').first();
    await front.locator('.b2d-zone').first().waitFor();
    // labels in the page language; no 3D tools in 2D; no way back to 3D without WebGL
    await expect(front.locator('.b2d-zone[data-zone-id="chest"]')).toHaveAttribute('aria-label', msgs.body3d.zones.chest);
    await expect(page.getByRole('button', { name: msgs.body3d.toolbar.rotate, exact: true })).toHaveCount(0);
    await expect(page.getByTestId('switch-3d')).toHaveCount(0);
    // diagram → marker list
    await front.locator('.b2d-zone[data-zone-id="chest"]').click();
    await expect(page.getByTestId('b3d-marker')).toHaveCount(1);
    await expect(front.locator('.b2d-zone[data-zone-id="chest"]')).toHaveAttribute('aria-checked', 'true');
    // list → diagram (same number)
    await page.locator('#zone-list').getByRole('checkbox', { name: msgs.body3d.zones.left.replace('{zone}', msgs.body3d.zones.knee), exact: true }).check();
    await expect(front.locator('.b2d-zone[data-zone-id="knee_l"]')).toHaveAttribute('aria-checked', 'true');
    await expect(front.locator('.b2d-badge')).toContainText(['1', '2']);
    // size: the whole figure fits the screen
    await front.scrollIntoViewIfNeeded();
    const box = (await front.boundingBox())!, vh = page.viewportSize()!.height;
    expect(box.height, 'figure height ≤ viewport').toBeLessThanOrEqual(vh);
  };

  test('real browser without WebGL (--disable-3d-apis), RU, 1280: 2D on its own, click and list in sync, size', async ({ baseURL }) => {
    const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-3d-apis'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, baseURL });
    await seedConsent(page);
    const g = guard(page, baseURL!);
    await page.goto('/ru/booking/', { waitUntil: 'networkidle' });
    await checks(page, ru as typeof en);
    expectClean(await g.problems(), 'no WebGL 1280');
    await browser.close();
  });

  test('390 touch (?debug=nowebgl): tap marks a zone, keyboard Space/Enter, list in sync, size', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL });
    const page = await ctx.newPage();
    await seedConsent(page);
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?debug=nowebgl', { waitUntil: 'networkidle' });
    await checks(page, en);
    // < 600 px: one figure + «Front / Back» (lead's decision) — the back figure appears after «Back»
    const back = page.locator('.b2d-stage svg').nth(1);
    const sideSwitch = page.getByRole('group', { name: en.body3d.mode2d.badge }).getByRole('button', { name: en.body3d.list.groupBack, exact: true });
    await expect(back).toBeHidden();
    await sideSwitch.tap();
    await expect(sideSwitch).toHaveAttribute('aria-pressed', 'true');
    await expect(back).toBeVisible();
    await expect(page.locator('.b2d-stage svg').first()).toBeHidden();
    await back.locator('.b2d-zone[data-zone-id="lumbar"]').tap();
    await expect(page.getByTestId('b3d-marker')).toHaveCount(3);
    await expect(page.getByTestId('b3d-live')).toContainText(`Marker 3: ${en.body3d.zones.lumbar}`);
    const z = back.locator('.b2d-zone[data-zone-id="gluteal_l"]');
    await z.focus();
    await page.keyboard.press('Space');
    await expect(z).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(z).toHaveAttribute('aria-checked', 'false');
    expectClean(await g.problems(), 'no WebGL 390');
    await ctx.close();
  });
});

/**
 * M-01 (R-APP-02 / R-CODE-03): numbers of markers chosen from the zone list. The anchor of a zone without a front surface
 * (2D front silhouette = lib/body3d/zone-views.json) lies on the back; the number is hidden by real occlusion. All 31 zones,
 * in batches of ≤ 10 markers (limit), pairs in the same batch.
 */
test.describe('marker numbers from the zone list (M-01)', () => {
  // lead: if it fails again, keep the trace (copied across runs by e2e/keep-failures.ts). Manual tracing: test.use({ trace })
  // is not allowed inside a describe (it forces a new worker)
  test.beforeEach(async ({ context }) => { await context.tracing.start({ screenshots: true, snapshots: true }); });
  test.afterEach(async ({ context }, ti) => {
    if (ti.status === ti.expectedStatus) { await context.tracing.stop(); return; }
    const path = ti.outputPath('trace.zip');
    await context.tracing.stop({ path });
    ti.attachments.push({ name: 'trace', path, contentType: 'application/zip' });
  });
  for (const model of ['male', 'female'] as const) {
    test(`${model}: front view — only zones with a front surface, each number on its own zone; back view — the reverse; pairs symmetric`, async ({ page, baseURL }) => {
      test.setTimeout(150_000);
      const views = (zoneViews as unknown as Record<string, { front: string[]; back: string[] }>)[model];
      const backOnly = views.back.filter((k) => !views.front.includes(k));
      const frontOnly = views.front.filter((k) => !views.back.includes(k));
      const g = guard(page, baseURL!);
      await page.goto('/en/booking/', { waitUntil: 'networkidle' });
      await settle3D(page);
      if (model === 'female') {
        await page.getByRole('button', { name: en.body3d.model.female, exact: true }).click();
        await page.waitForFunction(() => window.__bm3d?.model() === 'female' && document.querySelector<HTMLElement>('.b3d-slot')?.dataset.status === 'ready');
      }
      // batches by base zone (pairs stay together), ≤ 10 markers each
      const batches: string[][] = [[]];
      for (const z of BASE_ZONES) {
        const keys = PAIRED.has(z) ? [`${z}_l`, `${z}_r`] : [z];
        if (batches.at(-1)!.length + keys.length > 10) batches.push([]);
        batches.at(-1)!.push(...keys);
      }
      const box = (k: string) => page.locator('#zone-list input[type="checkbox"]').nth(ALL.indexOf(k));
      const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const readPins = () => page.$$eval('.b3d-pin', (els) => els.map((e) => {
        const r = e.getBoundingClientRect();
        return { n: Number((e as HTMLElement).dataset.n), hidden: (e as HTMLElement).dataset.back === 'true', x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }));
      // lead (live run under load): read the numbers only once they stand still — two readings a frame pair apart with the
      // same coordinates and visibility (the camera damping / the anchor projection may still be settling)
      const stablePins = async () => {
        let prev = await readPins();
        for (let i = 0; i < 60; i++) {
          await frames();
          const cur = await readPins();
          if (cur.length === prev.length && cur.every((p, j) => p.hidden === prev[j].hidden && Math.abs(p.x - prev[j].x) < 0.5 && Math.abs(p.y - prev[j].y) < 0.5)) return cur;
          prev = cur;
        }
        return prev;
      };
      const problems: string[] = [];
      for (const batch of batches) {
        for (const k of batch) { await box(k).focus(); await page.keyboard.press('Space'); }
        await expect(page.locator('.b3d-pin')).toHaveCount(batch.length); // every marker anchored on the surface
        // the zone list is below the slot: focusing it scrolls the canvas away, and an off-screen canvas does not draw
        await page.evaluate(() => document.querySelector('.b3d-slot')!.scrollIntoView({ block: 'center' }));
        for (const [view, yaw] of [['front', 0], ['back', Math.PI]] as const) {
          await page.evaluate((y) => window.__bm3d!.yaw!(y), yaw);
          await frames(); await frames();
          const pins = await stablePins();
          const canvas = (await page.locator('.b3d-slot canvas').boundingBox())!;
          const at: Record<string, (typeof pins)[number]> = {};
          for (const p of pins) at[batch[p.n - 1]] = p;
          for (const k of batch) {
            const p = at[k];
            const allowed = view === 'front' ? views.front : views.back;
            const must = view === 'front' ? views.front : backOnly; // front view: every zone with a front surface; back view: back-only zones
            if (!p.hidden && !allowed.includes(k)) problems.push(`${view}: ${k} visible`);
            if (p.hidden && must.includes(k)) problems.push(`${view}: ${k} hidden`);
            if (view === 'back' && !p.hidden && frontOnly.includes(k)) problems.push(`back: front-only ${k} visible`);
            if (!p.hidden) {
              const under = await page.evaluate(([x, y]) => window.__bm3d!.pick!(x, y), [p.x, p.y] as const);
              if (under !== k) problems.push(`${view}: number of ${k} lies on ${under}`);
            }
          }
          // pairs: same visibility, mirrored around the body axis (screen centre of the canvas)
          const cx = canvas.x + canvas.width / 2;
          for (const k of batch.filter((q) => q.endsWith('_l'))) {
            const l = at[k], r = at[k.replace(/_l$/, '_r')];
            if (l.hidden !== r.hidden) problems.push(`${view}: pair ${k} visibility differs`);
            else if (!l.hidden && (Math.abs((l.x - cx) + (r.x - cx)) > 0.03 * canvas.width || Math.abs(l.y - r.y) > 0.03 * canvas.height)) {
              problems.push(`${view}: pair ${k} not symmetric (${Math.round(l.x - cx)}/${Math.round(r.x - cx)}, ${Math.round(l.y)}/${Math.round(r.y)})`);
            }
          }
        }
        await page.evaluate(() => window.__bm3d!.yaw!(0));
        for (const k of batch) { await box(k).focus(); await page.keyboard.press('Space'); }
        await expect(page.locator('.b3d-pin')).toHaveCount(0);
      }
      expect(problems).toEqual([]);
      expectClean(await g.problems(), `M-01 ${model}`);
    });
  }
});

/**
 * R-CODE-02 F-02: the burger menu keeps the reader's place — scrollY before opening = after opening = after closing.
 * Opened with focus + Enter and a real mouse click at the button's coordinates: locator.click() would scroll the sticky
 * header's button into view by itself (a Playwright artefact, not the site's behaviour — Web Art Director).
 */
test('burger menu keeps the scroll position (open / Esc / × at scrollY 1500)', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForFunction(() => Math.abs(window.scrollY - 1500) < 2);
  const btn = page.getByRole('button', { name: en.nav.burger.open });
  const y = () => page.evaluate(() => Math.round(window.scrollY));
  // keyboard (focus as Tab gives it: locator.focus() = element.focus() would scroll the page by itself)
  await btn.evaluate((e) => (e as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(await y(), 'after opening (Enter)').toBe(1500);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await y(), 'after Esc').toBe(1500);
  // mouse at the coordinates
  const b = (await btn.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  expect(await y(), 'after opening (mouse)').toBe(1500);
  const close = page.getByRole('button', { name: en.nav.burger.close }); // RC-8: the cross is the burger in the header
  const c = (await close.boundingBox())!;
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await y(), 'after ×').toBe(1500);
  expectClean(await g.problems(), 'burger scroll');
});

/**
 * R-CODE-02 F-05 (A11Y-05): own validation in every form — noValidate, aria-invalid + error text in the DOM tied with
 * aria-describedby, focus on the first invalid field, a role=alert summary for several errors; phone in E.164.
 */
test.describe('form validation (R-CODE-02 F-05)', () => {
  const E = en.forms.error;
  /** the field is invalid and its error text is what aria-describedby points to */
  async function expectFieldError(page: Page, id: string, text: string) {
    const el = page.locator(`#${id}`);
    await expect(el, id).toHaveAttribute('aria-invalid', 'true');
    const ids = (await el.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
    const texts = await Promise.all(ids.map((d) => page.locator(`[id="${d}"]`).textContent()));
    expect(texts.join(' | '), `${id} described by its error`).toContain(text);
  }

  test('home «Start with yourself»: email is required, invalid contacts are explained on blur', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/', { waitUntil: 'networkidle' });
    const form = page.locator('form.qform');
    await expect(form).toHaveAttribute('novalidate', '');
    await expect(form.getByRole('button', { name: en.home.form.submit, exact: true })).toBeDisabled();
    const email = page.locator('#qf-email');
    await expect(email).toHaveAttribute('required', '');
    await email.focus();
    await email.blur();
    await expectFieldError(page, 'qf-email', E.required);
    await email.fill('invalid');
    await email.blur();
    await expectFieldError(page, 'qf-email', E.emailInvalid);
    await email.fill('visitor@example.test');
    await expect(email).not.toHaveAttribute('aria-invalid', 'true');
    await page.locator('#qf-phone').fill('+971 5012');
    await page.locator('#qf-phone').blur();
    await expectFieldError(page, 'qf-phone', E.phoneInvalid);
    expectClean(await g.problems(), 'home form validation');
  });

  test('booking step 5: empty submit → name, phone, both consents, focus on the name; bad phone / age; valid → step 6', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/booking/?step=5', { waitUntil: 'networkidle' });
    const next = page.getByRole('button', { name: en.booking.contacts.next, exact: true });
    await next.click();
    await expect(page.locator('#c-name')).toBeFocused();
    await expectFieldError(page, 'c-name', E.required);
    await expectFieldError(page, 'c-phone', E.required);
    await expectFieldError(page, 'c-consent', E.consentRequired);
    await expectFieldError(page, 'c-health', E.healthRequired);
    await expect(page.locator('.form-errors[role="alert"] li')).toHaveCount(4);
    await expect(page).toHaveURL(/step=5/);
    await page.locator('#c-name').fill('Demo');
    await page.locator('#c-phone').fill('+97150');
    await page.locator('#c-age').fill('200');
    for (const id of ['c-consent', 'c-health']) await page.locator(`#${id}`).check();
    await next.click();
    await expect(page.locator('#c-phone')).toBeFocused();
    await expectFieldError(page, 'c-phone', E.phoneInvalid);
    await expectFieldError(page, 'c-age', E.ageRange.replace('{min}', '1').replace('{max}', '120'));
    await page.locator('#c-phone').fill('+971 50 123 45 67');
    await page.locator('#c-age').fill('34');
    await next.click();
    await page.waitForURL(/step=6/);
    // stored in E.164 for the BFF
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps') || '{}').contact?.phone)).toBe('+971501234567');
    expectClean(await g.problems(), 'step 5 validation');
  });

  test('«My bookings» login: empty / wrong phone and empty code are named in the field, focus on it', async ({ page, baseURL }) => {
    const g = guard(page, baseURL!);
    await page.goto('/en/account/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await expect(page.locator('#acc-phone')).toBeFocused();
    await expectFieldError(page, 'acc-phone', E.required);
    await page.locator('#acc-phone').fill('123');
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await expectFieldError(page, 'acc-phone', E.phoneInvalid);
    await page.locator('#acc-phone').fill('+971501234567');
    await page.getByRole('button', { name: en.account.login.getCode }).click();
    await page.getByRole('button', { name: en.account.login.submit }).click();
    await expect(page.locator('#acc-code')).toBeFocused();
    await expectFieldError(page, 'acc-code', E.required);
    await page.locator('#acc-code').fill('1234');
    await page.getByRole('button', { name: en.account.login.submit }).click();
    await expect(page.getByTestId('account-record')).toHaveCount(3);
    expectClean(await g.problems(), 'login validation');
  });
});

/**
 * Specialist's «nearest windows» → booking with the specialist, the day and the time (R-FINAL-2): the service first (none
 * preset), then straight to step 4 on that day. (The slot itself: mobile.spec «specialist slot».) RC-10, Ж-9: the link is
 * /booking/?step=2 and nothing else — the specialist, the day and the time are handed over at the click; a link from
 * outside may still carry them (?staff&date&time), as the deep link at the end does.
 */
test('nearest windows carry the day: after the service is chosen the calendar opens on it', async ({ page, baseURL }) => {
  const g = guard(page, baseURL!);
  await page.goto('/en/team/specialist-1/', { waitUntil: 'networkidle' });
  const link = page.locator('main a[href="/en/booking/?step=2"]').first();
  await link.click();
  await page.waitForURL(/\/en\/booking\/\?step=2$/);
  const handed = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bm.bookingSteps')!)) as { staffId: number; wantDate: string };
  const day = handed.wantDate;
  expect(handed.staffId).toBe(201);
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.locator('input[name="service"]').first().check();
  await page.getByRole('button', { name: en.common.actions.next, exact: true }).click();
  await page.waitForURL(/step=4/); // the specialist came with the link: step 3 is skipped forward
  const pressedIndex = () => page.evaluate(() => [...document.querySelectorAll('.dates button')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
  await expect.poll(pressedIndex).toBe(calendarDays().indexOf(day));
  await expect(page.locator('.times button').first()).toBeVisible(); // the day's slots, without a click
  // a later free day by deep link
  const free = await page.evaluate(() => [...document.querySelectorAll('.dates button')].map((b, i) => (b.getAttribute('aria-disabled') ? -1 : i)).filter((i) => i >= 0));
  const later = calendarDays()[free[3]];
  await page.goto(`/en/booking/?service=101&staff=201&step=4&date=${later}`, { waitUntil: 'networkidle' });
  await expect.poll(pressedIndex).toBe(free[3]);
  expectClean(await g.problems(), '?date=');
});

test('D-05: the phone field on /account is the same kit field as on the home page (one border, «*» on the label line)', async ({ page, baseURL }) => {
  await seedConsent(page);
  const g = guard(page, baseURL!);
  const look = (sel: string) => page.locator(sel).evaluate((input) => {
    const box = input.closest('.input')!, label = input.closest('.field')!.querySelector('label')!, req = label.querySelector('.req')!;
    const cs = getComputedStyle(input), lr = label.getBoundingClientRect(), rr = req.getBoundingClientRect();
    return {
      inputShadow: cs.boxShadow, inputRadius: cs.borderRadius, inputBorder: cs.borderTopWidth, inputBg: cs.backgroundColor,
      boxShadow: getComputedStyle(box).boxShadow, labelDisplay: getComputedStyle(label).display,
      reqOnLabelLine: Math.abs(rr.top - lr.top) < 4,
    };
  });
  await page.goto('/en/', { waitUntil: 'networkidle' });
  const home = await look('#qf-phone');
  await page.goto('/en/account/', { waitUntil: 'networkidle' });
  const account = await look('#acc-phone');
  expect(account.reqOnLabelLine, '«*» on the label line').toBe(true);
  expect(account.inputShadow, 'no second border inside the field').toBe('none');
  expect(account).toEqual(home);
  expectClean(await g.problems(), 'D-05 phone field');
});
