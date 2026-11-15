'use client';
/** Steps 2–6 selections (service, specialist, slot, contacts), persisted next to the 3D draft in sessionStorage (ТЗ 6.8). */
import { useCallback, useState } from 'react';
import type { Contact } from '@/lib/api/types';
import { draftExpired } from '@/lib/booking/draft-ttl';
import { isLegacyStaffId, restoreServiceId } from './service-catalog';

export interface Selection {
  serviceId: number | null;
  staffId: number; // 0 = any (ТЗ §08)
  date: string | null;
  /** preferred day carried in by a link (specialist's «nearest windows» → ?date=): opens the calendar there once the
   *  service is chosen and the day is free; a day the visitor picks always wins */
  wantDate?: string | null;
  /** preferred time of that day (HH:MM) — a slot link of the specialist page (R-FINAL-2): preselected on step 4 when the
   *  chosen service has it, else the step says so (booking.time.slotUnfit) */
  wantTime?: string | null;
  datetime: string | null;
  contact: Contact & { consent: boolean; health: boolean };
}
const KEY = 'bm.bookingSteps';
const VERSION = 2;
const EMPTY: Selection = { serviceId: null, staffId: 0, date: null, datetime: null, contact: { fullname: '', phone: '', email: '', consent: false, health: false } }; // phone: PhoneField puts «+971 » on focus
/** every write stamps the time of the change: the name and the phone are dropped a day after it (lib/booking/draft-ttl, Ж-5) */
const persist = (next: Selection) => { try { sessionStorage.setItem(KEY, JSON.stringify({ ...next, version: VERSION, savedAt: Date.now() })); } catch { /* ignore */ } };

/**
 * Starts EMPTY — the same as the prerendered step 1 (R-FINAL perf, option A) — and `load(preset)` reads the stored
 * choices after hydration (useBookingFlow, layout effect: before the first paint).
 * @param preset choices carried in by a link (service page → ?service=ID, specialist page → ?staff=ID [&date=YYYY-MM-DD], ТЗ §07);
 *               they override the stored draft and are persisted at once, so F5 on a later step keeps them.
 */
export function useBookingSelection() {
  const [sel, setSel] = useState<Selection>(EMPTY);
  const load = useCallback((preset: Partial<Omit<Selection, 'contact'>> = {}) => {
    let stored: Selection = EMPTY;
    try {
      const raw = sessionStorage.getItem(KEY);
      const { savedAt, version, ...kept } = (raw ? JSON.parse(raw) : {}) as Partial<Selection> & { savedAt?: number; version?: number };
      if (draftExpired(savedAt)) sessionStorage.removeItem(KEY); // Ж-5: older than a day → gone
      else if (raw) {
        stored = { ...EMPTY, ...kept, contact: { ...EMPTY.contact, ...kept.contact } };
        if (version !== VERSION) stored = {
          ...stored,
          serviceId: restoreServiceId(stored.serviceId),
          staffId: isLegacyStaffId(stored.staffId) ? 0 : stored.staffId,
          date: null, datetime: null, wantDate: null, wantTime: null,
        };
      }
    } catch { /* ignore */ }
    let next = stored;
    if (Object.keys(preset).length) {
      const changedService = preset.serviceId !== undefined && preset.serviceId !== stored.serviceId;
      const changedStaff = preset.staffId !== undefined && preset.staffId !== stored.staffId;
      next = {
        ...stored,
        ...(changedService ? { staffId: 0 } : {}),
        ...(changedService || changedStaff ? { date: null, datetime: null, wantDate: null, wantTime: null } : {}),
        ...preset,
      };
      persist(next);
    }
    setSel(next);
    return next;
  }, []);
  const update = useCallback((patch: Partial<Selection>) => {
    setSel((s) => { const next = { ...s, ...patch }; persist(next); return next; });
  }, []);
  /** one contact field, merged into the LATEST state: handlers built from a stale render must not undo each other's
   *  changes (two quick events — autofill, a tap right after typing — restored the default phone; iPhone gate) */
  const updateContact = useCallback((patch: Partial<Selection['contact']>) => {
    setSel((s) => { const next = { ...s, contact: { ...s.contact, ...patch } }; persist(next); return next; });
  }, []);
  const clear = useCallback(() => { try { sessionStorage.removeItem(KEY); sessionStorage.removeItem('bm.bookingDraft'); } catch { /* ignore */ } setSel(EMPTY); }, []);
  return { sel, update, updateContact, clear, load };
}
