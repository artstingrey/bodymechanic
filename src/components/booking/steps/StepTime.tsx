'use client';
/**
 * Step 4 «Дата и время» (ТЗ §07, R-APP-01 F-07): unavailable days stay in place with aria-disabled;
 * slots grouped by part of the day; loading / error («Повторить») / «нет дат» states; after slot_taken the alert gets the
 * focus and the taken slot is no longer offered. Visual: ui/Calendar + SlotPicker (art director).
 */
import { whatsappUrl } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { Calendar, SlotPicker, TimeSkeleton } from '@/components/ui/Calendar';
import { Icon } from '@/components/ui/Icon';
import { StateCard } from '@/components/ui/Misc';
import { bookingCalendarDays } from '../booking-availability';
import { ErrorBox, Loading } from '../ui';
import { Summary } from './Summary';
import type { Flow } from '../useBookingFlow';

export function StepTime({ flow }: { flow: Flow }) {
  const { t, update, go, catalogQ, staffQ, datesQ, timesQ, today, availableDates, selectedDate, selectedDatetime,
    day, time, error, setError } = flow;
  const available = new Set(availableDates);
  const noDates = datesQ.status === 'ready' && available.size === 0;
  const slots = timesQ.data ?? [];
  const loading = [catalogQ.status, staffQ.status, datesQ.status].includes('loading');
  const failed = [catalogQ, staffQ, datesQ].find((query) => query.status === 'error');
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
        {(loading || (datesQ.status === 'idle' && !failed))
          ? <div className="bk-time-wait" data-loading=""><Loading label={t('common.state.loading')} /><TimeSkeleton /></div> : null}
        {failed?.error ? <ErrorBox kind={failed.error} onRetry={failed.retry} /> : null}
        {noDates ? (
          <div className="booking-empty state">
            <span className="ic" aria-hidden="true"><Icon name="calendar" /></span>
            <p>{t('booking.time.noDates')}</p>
            <a className="btn btn--secondary btn--sm" href={whatsappUrl('')} target="_blank" rel="noopener noreferrer">{t('common.actions.writeWhatsapp')}</a>
          </div>
        ) : null}
        {datesQ.status === 'ready' && !noDates ? (
          <div className="bk-time">
            <Calendar className="dates" days={bookingCalendarDays(today, availableDates)} available={available} selected={selectedDate}
              onSelect={(date) => {
                if (date === selectedDate) return;
                setError(null);
                update({ date, datetime: null, wantDate: null, wantTime: null });
              }}
              unavailableLabel={t('booking.time.dateUnavailable')} label={t('booking.time.calendarLabel')} />
            <div className="bk-slots">
              {!selectedDate ? <StateCard icon="calendar" text={t('booking.time.heading')} />
                : timesQ.status === 'loading' ? <Loading label={t('booking.time.searching')} />
                : timesQ.status === 'error' && timesQ.error ? <ErrorBox kind={timesQ.error} onRetry={timesQ.retry} />
                : slots.length ? (
                  <div className="times">
                    <SlotPicker slots={slots} selected={selectedDatetime} onSelect={(datetime) => {
                      setError(null);
                      update({ date: selectedDate, datetime, wantDate: null, wantTime: null });
                    }}
                      labels={{ morning: t('booking.time.partMorning'), day: t('booking.time.partDay'), evening: t('booking.time.partEvening') }} />
                  </div>
                ) : <StateCard icon="calendar" text={t('booking.time.noTimes')} />}
              {selectedDate && selectedDatetime ? <p className="bk-picked" role="status"><b>{t('booking.time.selected', {
                date: day(selectedDate), time: t('common.timeWithZone', { time: time(selectedDatetime) }),
              })}</b></p> : null}
            </div>
          </div>
        ) : null}
        <div className="bk-actions">
          <Button variant="secondary" onClick={() => go(3)}>{t('common.actions.back')}</Button>
          <Button disabled={!selectedDatetime} onClick={() => go(5)}>{t('common.actions.next')}</Button>
        </div>
      </div>
    </section>
  );
}
