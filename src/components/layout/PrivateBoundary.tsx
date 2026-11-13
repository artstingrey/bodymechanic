'use client';
/**
 * The account's border (RC-9, security review В-3; lib/analytics/private): an account address — /account/record/{id}/{hash}/
 * opens a record without a login — must never share a DOCUMENT with a public page. History entries made by one document
 * stay «same-document» for the browser even after a reload: record link → logo (client-side) → F5 → «Назад» was a
 * popstate inside the reloaded public document, i.e. the record address under a live tag manager, which reports history
 * changes as page views.
 * So every in-site link that crosses the border — in EITHER direction, whoever rendered it (logo, header, menu, footer,
 * «Записаться снова», a link added tomorrow) — is a full page load. A click is caught on the document before the router
 * sees it (capture phase; <Link> does nothing once the default is prevented). Same-side links stay client-side.
 * Inside an open overlay (burger, sheet — lib/ui/useBackCloses keeps its own history entry on top) the new page REPLACES
 * that entry, as the overlay's client-side links do: one «Назад» there returns to the page under the overlay.
 * Clicks with a modifier key, another mouse button, target=_blank or download stay the browser's own.
 * There is no programmatic navigation across the border: the only router calls are the booking steps (public ↔ public).
 */
import { useEffect } from 'react';
import { isPrivatePath } from '@/lib/analytics/private';

export function PrivateBoundary() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || isPrivatePath(url.pathname) === isPrivatePath(window.location.pathname)) return;
      e.preventDefault();
      const overlay = Number((window.history.state as { bmOverlay?: number } | null)?.bmOverlay) > 0;
      if (overlay) window.location.replace(url.href); else window.location.assign(url.href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
