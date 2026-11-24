'use client';
/** «Ваша запись» (README §13): the choices so far — left column on desktop for steps 2–5, below the content on phones. */
import { zoneLabel } from '@/lib/body3d/zones';
import type { Flow } from '../useBookingFlow';

export function Summary({ flow }: { flow: Flow }) {
  const { t, step, markers, serviceTitle, servicePrice, serviceDuration, staffReady, staffId, staffName, selectedDatetime, when } = flow;
  return (
    <aside className="bk-summary" aria-labelledby="bk-sum">
      <h2 id="bk-sum" className="h3">{t('booking.summary.title')}</h2>
      <dl>
        <div><dt>{t('booking.review.areas')}</dt><dd>{markers.length ? markers.map((m) => zoneLabel(t, m.zoneId)).join('; ') : t('booking.review.noAreas')}</dd></div>
        {serviceTitle ? (
          <div><dt>{t('booking.review.service')}</dt><dd>{serviceTitle}
            <span className="cap">{[servicePrice, serviceDuration].filter(Boolean).join(' · ')}</span></dd></div>
        ) : null}
        {step >= 3 && serviceTitle && staffReady && (staffName || staffId === 0)
          ? <div><dt>{t('booking.review.specialist')}</dt><dd>{staffName ?? t('booking.staff.any')}</dd></div> : null}
        {step > 4 && selectedDatetime ? <div><dt>{t('booking.review.datetime')}</dt><dd>{when(selectedDatetime)}</dd></div> : null}
      </dl>
    </aside>
  );
}
