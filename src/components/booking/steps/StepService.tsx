'use client';
/** Step 2 «Услуга»: the public catalog and recommendations from the marked zones. */
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StateCard } from '@/components/ui/Misc';
import { Loading } from '../ui';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepService({ flow }: { flow: Flow }) {
  const { t, ordered, recommended, catalogQ, catalogService, selectService, go } = flow;
  return (
    <section aria-labelledby="st2" className="bk-step bk-grid">
      <Summary flow={flow} />
      <div className="bk-main">
        <h1 id="st2" tabIndex={-1} className="h2">{t('booking.service.heading')}</h1>
        {catalogQ.status === 'loading' && <Loading label={t('common.state.loading')} />}
        {catalogQ.status === 'error' && (
          <StateCard kind="error" text={t('booking.service.loadError')} action={
            <Button variant="secondary" size="sm" onClick={catalogQ.retry}>{t('common.actions.retry')}</Button>
          } />
        )}
        {catalogQ.status === 'ready' && (ordered.length > 0 ? <ul className="bk-list">{ordered.map((s) => (
          <li key={s.id}>
            <label className="rcard bk-opt">
              <input type="radio" name="service" value={s.id} checked={catalogService?.id === s.id} onChange={() => selectService(s.id)} />
              <span className="dot" aria-hidden="true" />
              <span className="bk-opt__body"><b>{s.title}</b>{s.categoryTitle && <span>{s.categoryTitle}</span>}
                {recommended[0] === s.id ? <Badge tone="accent">{t('booking.service.suggested')}</Badge> : null}</span>
              <span className="bk-opt__meta tn"><b>{s.price}</b>{s.duration && <span>{s.duration}</span>}</span>
            </label>
          </li>))}
        </ul> : <p className="hint" role="status">{t('booking.service.empty')}</p>)}
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(1)}>{t('common.actions.back')}</Button>
          <Button disabled={!catalogService} onClick={() => go(3)}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
