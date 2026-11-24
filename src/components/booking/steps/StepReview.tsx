'use client';
/** Step 6 «Проверка»: review the selection and submit it once. */
import { zoneLabel } from '@/lib/body3d/zones';
import { WHATSAPP_URL, whatsappUrl } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { PrefilledLink } from '@/components/ui/PrefilledLink';
import { Icon } from '@/components/ui/Icon';
import { Todo } from '@/components/ui/Todo';
import { Loading } from '../ui';
import type { Flow } from '../useBookingFlow';

export function StepReview({ flow }: { flow: Flow }) {
  const { t, sel, go, markers, serviceTitle, servicePrice, serviceDuration, staffId, staffName, when, busy, confirm, canConfirm,
    reviewNotice, stored, selectedDatetime, checkStatus } = flow;
  const pending = stored && stored.status !== 'created' ? stored.attempt : undefined;
  const datetime = pending?.datetime ?? selectedDatetime ?? sel.datetime;
  const title = pending?.title ?? serviceTitle;
  const uncertain = stored && stored.status !== 'created' && !busy ? stored.status : null;
  const notice = uncertain ?? reviewNotice;
  const rows: [string, string, number][] = [
    [t('booking.review.areas'), markers.length ? markers.map((m) => zoneLabel(t, m.zoneId)).join('; ') : t('booking.review.noAreas'), 1],
    [t('booking.review.service'), title || '—', 2],
    [t('booking.review.specialist'), staffId ? staffName ?? '—' : t('booking.staff.any'), 3],
    [t('booking.review.datetime'), datetime ? when(datetime) : '—', 4],
    [t('booking.review.contacts'), [sel.contact.fullname.trim(), /\d{5}/.test(sel.contact.phone) ? sel.contact.phone.trim() : ''].filter(Boolean).join(' · ') || '—', 5],
  ];
  return (
    <section aria-labelledby="st6" className="bk-step bk-narrow">
      <h1 id="st6" tabIndex={-1} className="h2">{t('booking.review.heading')}</h1>
      {canConfirm || stored ? (
        <>
          <dl className="bk-review">
            {rows.map(([label, value, n]) => (
              <div key={label}>
                <dt>{label}</dt><dd>{value}</dd>
                <button type="button" className="btn btn--text btn--sm bk-edit" disabled={!!stored} onClick={() => go(n)}
                  aria-label={`${t('booking.review.edit')}: ${label}`}>{t('booking.review.edit')}</button>
              </div>
            ))}
            <div className="bk-total"><dt>{t('booking.review.total')}</dt><dd className="tn">
              {[pending?.price ?? servicePrice, serviceDuration].filter(Boolean).join(' · ')}
            </dd></div>
          </dl>
          <Todo as="p">{t('booking.review.paymentTodo')}</Todo>
          {notice && <div id="booking-review-notice" className="booking-error" role={uncertain ? 'status' : 'alert'}>
            <p>{t(`home.form.feedback.${notice}`)}</p>
            {uncertain && <p>{t('booking.review.uncertainHint')}</p>}
            {(uncertain || notice === 'sms' || notice === 'prepayment') &&
              <PrefilledLink href={WHATSAPP_URL} full={() => whatsappUrl([t('common.brand'), title, datetime ? when(datetime) : ''].filter(Boolean).join(' · '))}>
                {t('common.actions.writeWhatsapp')}
              </PrefilledLink>}
          </div>}
          <div className="bk-actions">
            <Button variant="secondary" disabled={!!stored} onClick={() => go(5)}>{t('common.actions.back')}</Button>
            {pending && stored && !busy
              ? <Button aria-describedby="booking-review-notice" onClick={checkStatus}>{t('booking.done.checkStatus')}</Button>
              : <Button disabled={busy || !canConfirm} loading={busy} aria-describedby={notice ? 'booking-review-notice' : undefined}
                loadingLabel={t('booking.review.confirming')} onClick={confirm}>{t('booking.review.confirm')}</Button>}
          </div>
        </>
      ) : <Loading label={t('common.state.loading')} />}
      <div className="captcha" data-testid="captcha" role="status" hidden>
        <span className="captcha__box" aria-hidden="true"><Icon name="loader" className="spin" /></span>
        {t('booking.review.captcha')}
      </div>
    </section>
  );
}
