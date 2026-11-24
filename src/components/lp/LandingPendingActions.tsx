'use client';

import { useTranslations } from 'next-intl';
import { PrefilledLink } from '@/components/ui/PrefilledLink';
import { bookingDateFormat } from '@/lib/booking/receipt';
import type { PendingBooking } from '@/lib/booking/result';
import { WHATSAPP_URL, whatsappUrl } from '@/lib/config';
import type { CatalogLocale } from '@/lib/contracts/catalog';

export function LandingPendingActions({ pending, locale, waMessage, busy, onCheck }: {
  pending: PendingBooking; locale: CatalogLocale; waMessage: string; busy: boolean; onCheck: () => void;
}) {
  const t = useTranslations();
  const info = pending.attempt;
  const date = info && t('common.timeWithZone', { time: bookingDateFormat(locale).format(new Date(info.datetime)) });
  return (
    <div className="lp-booking-actions">
      {info && <button type="button" className="btn btn--p" disabled={busy} onClick={onCheck}>{t('booking.done.checkStatus')}</button>}
      <PrefilledLink className="btn btn--wa" href={WHATSAPP_URL} data-track="whatsapp"
        full={() => whatsappUrl([waMessage, info?.title, date].filter(Boolean).join('\n'))}>{t('lp.form.whatsapp')}</PrefilledLink>
    </div>
  );
}
