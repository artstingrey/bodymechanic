'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { withLocalizedStaffName, type StaffNameTranslations } from '@/content/home-team';
import type { BookingResult } from '@/lib/booking/receipt';
import {
  decodeStoredBooking, readStoredBooking, writeStoredBooking, type BookingAttemptDetails, type BookingResultScope,
  type PendingBooking, type StoredBooking,
} from '@/lib/booking/result';
import type { BookingRecordInput } from '@/lib/contracts/booking-record';
import { normalizeBookingServices } from '@/lib/contracts/booking-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { checkBooking, sendBooking, type Submission } from './booking-submit';

const noSubscription = () => () => {};
const emptySnapshot = () => null;

export function useBookingAttempt(scope: BookingResultScope, locale: CatalogLocale) {
  const snapshot = useSyncExternalStore(noSubscription, () => readStoredBooking(scope), emptySnapshot);
  const restored = useMemo(() => decodeStoredBooking(snapshot), [snapshot]);
  const [change, setChange] = useState<{ scope: BookingResultScope; stored: StoredBooking | null }>();
  const [busy, setBusy] = useState(false);
  const requestActive = useRef(false);
  const saved = change?.scope === scope ? change.stored : restored;
  const staffNames = useTranslations('home.team').raw('cards') as StaffNameTranslations;
  const stored = useMemo(() => saved?.status === 'created' ? {
    ...saved,
    staff: saved.staff && withLocalizedStaffName(saved.staff, staffNames),
    parts: saved.parts?.map((part) => part.staff ? { ...part, staff: withLocalizedStaffName(part.staff, staffNames) } : part),
  } : saved, [saved, staffNames]);

  useEffect(() => {
    if (snapshot && !restored && readStoredBooking(scope) === snapshot) writeStoredBooking(scope, null);
  }, [scope, snapshot, restored]);

  function save(value: StoredBooking | null) {
    writeStoredBooking(scope, value);
    setChange({ scope, stored: value });
  }

  function finish(outcome: Submission, pending: PendingBooking & { attempt: BookingAttemptDetails }) {
    requestActive.current = false;
    setBusy(false);
    if (outcome.status === 'created' && outcome.data.services) {
      const { recordId, datetime, services, staff, parts, durationSeconds } = outcome.data;
      const data: BookingResult = { status: 'created', recordId, datetime, services, staff, parts, durationSeconds,
        at: pending.at, price: pending.attempt.price };
      save(data);
      return { status: 'created' as const, data, attempt: pending.attempt };
    }
    if (outcome.status === 'rejected') {
      save(null);
      return outcome;
    }
    const status = outcome.status === 'processing' ? 'processing' : 'unknown';
    save({ ...pending, status });
    return { status } as const;
  }

  async function book(input: BookingRecordInput, display: Pick<BookingAttemptDetails, 'title' | 'price'>, captchaToken: string) {
    if (!captchaToken || requestActive.current || stored || decodeStoredBooking(readStoredBooking(scope))) return;
    const serviceIds = normalizeBookingServices(input.serviceId, input.serviceIds);
    if (!serviceIds) return;
    const recoveryKey = globalThis.crypto.randomUUID();
    requestActive.current = true;
    const { staffId, datetime, idempotencyKey } = input;
    const attempt = { serviceIds, staffId, datetime, idempotencyKey, recoveryKey, ...display };
    const pending = { status: 'unknown' as const, at: new Date().toISOString(), attempt };
    save(pending);
    setBusy(true);
    return finish(await sendBooking({ ...input, recoveryKey, captchaToken }), pending);
  }

  async function check() {
    if (requestActive.current || !stored || stored.status === 'created' || !stored.attempt) return;
    requestActive.current = true;
    setBusy(true);
    return finish(await checkBooking(stored.attempt, locale), { ...stored, attempt: stored.attempt });
  }

  return { stored, busy, book, check, clear: () => save(null) };
}

export type BookingAttempt = ReturnType<typeof useBookingAttempt>;
export type BookingAttemptOutcome = Awaited<ReturnType<BookingAttempt['book']>>;
