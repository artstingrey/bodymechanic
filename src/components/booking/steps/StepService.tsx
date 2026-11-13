'use client';
/** Step 2 «Услуга»: services from the BFF (prerendered), recommended first by the marked zones (ТЗ 6.6). */
import { useServiceFacts } from '@/components/services/ServiceFacts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepService({ flow }: { flow: Flow }) {
  const { t, ordered, recommended, sel, update, go } = flow;
  const facts = useServiceFacts();
  return (
    <section aria-labelledby="st2" className="bk-step bk-grid">
      <Summary flow={flow} />
      <div className="bk-main">
        <h1 id="st2" tabIndex={-1} className="h2">{t('booking.service.heading')}</h1>
        <ul className="bk-list">{ordered.map((s) => (
          <li key={s.id}>
            <label className="rcard bk-opt">
              <input type="radio" name="service" checked={sel.serviceId === s.id} onChange={() => update({ serviceId: s.id, datetime: null, date: null })} />
              <span className="dot" aria-hidden="true" />
              <span className="bk-opt__body"><b>{s.title}</b><span>{s.categoryTitle}</span>
                {recommended[0] === s.id ? <Badge tone="accent">{t('booking.service.suggested')}</Badge> : null}</span>
              <span className="bk-opt__meta tn"><b>{facts.price(s)}</b>{facts.duration(s) ? <span>{facts.duration(s)}</span> : null}<Badge>{facts.demo}</Badge></span>
            </label>
          </li>))}
        </ul>
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(1)}>{t('common.actions.back')}</Button>
          <Button disabled={!sel.serviceId} onClick={() => go(3)}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
