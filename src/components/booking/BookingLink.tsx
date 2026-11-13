'use client';
/**
 * A link into the booking that brings a choice with it (the service, the specialist, the day and the time of a free
 * window). RC-10, security review Ж-9: the address carries none of it — neither the href in the markup nor the address
 * after the navigation; ad tags read both. The choice is handed over at the click (lib/booking/preset), the same idea as
 * PrefilledLink. The price, a named one: a new tab or window (a modifier key, the middle button, the context menu) and a
 * copied link open the booking without the choice.
 */
import type { ComponentProps, MouseEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { handPreset, type BookingPreset } from '@/lib/booking/preset';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & {
  preset: BookingPreset;
  /** the step to open (the windows of a specialist open the service step); the step number is not a choice */
  step?: number;
};

export function BookingLink({ preset, step, onClick, ...rest }: Props) {
  const hand = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // Only the click that navigates in THIS tab. `defaultPrevented` is deliberately NOT a reason to skip: on the way out of
    // the account PrivateBoundary (capture phase) has already prevented the default and started a full page load — the
    // hand-over must be written all the same, it waits in the tab's storage.
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) handPreset(preset);
  };
  return <Link {...rest} href={step ? { pathname: '/booking', query: { step: String(step) } } : '/booking'} onClick={hand} />;
}
