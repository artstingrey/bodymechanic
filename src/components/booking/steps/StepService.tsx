'use client';
/** Step 2 «Услуга»: the public catalog and recommendations from the marked zones. */
import { BookingServiceOptions } from '../BookingServiceOptions';
import { Button } from '@/components/ui/Button';
import { StateCard } from '@/components/ui/Misc';
import { Loading } from '../ui';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepService({ flow }: { flow: Flow }) {
  const { t, ordered, recommended, catalogQ, selectedIds, serviceSelected, serviceRemoved, reviewNotice, selectService, advanceFromService, go } = flow;
  return (
    <section aria-labelledby="st2" className="bk-step bk-grid">
      <Summary flow={flow} />
      <div className="bk-main">
        <h1 id="st2" tabIndex={-1} className="h2">{t('booking.service.heading')}</h1>
        {(serviceRemoved || reviewNotice === 'serviceUnavailable') && <p role="alert" className="hint">{t('booking.service.removed')}</p>}
        {catalogQ.status === 'loading' && <Loading label={t('common.state.loading')} />}
        {catalogQ.status === 'error' && (
          <StateCard kind="error" text={t('booking.service.loadError')} action={
            <Button variant="secondary" size="sm" onClick={catalogQ.retry}>{t('common.actions.retry')}</Button>
          } />
        )}
        {catalogQ.status === 'ready' && (ordered.length > 0 ? (
          <BookingServiceOptions name="service" services={ordered} selected={selectedIds}
            recommended={recommended} suggestedLabel={t('booking.service.suggested')} onSelect={selectService} />
        ) : <p className="hint" role="status">{t('booking.service.empty')}</p>)}
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(1)}>{t('common.actions.back')}</Button>
          <Button disabled={!serviceSelected} onClick={advanceFromService}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
