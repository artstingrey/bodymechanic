'use client';
/** Step 3 shows the specialists assigned to the selected service. */
import { Button } from '@/components/ui/Button';
import { Silhouette } from '@/components/ui/Cards';
import { StateCard } from '@/components/ui/Misc';
import { Loading } from '../ui';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepSpecialist({ flow }: { flow: Flow }) {
  const { t, sel, selectStaff, go, staffQ, catalogQ, staffName, profileStaffUnavailable } = flow;
  const staffReady = staffQ.status === 'ready';
  return (
    <section aria-labelledby="st3" className="bk-step bk-grid">
      <Summary flow={flow} />
      <div className="bk-main">
        <h1 id="st3" tabIndex={-1} className="h2">{t('booking.staff.heading')}</h1>
        {profileStaffUnavailable ? <p className="hint" role="alert">{t('home.form.feedback.staffUnavailable')}</p> : null}
        <ul className="bk-list">
          <li>
            <label className="rcard bk-opt">
              <input type="radio" name="staff" value="0" disabled={!staffReady} checked={sel.staffId === 0} onChange={() => selectStaff(0)} />
              <span className="dot" aria-hidden="true" />
              <span className="bk-opt__body"><b>{t('booking.staff.any')}</b><span>{t('booking.staff.anyHint')}</span></span>
            </label>
          </li>
          {(catalogQ.status === 'loading' || staffQ.status === 'loading') && <li><Loading label={t('common.state.loading')} /></li>}
          {catalogQ.status === 'error' && <li><StateCard kind="error" text={t('booking.service.loadError')} action={
            <Button variant="secondary" size="sm" onClick={catalogQ.retry}>{t('common.actions.retry')}</Button>
          } /></li>}
          {staffQ.status === 'error' && <li><StateCard kind="error" text={t('booking.staff.loadError')} action={
            <Button variant="secondary" size="sm" onClick={staffQ.retry}>{t('common.actions.retry')}</Button>
          } /></li>}
          {staffReady && staffQ.data?.length === 0 && <li className="hint" role="status">{t('booking.staff.empty')}</li>}
          {staffReady && staffQ.data?.map(({ id, name }) => (
            <li key={id}>
              <label className="rcard bk-opt">
                <input type="radio" name="staff" value={id} checked={sel.staffId === id} onChange={() => selectStaff(id)} />
                <span className="dot" aria-hidden="true" />
                <span className="bk-opt__ava" aria-hidden="true"><Silhouette /></span>
                <span className="bk-opt__body"><b>{name}</b></span>
              </label>
            </li>))}
        </ul>
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(2)}>{t('common.actions.back')}</Button>
          <Button disabled={!staffReady || (sel.staffId !== 0 && !staffName)} onClick={() => go(4)}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
