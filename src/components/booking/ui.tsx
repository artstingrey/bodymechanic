'use client';
/** Shared states of the booking and the account: error with «Повторить» (R-APP-01 F-07), loading. Structure only. */
import { useTranslations } from 'next-intl';
import { WHATSAPP_BASE } from '@/lib/config';
import type { BookingError } from './useBookingFlow';

const MESSAGE: Record<BookingError, string> = {
  network: 'booking.error.network', server: 'booking.error.server', captcha: 'booking.error.captcha',
  rateLimit: 'booking.error.rateLimit', tooLate: 'booking.error.tooLate', slotTaken: 'booking.error.slotTaken',
};

/** role=alert; tabIndex −1 so the flow can move focus onto it (F-04: after slot_taken the focus lands here). */
export function ErrorBox({ kind, onRetry, id, whatsappHref = WHATSAPP_BASE }: { kind: BookingError; onRetry?: () => void; id?: string; whatsappHref?: string }) {
  const t = useTranslations();
  const wa = kind === 'server' || kind === 'tooLate';
  return (
    <div className="booking-error" role="alert" id={id} tabIndex={-1} data-error={kind}>
      <p>{t(MESSAGE[kind])}</p>
      {onRetry && kind !== 'slotTaken' && kind !== 'tooLate' ? <button type="button" onClick={onRetry}>{t('common.actions.retry')}</button> : null}
      {wa ? <a href={whatsappHref} target="_blank" rel="noopener noreferrer">{t('common.actions.writeWhatsapp')}</a> : null}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return <p role="status" className="booking-loading">{label}</p>;
}
