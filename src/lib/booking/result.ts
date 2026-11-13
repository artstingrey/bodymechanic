'use client';
/**
 * Result of the booking (R-APP-01 F-01/F-02): kept in sessionStorage so step 7 survives F5 and a queued request never
 * turns into «confirmed». Saved together with a snapshot of the choice, because the draft itself is cleared on success.
 */
import type { RecordResult } from '@/lib/api/types';
import { draftExpired } from './draft-ttl';

export type BookingResult = RecordResult & {
  datetime: string; // ISO, +04:00
  serviceTitle: string;
  durationMin: number | null;
  staffName: string | null; // null = «Любой специалист»
  zones: string[];
  at: string;
};
const KEY = 'bm.bookingResult';

export function saveResult(r: BookingResult) { try { sessionStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ } }
export function loadResult(): BookingResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    const r = raw ? (JSON.parse(raw) as BookingResult) : null;
    // Ж-5 (lib/booking/draft-ttl): the confirmation — with the zones of the record — does not wait in a restored tab for
    // more than a day after the booking (`at`); step 7 without a result leads to the first unfinished step, as before
    if (r && draftExpired(Date.parse(r.at))) { sessionStorage.removeItem(KEY); return null; }
    return r;
  } catch { return null; }
}
export function clearResult() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
