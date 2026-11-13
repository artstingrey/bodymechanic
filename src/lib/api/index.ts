/**
 * Prototype API: same shapes and signatures as the BFF routes of ТЗ §08, backed by mock data.
 * Stage 2 replaces the bodies with `fetch('/api/booking/…')`; components do not change.
 */
import type { AccountRecord, BookingDraft, CheckResult, Contact, JournalArticle, Locale, RecordResult, Service, Slot, Staff, ZoneServiceRules } from './types';
import { ARTICLES, CATEGORIES, DEMO_RECORD, SERVICES, STAFF, ZONE_RULES } from './mock-data';
import { ApiError } from './errors';
import { consumeSlotTaken, failOnce, markTaken, mockMode, takenSlots } from './mock-flags';
import { hasTestSink, toTest } from '@/lib/dev/test-hook';

export { ApiError, errorKind } from './errors';
/** network-ish delay of the mock, so loading states are real (no delay during prerender) */
const latency = (ms = 120) => (typeof window === 'undefined' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

const DUBAI_OFFSET = '+04:00';
const pad = (n: number) => String(n).padStart(2, '0');

import { dubaiToday } from './dubai';
export { dubaiToday };
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00${DUBAI_OFFSET}`); d.setUTCDate(d.getUTCDate() + n); return dubaiToday(d); };

// GET /api/booking/services?locale=
export async function getServices(locale: Locale): Promise<Service[]> {
  return SERVICES.map((s) => ({
    id: s.id, title: s.title[locale], categoryId: s.categoryId,
    categoryTitle: CATEGORIES.find((c) => c.id === s.categoryId)!.title[locale],
    priceMin: s.priceMin, priceMax: s.priceMax, priceOnRequest: s.priceOnRequest, durationMin: s.durationMin,
    description: s.description[locale], slug: s.slug, hasCms: s.hasCms,
  }));
}
export const getCategories = (locale: Locale) => CATEGORIES.map((c) => ({ id: c.id, slug: c.slug, title: c.title[locale] }));

// GET /api/booking/staff?serviceId=  (server pages call it at build time — mock flags apply in the browser only)
export async function getStaff(locale: Locale, serviceId?: number): Promise<Staff[]> {
  if (typeof window !== 'undefined') { await latency(); failOnce('staff'); }
  const list = serviceId ? STAFF.filter((s) => s.serviceIds.includes(serviceId)) : STAFF;
  return list.map((s, i) => ({
    id: s.id, name: s.name[locale], position: s.position[locale], avatarUrl: s.avatarUrl, rating: s.rating, slug: s.slug, placeholder: true,
    nearestSlot: typeof window === 'undefined' ? null : `${addDays(dubaiToday(), 1 + i)}T${pad(10 + i)}:00:00${DUBAI_OFFSET}`,
  }));
}

/** The booking calendar spans 30 days from today (Dubai) — the UI shows unavailable days as aria-disabled, not removed. */
export const calendarDays = (today = dubaiToday()) => Array.from({ length: 30 }, (_, i) => addDays(today, i));

// GET /api/booking/dates?serviceId=&staffId=  → available dates within 30 days; demo: Fridays closed + one day per week
export async function getDates(_serviceId: number, staffId: number): Promise<string[]> {
  await latency(); failOnce('dates');
  if (mockMode() === 'nodates') return [];
  return calendarDays().filter((d, i) => new Date(`${d}T12:00:00${DUBAI_OFFSET}`).getUTCDay() !== 5 && (i + staffId) % 7 !== 3);
}

// GET /api/booking/times?serviceId=&staffId=&date=  → demo grid 10:00–20:00 every 30 min, some taken; slots that POST /check
// reported as taken are no longer offered
export async function getTimes(serviceId: number, staffId: number, date: string): Promise<Slot[]> {
  await latency(); failOnce('times');
  const seed = (serviceId + staffId + Number(date.slice(-2))) % 5;
  const taken = new Set(typeof window === 'undefined' ? [] : takenSlots());
  const out: Slot[] = [];
  for (let m = 10 * 60; m <= 20 * 60; m += 30) {
    const time = `${pad(m / 60 | 0)}:${pad(m % 60)}`, datetime = `${date}T${time}:00${DUBAI_OFFSET}`;
    if ((m / 30 + seed) % 4 !== 0 && !taken.has(datetime)) out.push({ time, datetime });
  }
  return out;
}

// POST /api/booking/code {phone} → {sent:true}
export async function postCode(_phone: string): Promise<{ sent: true }> { await latency(); return { sent: true }; }

// POST /api/booking/check {BookingDraft} → {ok:true} | {error:"slot_taken"}.
// Demo: 13:30 is always «taken»; ?mock=slot_taken makes the first check fail for any time. A taken slot leaves GET /times.
export async function postCheck(draft: BookingDraft): Promise<CheckResult> {
  await latency(); failOnce('check');
  if (draft.datetime && (draft.datetime.slice(11, 16) === '13:30' || consumeSlotTaken())) { markTaken(draft.datetime); return { error: 'slot_taken' }; }
  return { ok: true };
}

/**
 * POST /api/booking/record body (ТЗ §08): {BookingDraft, contact, code?, captchaToken, idempotencyKey} + source — the 3D flow or
 * the home form; the BFF picks the comment prefix [Сайт/3D] / [Сайт/форма] by it. UTM travel in draft.utm (first visit, ТЗ §14).
 */
export interface RecordRequest { draft: BookingDraft; contact: Contact; code?: string; captchaToken: string; idempotencyKey: string; source: '3d' | 'form' }
const records = new Map<string, RecordResult>(); // idempotency: the same key → the same answer

// POST /api/booking/record → {status:"created", recordId, hash} | {status:"queued"} (queued only with ?mock=queued)
export async function postRecord(req: RecordRequest): Promise<RecordResult> {
  await latency(); failOnce('record');
  if (!req.captchaToken) throw new ApiError('captcha');
  const hit = records.get(req.idempotencyKey);
  if (hit) return hit;
  const res: RecordResult = mockMode() === 'queued' ? { status: 'queued' } : { status: 'created', recordId: DEMO_RECORD.id, hash: DEMO_RECORD.hash };
  records.set(req.idempotencyKey, res);
  // stage 2: the BFF builds the record comment (lib/altegio/formatComment). The prototype builds it only for the gate, which
  // checks its text — RC-9 (security review S-1): the comment carries the visitor's notes about their wellbeing, so it is
  // neither stored (it used to stay in sessionStorage «bm.mock.lastComment») nor built at all in a page the gate does not drive
  if (hasTestSink()) {
    const { formatComment } = await import('@/lib/altegio/formatComment'); // lazy: never in the first-screen bundle
    const d = req.draft;
    toTest('booking-comment', formatComment({
      source: req.source, gender: req.source === '3d' ? d.model : undefined, age: req.contact.age, generalNote: d.generalNote, utm: d.utm,
      markers: d.markers.map((m) => ({ zoneId: m.zoneId, intensity: m.intensity, note: m.note })),
    }));
  }
  return res;
}

/** Minimal notice for online cancel / reschedule (Altegio setting; demo: 24 h). */
export const MIN_NOTICE_HOURS = 24;
export const tooLate = (datetime: string, now = Date.now()) => new Date(datetime).getTime() - now < MIN_NOTICE_HOURS * 3600_000;

// account mock state survives F5 (sessionStorage): cancelled ids and moved times
const ACC = 'bm.accountMock';
type AccState = { cancelled: number[]; moved: Record<number, string> };
const accState = (): AccState => { try { return { cancelled: [], moved: {}, ...JSON.parse(sessionStorage.getItem(ACC) || '{}') }; } catch { return { cancelled: [], moved: {} }; } };
const saveAcc = (s: AccState) => { try { sessionStorage.setItem(ACC, JSON.stringify(s)); } catch { /* ignore */ } };

/** ISO time in Dubai, rounded down to the hour, `hours` from now */
function dubaiIn(hours: number): string {
  const d = new Date(Date.now() + hours * 3600_000);
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dubai' }).format(d));
  return `${dubaiToday(d)}T${pad(h)}:00:00${DUBAI_OFFSET}`;
}

// GET /api/account/records → {upcoming, past}. Demo: 9001 in 3 days (can be cancelled / moved), 9002 in ~12 h (too late), 9000 past.
export async function getAccountRecords(locale: Locale): Promise<{ upcoming: AccountRecord[]; past: AccountRecord[] }> {
  if (typeof window !== 'undefined') { await latency(); failOnce('records'); }
  const s = SERVICES[0], st = STAFF[0], today = dubaiToday();
  const state: AccState = typeof window === 'undefined' ? { cancelled: [], moved: {} } : accState();
  const rec = (id: number, hash: string, datetime: string, status: AccountRecord['status']): AccountRecord => ({
    id, hash, datetime: state.moved[id] ?? datetime, serviceTitle: s.title[locale], staffName: st.name[locale],
    status: state.cancelled.includes(id) ? 'cancelled' : status, zones: ['lumbar', 'knee_l'], serviceId: s.id, staffId: st.id, durationMin: s.durationMin,
  });
  return {
    upcoming: [rec(DEMO_RECORD.id, DEMO_RECORD.hash, `${addDays(today, 3)}T11:00:00${DUBAI_OFFSET}`, 'confirmed'), rec(9002, 'demo-soon', dubaiIn(12), 'confirmed')],
    past: [rec(9000, 'demo-past', `${addDays(today, -20)}T11:00:00${DUBAI_OFFSET}`, 'completed')],
  };
}

// DELETE /api/account/records/:id → {cancelled:true} | {error:"too_late"}
export async function cancelRecord(record: AccountRecord): Promise<{ cancelled: true }> {
  await latency(); failOnce('cancel');
  if (tooLate(record.datetime)) throw new ApiError('tooLate');
  const s = accState(); s.cancelled = [...new Set([...s.cancelled, record.id])]; saveAcc(s);
  return { cancelled: true };
}

// PATCH /api/account/records/:id {datetime} → Record
export async function rescheduleRecord(record: AccountRecord, datetime: string): Promise<AccountRecord> {
  await latency(); failOnce('reschedule');
  if (tooLate(record.datetime)) throw new ApiError('tooLate');
  const s = accState(); s.moved[record.id] = datetime; saveAcc(s);
  return { ...record, datetime };
}

export const getArticles = (locale: Locale): JournalArticle[] => ARTICLES.map((a) => ({ slug: a.slug, title: a.title[locale], category: a.category[locale], excerpt: a.excerpt[locale] }));
export const getZoneRules = (): ZoneServiceRules => ZONE_RULES;

/** ТЗ 6.6: the service with the most matching zones wins (zone keys may carry _l/_r). */
export function recommendServices(zoneIds: string[], rules: ZoneServiceRules = ZONE_RULES): number[] {
  const score = new Map<number, number>();
  for (const z of zoneIds) for (const id of rules[z.replace(/_(l|r)$/, '')] ?? []) score.set(id, (score.get(id) ?? 0) + 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// static params for prerendering
export const serviceSlugs = () => SERVICES.map((s) => s.slug);
export const staffSlugs = () => STAFF.map((s) => s.slug);
export const articleSlugs = () => ARTICLES.map((a) => a.slug);
export const DEMO = DEMO_RECORD;
