/**
 * Internal types = the BFF contract of ТЗ §08 ("Внутренние типы" + "Внутренний API сайта").
 * Components only know these types; at stage 2 the mock (lib/api/index.ts + mock-data.ts) is replaced by fetches to /api/booking/*.
 */
export type Locale = 'ru' | 'en';

/** Zone key from the README zone directory, side suffix included for paired zones: `knee_l`, `chest`. */
export type ZoneId = string;

export interface BodyMarker {
  id: string;
  zoneId: ZoneId;
  position: [number, number, number];
  note?: string;
  intensity?: number; // 1–10
}

export interface BookingDraft {
  model: 'male' | 'female';
  markers: BodyMarker[];
  generalNote?: string;
  serviceIds: number[];
  staffId: number; // 0 = any specialist
  datetime?: string; // ISO, +04:00
  utm?: Record<string, string>;
  locale: Locale;
}

export interface Contact {
  fullname: string;
  phone: string; // E.164
  email?: string;
  age?: number;
}

/** GET /api/booking/services?locale= */
export interface Service {
  id: number;
  title: string;
  categoryId: number;
  categoryTitle: string;
  /** Prototype: from site/copy/mock-data.json (client's plan). null = price on request. */
  priceMin: number | null;
  priceMax: number | null;
  /** true → «Цена — по запросу» (mock.price.onRequest) instead of a price. */
  priceOnRequest: boolean;
  /** null = not set yet (rehab services in the plan have no duration). */
  durationMin: number | null;
  /** Prototype-only: short description (stage 2: CMS). */
  description: string;
  /** Prototype-only: CMS document slug for /services/[slug] (stage 2: CMS «service» by altegioServiceId). */
  slug: string;
  /** Prototype-only: whether a CMS document exists (PG-04: one full page, one «Altegio data only»). */
  hasCms: boolean;
}

/** GET /api/booking/staff?serviceId= */
export interface Staff {
  id: number;
  name: string;
  position: string;
  avatarUrl: string | null;
  rating: number | null;
  nearestSlot: string | null; // ISO
  slug: string; // prototype-only: /team/[slug]
  /** prototype-only: «Специалист студии N» demo card (no real person behind it) — no Person JSON-LD for it (ТЗ §14). */
  placeholder: boolean;
}

/** GET /api/booking/times */
export interface Slot {
  datetime: string; // ISO with +04:00
  time: string; // "HH:mm"
}

export type CheckResult = { ok: true } | { error: 'slot_taken' };
export type RecordResult = { status: 'created'; recordId: number; hash: string } | { status: 'queued' };

/** GET /api/account/records */
export interface AccountRecord {
  id: number;
  hash: string;
  datetime: string;
  serviceTitle: string;
  staffName: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed'; // keys of messages account.status.*
  zones: ZoneId[];
  /** Altegio ids (prototype: «Записаться снова» pre-fills the booking) and the service length (calendar file) */
  serviceId?: number;
  staffId?: number;
  durationMin?: number | null;
}

export interface JournalArticle {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
}

/** zoneId → serviceId[] rules (ТЗ 6.6, CMS). Keys are base zone ids without the side suffix. */
export type ZoneServiceRules = Record<string, number[]>;
