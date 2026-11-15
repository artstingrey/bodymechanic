'use client';
import type { BookingRecordData } from '@/lib/contracts/booking-record';
import { draftExpired } from './draft-ttl';

export type BookingResult = Extract<BookingRecordData, { status: 'created' }> & {
  serviceTitle: string;
  durationMin: number | null;
  zones: string[];
  at: string;
};
export type StoredBooking = BookingResult | { status: 'processing' | 'unknown'; at: string };
const KEY = 'bm.bookingResult';

export function saveResult(booking: StoredBooking) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...booking, version: 2 })); } catch { /* ignore */ }
}
export function loadResult(): StoredBooking | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { version, ...r } = JSON.parse(raw) as StoredBooking & { version?: number };
    const savedAt = Date.parse(r.at);
    // Old snapshots belonged to the demo. Pending attempts contain only a state and timestamp.
    if (version !== 2 || !Number.isFinite(savedAt) || draftExpired(savedAt) ||
      !['created', 'unknown', 'processing'].includes(r.status) ||
      (r.status === 'created' && (!Number.isSafeInteger(r.recordId) || r.recordId <= 0 ||
        typeof r.serviceTitle !== 'string' || !Number.isFinite(Date.parse(r.datetime))))) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return r;
  } catch { return null; }
}
export function clearResult() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
