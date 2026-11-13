'use client';
/** Nearest free slots of a specialist (computed in the browser: the static build must not freeze «today»). */
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { getDates, getTimes } from '@/lib/api';
import type { Slot } from '@/lib/api/types';
import { BookingLink } from '@/components/booking/BookingLink';

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
