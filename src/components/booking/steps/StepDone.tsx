'use client';
/**
 * Step 7 «Готово» (ТЗ §07, R-APP-01 F-01): rendered only from the persisted result (survives F5; without it the flow
 * redirects). created → reference, date and time (Dubai), specialist, address (TODO content) and working actions:
 * .ics file, Google Calendar, printable summary («PDF заявки» → print / save as PDF), WhatsApp, «Мои записи».
 * RC-9 (security review В-4): the WhatsApp and Google Calendar links carry the service, the record number and the zones in
 * their address — it is built at the click only (PrefilledLink), the `href` in the page is the bare service.
 */
import { PrivateLink } from '@/components/layout/PrivateLink';
import { zoneLabel } from '@/lib/body3d/zones';
import { downloadIcs, GOOGLE_CALENDAR_BASE, googleCalendarUrl, type CalEvent } from '@/lib/booking/calendar';
import { WHATSAPP_BASE, whatsappUrl } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { PrefilledLink } from '@/components/ui/PrefilledLink';
import { Icon } from '@/components/ui/Icon';
import type { Flow } from '../useBookingFlow';
import { Todo } from '@/components/ui/Todo';

export function StepDone({ flow }: { flow: Flow }) {
  const { t, result: r, when, startOver } = flow;
  if (!r) return null; // the flow redirects to the first unfinished step
  const summary = `${t('common.brand')}: ${r.serviceTitle}, ${when(r.datetime)} · ${t('booking.done.reference')} ${r.recordId}`;
  const event: CalEvent = {
    title: `${t('common.brand')} · ${r.serviceTitle}`,
    start: r.datetime,
    durationMin: r.durationMin ?? 60,
    details: [`${t('booking.done.reference')}: ${r.recordId}`, r.zones.length ? `${t('booking.review.areas')}: ${r.zones.map((z) => zoneLabel(t, z)).join('; ')}` : ''].filter(Boolean).join('\n'),
    location: '', // TODO(content): studio address (booking.done.addressTodo)
  };
  return (
    <section aria-labelledby="st7" data-result="created" className="booking-done bk-step bk-narrow bk-done">
      <span className="bk-done__ic" data-ok aria-hidden="true"><Icon name="check" /></span>
      <h1 id="st7" tabIndex={-1} className="h2">{t('booking.done.title')}</h1>
      <p className="lead">{t('booking.done.lead')}</p>
      <dl className="bk-review">
        <div><dt>{t('booking.done.reference')}</dt><dd className="tn">{r.recordId}</dd></div>
        <div><dt>{t('booking.done.date')}</dt><dd>{when(r.datetime)}</dd></div>
        <div><dt>{t('booking.review.service')}</dt><dd>{r.serviceTitle}</dd></div>
        <div><dt>{t('booking.done.specialist')}</dt><dd>{r.staffName ?? t('booking.staff.any')}</dd></div>
        <div><dt>{t('booking.done.address')}</dt><Todo as="dd">{t('booking.done.addressTodo')}</Todo></div>
      </dl>
      <div className="booking-done__actions">
        <p className="lbl-u">{t('booking.done.calendar')}</p>
        <div className="chips">
          <button type="button" className="chip" onClick={() => downloadIcs(event, `bm-${r.recordId}-${r.datetime}@bodymechanic`)}><Icon name="calendar" />{t('booking.done.calendarIcs')}</button>
          <PrefilledLink className="chip" href={GOOGLE_CALENDAR_BASE} full={() => googleCalendarUrl(event)}><Icon name="calendar" />{t('booking.done.calendarGoogle')}</PrefilledLink>
          <button type="button" className="chip" onClick={() => window.print()}>{t('booking.done.pdf')}</button>
          <PrefilledLink className="chip" href={WHATSAPP_BASE} full={() => whatsappUrl(summary)}>{t('booking.done.whatsapp')}</PrefilledLink>
        </div>
        {/* RC-9 (S-2): a full page load — the account runs without the tag manager (PrivateLink) */}
        <PrivateLink className="btn btn--text" href="/account">{t('booking.done.myBookings')}<Icon name="arrow-right" /></PrivateLink>
      </div>
      <div className="bk-actions"><Button variant="secondary" onClick={startOver}>{t('booking.draft.startOver')}</Button></div>
    </section>
  );
}
