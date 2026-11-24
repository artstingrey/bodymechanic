'use client';
/**
 * Step 7 «Готово» (ТЗ §07, R-APP-01 F-01): rendered only from the persisted result (survives F5; without it the flow
 * redirects). A confirmed receipt includes the references, Dubai time, specialist when known, and booking actions:
 * .ics file, Google Calendar, printable summary («PDF заявки» → print / save as PDF) and WhatsApp.
 * Calendar and WhatsApp links build their prefilled addresses at click time.
 */
import { PrivateLink } from '@/components/layout/PrivateLink';
import { downloadIcs, GOOGLE_CALENDAR_BASE, googleCalendarUrl, type CalEvent } from '@/lib/booking/calendar';
import { bookingDateFormat, bookingPartTime, receiptDuration, receiptEnd, receiptTitle } from '@/lib/booking/receipt';
import { STUDIO, WHATSAPP_URL, whatsappUrl } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { PrefilledLink } from '@/components/ui/PrefilledLink';
import { Icon } from '@/components/ui/Icon';
import type { Flow } from '../useBookingFlow';

export function StepDone({ flow }: { flow: Flow }) {
  const { t, locale, result: r, when, startOver } = flow;
  if (!r) return null; // the flow redirects to the first unfinished step
  const parts = r.parts;
  const referenceLabel = t(parts ? 'booking.done.references' : 'booking.done.reference');
  const references = parts?.map(({ recordId }) => recordId).join(', ') ?? String(r.recordId);
  const title = receiptTitle(r);
  const end = receiptEnd(r);
  const minutes = receiptDuration(r);
  const duration = minutes === undefined ? undefined : t('home.services.duration', { minutes });
  const price = r.price && t('booking.service.estimate', { price: r.price });
  const format = bookingDateFormat(locale);
  const partDetails = parts?.map((part) => [part.title, t('common.timeWithZone', { time: bookingPartTime(part, format) }), part.staff?.name]
    .filter(Boolean).join(' · ')) ?? [];
  const details = [`${t('booking.review.service')}: ${title}`, when(r.datetime), duration, price,
    r.staff && `${t('booking.done.specialist')}: ${r.staff.name}`, `${referenceLabel}: ${references}`, ...partDetails]
    .filter(Boolean).join('\n');
  const summary = `${t('common.brand')}\n${details}`;
  const event: CalEvent = {
    title: `${t('common.brand')} · ${title}`,
    start: r.datetime,
    end,
    details,
    location: STUDIO.streetAddress,
  };
  return (
    <section aria-labelledby="st7" data-result="created" className="booking-done bk-step bk-narrow bk-done">
      <span className="bk-done__ic" data-ok aria-hidden="true"><Icon name="check" /></span>
      <h1 id="st7" tabIndex={-1} className="h2">{t('booking.done.title')}</h1>
      <p className="lead">{t('booking.done.lead')}</p>
      <dl className="bk-review">
        <div><dt>{referenceLabel}</dt><dd className="tn">{references}</dd></div>
        <div><dt>{t('booking.done.date')}</dt><dd>{when(r.datetime)}</dd></div>
        <div><dt>{t('booking.review.service')}</dt><dd>{title}</dd></div>
        {r.staff && !parts && <div><dt>{t('booking.done.specialist')}</dt><dd>{r.staff.name}</dd></div>}
        {duration && <div><dt>{t('booking.done.duration')}</dt><dd>{duration}</dd></div>}
        {price && <div><dt>{t('booking.review.total')}</dt><dd>{price}</dd></div>}
        {parts?.map((part) => (
          <div key={part.recordId}>
            <dt>{part.title}</dt>
            <dd>{t('common.timeWithZone', { time: bookingPartTime(part, format) })}</dd>
            {part.staff && <dd>{part.staff.name}</dd>}
          </div>
        ))}
        <div><dt>{t('booking.done.address')}</dt><dd>{STUDIO.streetAddress}</dd></div>
      </dl>
      <div className="booking-done__actions">
        <p className="lbl-u">{t('booking.done.calendar')}</p>
        <div className="chips">
          <button type="button" className="chip" onClick={() => downloadIcs(event, `bm-${r.recordId}-${r.datetime}@bodymechanic`)}><Icon name="calendar" />{t('booking.done.calendarIcs')}</button>
          <PrefilledLink className="chip" href={GOOGLE_CALENDAR_BASE} full={() => googleCalendarUrl(event)}><Icon name="calendar" />{t('booking.done.calendarGoogle')}</PrefilledLink>
          <button type="button" className="chip" onClick={() => window.print()}>{t('booking.done.pdf')}</button>
          <PrefilledLink className="chip" href={WHATSAPP_URL} full={() => whatsappUrl(summary)}>{t('booking.done.whatsapp')}</PrefilledLink>
        </div>
        <div hidden>
          <PrivateLink className="btn btn--text" href="/account" aria-describedby="booking-account-note">
            {t('booking.done.myBookings')} <Icon name="arrow-right" />
          </PrivateLink>
          <p className="cap" id="booking-account-note">{t('account.sampleRecords')}</p>
        </div>
      </div>
      <div className="bk-actions"><Button variant="secondary" onClick={startOver}>{t('booking.draft.startOver')}</Button></div>
    </section>
  );
}
