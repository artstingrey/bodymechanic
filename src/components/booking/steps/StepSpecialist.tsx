'use client';
/** Step 3 «Специалист»: «Любой» + the specialists of the service with the nearest slot; loading / error / retry. */
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Silhouette } from '@/components/ui/Cards';
import { ErrorBox, Loading } from '../ui';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepSpecialist({ flow }: { flow: Flow }) {
  const { t, sel, update, go, staffQ, day, time } = flow;
  return (
    <section aria-labelledby="st3" className="bk-step bk-grid">
      <Summary flow={flow} />
      <div className="bk-main">
        <h1 id="st3" tabIndex={-1} className="h2">{t('booking.staff.heading')}</h1>
        <ul className="bk-list">
          <li>
            <label className="rcard bk-opt">
              <input type="radio" name="staff" checked={sel.staffId === 0} onChange={() => update({ staffId: 0, date: null, datetime: null })} />
              <span className="dot" aria-hidden="true" />
              <span className="bk-opt__body"><b>{t('booking.staff.any')}</b><span>{t('booking.staff.anyHint')}</span></span>
            </label>
          </li>
          {staffQ.status === 'loading' ? <li><Loading label={t('common.state.loading')} /></li> : null}
          {staffQ.status === 'error' && staffQ.error ? <li><ErrorBox kind={staffQ.error} onRetry={staffQ.retry} /></li> : null}
          {(staffQ.data ?? []).map((s) => (
            <li key={s.id}>
              <label className="rcard bk-opt">
                <input type="radio" name="staff" checked={sel.staffId === s.id} onChange={() => update({ staffId: s.id, date: null, datetime: null })} />
                <span className="dot" aria-hidden="true" />
                <span className="bk-opt__ava" aria-hidden="true"><Silhouette /></span>
                <span className="bk-opt__body"><b>{s.name}</b>
                  <span>{s.nearestSlot ? t('booking.staff.nearest', { slot: `${day(s.nearestSlot.slice(0, 10))}, ${time(s.nearestSlot)}` }) : t('booking.staff.noSlots')}</span></span>
                <span className="bk-opt__meta"><Badge>{s.position}</Badge></span>
              </label>
            </li>))}
        </ul>
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(2)}>{t('common.actions.back')}</Button>
          <Button onClick={() => go(4)}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
