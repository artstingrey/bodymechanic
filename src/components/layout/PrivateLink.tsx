'use client';
/**
 * A link INTO the account («Мои записи») — a full page load on purpose (RC-9, security review S-2, lib/analytics/private):
 * the account pages run without the tag manager, and a container cannot be unloaded, so a document that already has it
 * must never show an account address. A client-side <Link> would keep the document — and the container — alive.
 * The rule itself is enforced for EVERY link, in both directions, by ./PrivateBoundary; this component is its explicit
 * form for the links known to lead in (no client-side prefetch of the account for them either).
 * `replace`: for a link inside an overlay that holds its own history entry (the burger, lib/ui/useBackCloses) — the new
 * page replaces that entry, as <Link replace> did, so «Назад» there returns straight to the page under the overlay.
 * Clicks with a modifier key or another mouse button stay the browser's (new tab, new window).
 */
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useLocale } from 'next-intl';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { /** path without the locale, e.g. «/account» */ href: `/${string}`; replace?: boolean };

export function PrivateLink({ href, replace = false, onClick, children, ...rest }: Props) {
  const locale = useLocale();
  const url = `/${locale}${href.replace(/\/+$/, '')}/`; // trailingSlash export
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !replace || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.location.replace(url);
  };
  return <a href={url} onClick={click} {...rest}>{children}</a>;
}
