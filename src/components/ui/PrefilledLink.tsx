'use client';
/**
 * A link that opens another service with the visitor's own text prefilled — WhatsApp («The Body Mechanic: <service>, <date> ·
 * Номер записи …») or Google Calendar (title, record number, zones). RC-9, security review В-4: such an address must never
 * sit in the DOM. A tag manager reads every link's `href` (GTM «Click URL», GA4 enhanced measurement sends the address of an
 * outbound click), so the service, the zones and the record number would reach Google and Meta.
 *   - `href` = the bare address of the service (no text): what a tag, a crawler, «open in a new tab» or a browser without
 *     JS gets — the same service without the prefilled text;
 *   - `full()` builds the complete address only inside the click handler, and the page opens it itself — the same new tab
 *     with the same text as the plain link used to open.
 * `window.open` without «noopener» on purpose: with it the call always returns null and a blocked popup could not be told
 * from an opened one. The opener is cut right after; when nothing opened (in-app browsers, a popup blocker) the same tab
 * goes there, so the visitor is never left without the action. Clicks with a modifier key or another button stay the
 * browser's own (the bare address).
 */
import type { AnchorHTMLAttributes, MouseEvent } from 'react';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & {
  /** the service without any data: `WHATSAPP_URL`, `GOOGLE_CALENDAR_BASE` */
  href: string;
  /** the complete address with the visitor's text — called at the click, never rendered */
  full: () => string;
};

function openPrefilledUrl(url: string) {
  const w = window.open(url, '_blank');
  if (w) { try { w.opener = null; } catch { /* cross-origin already */ } } else window.location.assign(url);
}

export function PrefilledLink({ href, full, onClick, children, ...rest }: Props) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openPrefilledUrl(full());
  };
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={click} {...rest}>{children}</a>;
}
