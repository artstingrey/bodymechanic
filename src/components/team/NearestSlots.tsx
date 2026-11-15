'use client';
/** Nearest free slots of a specialist (computed in the browser: the static build must not freeze «today»). */
import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { getDates, getTimes } from '@/lib/api';
import { dubaiToday } from '@/lib/api/dubai';
import type { Slot } from '@/lib/api/types';
import type { StaffTodayResponse, StaffTodaySlot } from '@/lib/contracts/staff-today';
import { BookingLink } from '@/components/booking/BookingLink';
import { Button } from '@/components/ui/Button';

type StaffSlotsState = { status: 'loading' } | { status: 'ready'; times: StaffTodaySlot[] }
  | { status: 'error'; rateLimited: boolean; waiting: boolean };

function retryDelay(header: string | null) {
  if (header === null) return 60_000;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.min(ms, 3_600_000)) : 60_000;
}

export function StaffTodaySlots({ staffId }: { staffId: number }) {
  const locale = useLocale();
  const t = useTranslations();
  const f = useFormatter();
  const [state, setState] = useState<StaffSlotsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let unlock: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const query = new URLSearchParams({ staffId: String(staffId), locale });
        const response = await fetch(`/api/booking/staff-today?${query}`, { signal: controller.signal, cache: 'no-store' });
        if (controller.signal.aborted) return;
        if (response.status === 429) {
          const wait = retryDelay(response.headers.get('Retry-After'));
          setState({ status: 'error', rateLimited: true, waiting: wait > 0 });
          if (wait > 0) unlock = setTimeout(() => setState({ status: 'error', rateLimited: true, waiting: false }), wait);
          return;
        }
        if (!response.ok) throw new Error('Staff availability is unavailable');
        const { data: { times } } = await response.json() as StaffTodayResponse;
        if (!controller.signal.aborted) setState({ status: 'ready', times });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error', rateLimited: false, waiting: false });
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(unlock); };
  }, [attempt, locale, staffId]);

  if (state.status === 'loading') return <p className="booking-loading" role="status">{t('a11y.loading')}</p>;
  if (state.status === 'error') return (
    <div>
      <p role="alert">{state.rateLimited ? t('team.profile.slots.rateLimited') : t('team.profile.slots.error')}</p>
      <Button variant="secondary" size="sm" disabled={state.waiting} onClick={() => {
        setState({ status: 'loading' });
        setAttempt((last) => last + 1);
      }}>{t('common.actions.retry')}</Button>
    </div>
  );
  if (!state.times.length) return <p role="status">{t('team.profile.slots.empty')}</p>;
  return (
    <ul>{state.times.map((slot) => (
      <li key={slot.datetime}>
        <BookingLink preset={{ staff: staffId, staffProfile: true, service: slot.serviceId, date: dubaiToday(new Date(slot.datetime)), time: slot.time }}
          step={2} prefetch={false}>
          <time dateTime={slot.datetime}>
            {f.dateTime(new Date(slot.datetime), { day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}, {t('common.timeWithZone', { time: slot.time })}
          </time>
        </BookingLink>
      </li>
    ))}</ul>
  );
}

export function NearestSlots({ staffId }: { staffId: number }) {
  const t = useTranslations();
  const f = useFormatter();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  useEffect(() => {
    getDates(101, staffId).then(async (d) => setSlots(d[0] ? (await getTimes(101, staffId, d[0])).slice(0, 4) : []));
  }, [staffId]);
  if (!slots) return <p className="booking-loading" role="status">{t('a11y.loading')}</p>; // a loading line, not a TODO placeholder
  if (!slots.length) return <p>{t('booking.staff.noSlots')}</p>;
  return (
    // R-CODE-03 / R-FINAL-2: the windows are links — booking with this specialist, day and time: step 2 (the service; none is
    // preset), then straight to «Дата и время» with that slot picked if the service has it (useBookingFlow, wantTime).
    // Ж-9: the address is /booking/?step=2 only; the specialist, the day and the time are handed over at the click
    <ul>{slots.map((s) => (
      <li key={s.datetime}>
        <BookingLink preset={{ staff: staffId, date: s.datetime.slice(0, 10), time: s.time }} step={2} prefetch={false}>
          {f.dateTime(new Date(s.datetime), { day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}, {t('common.timeWithZone', { time: s.time })}
        </BookingLink>
      </li>
    ))}</ul>
  );
}
