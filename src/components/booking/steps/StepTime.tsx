'use client';
/**
 * Step 4 «Дата и время» (ТЗ §07, R-APP-01 F-07): a 30-day calendar — unavailable days stay in place with aria-disabled;
 * slots grouped by part of the day; loading / error («Повторить») / «нет дат» states; after slot_taken the alert gets the
 * focus and the taken slot is no longer offered. Visual: ui/Calendar + SlotPicker (art director).
 */
import { calendarDays } from '@/lib/api';
import { whatsappUrl } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { Calendar, SlotPicker, TimeSkeleton } from '@/components/ui/Calendar';
import { Icon } from '@/components/ui/Icon';
import { StateCard } from '@/components/ui/Misc';
import { ErrorBox, Loading } from '../ui';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepTime({ flow }: { flow: Flow }) {
  const { t, sel, update, go, datesQ, timesQ, day, time, error, setError } = flow;
  const available = new Set(datesQ.data ?? []);
  const noDates = datesQ.status === 'ready' && available.size === 0;
  const slots = timesQ.data ?? [];
  return (
    <section aria-labelledby="st4" className="bk-step bk-grid">
      <Summary flow={flow} />
      <div className="bk-main">
        <div className="bk-head bk-head--row">
          <h1 id="st4" tabIndex={-1} className="h2">{t('booking.time.heading')}</h1>
          <span className="zone-note"><Icon name="clock" />{t('booking.time.zoneNote')}</span>
        </div>
        {error === 'slotTaken' ? <ErrorBox kind="slotTaken" id="booking-error" /> : null}
        {/* a specialist's slot that the chosen service does not fit (R-FINAL-2, Frontend Builder) */}
        {flow.slotUnfit ? <p className="hint" role="status" data-testid="slot-unfit">{t('booking.time.slotUnfit')}</p> : null}
        {/* before a service is chosen (deep link ?step=4, DEL-12 keeps the URL) the step keeps its shape: a dimmed calendar
            skeleton under a card that leads back to step 2; while the dates load — the same skeleton + role=status */}
        {datesQ.status === 'idle' ? (
          <div className="bk-time-wait">
            <TimeSkeleton />
            <StateCard icon="calendar" text={t('booking.service.heading')} action={<Button size="sm" onClick={() => go(2)}>{t('common.actions.select')}</Button>} />
          </div>
        ) : null}
        {datesQ.status === 'loading' ? <div className="bk-time-wait" data-loading=""><Loading label={t('common.state.loading')} /><TimeSkeleton /></div> : null}
        {datesQ.status === 'error' && datesQ.error ? <ErrorBox kind={datesQ.error} onRetry={datesQ.retry} /> : null}
        {noDates ? (
          <div className="booking-empty state">
            <span className="ic" aria-hidden="true"><Icon name="calendar" /></span>
            <p>{t('booking.time.noDates')}</p>
            <a className="btn btn--secondary btn--sm" href={whatsappUrl('')} target="_blank" rel="noopener noreferrer">{t('common.actions.writeWhatsapp')}</a>
          </div>
        ) : null}
        {datesQ.status === 'ready' && !noDates ? (
          <div className="bk-time">
            <Calendar className="dates" days={calendarDays()} available={available} selected={sel.date}
              onSelect={(d) => { setError(null); update({ date: d, datetime: null }); }}
              unavailableLabel={t('booking.time.dateUnavailable')} label={t('booking.time.calendarLabel')} />
            <div className="bk-slots">
              {!sel.date ? <StateCard icon="calendar" text={t('booking.time.heading')} />
                : timesQ.status === 'loading' ? <Loading label={t('booking.time.searching')} />
                : timesQ.status === 'error' && timesQ.error ? <ErrorBox kind={timesQ.error} onRetry={timesQ.retry} />
                : slots.length ? (
                  <div className="times">
                    <SlotPicker slots={slots} selected={sel.datetime} onSelect={(iso) => { setError(null); update({ datetime: iso }); }}
                      labels={{ morning: t('booking.time.partMorning'), day: t('booking.time.partDay'), evening: t('booking.time.partEvening') }} />
                  </div>
                ) : <StateCard icon="calendar" text={t('booking.time.noTimes')} />}
              {sel.datetime ? <p className="bk-picked" role="status"><b>{t('booking.time.selected', { date: day(sel.datetime.slice(0, 10)), time: t('common.timeWithZone', { time: time(sel.datetime) }) })}</b></p> : null}
            </div>
          </div>
        ) : null}
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(3)}>{t('common.actions.back')}</Button>
          <Button disabled={!sel.datetime} onClick={() => go(5)}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
