'use client';
/**
 * FAB «Записаться» (ui-kit «FAB», motion-spec «FAB»), phones only (CSS hides it ≥768, the header has its own button there).
 * R-FINAL-2 D-04 (lead, option 1): a copper pill «Записаться →» across the content width at the bottom of the screen — the old
 * vertical tab on the right edge covered the ends of text lines and the right edge of form fields (DEV-04).
 * Hidden while an element marked [data-fab-anchor] (the hero section / the page head) is on screen or still below it — the first
 * screen has its own button. Hides again before the footer (its own «Записаться»), early enough that the last content above the
 * footer never stays under the pill. Hidden while any form of the page is on screen or about to enter it (lead, after FB's flaky
 * «quick form» test: the pill passed over the home form's fields and buttons at 89 of ~150 scroll positions, and a tap on a field
 * at the bottom of the screen opened /booking). CSS also hides it while the cookie card, a dialog (menu, confirmations) or a
 * focused form field (on-screen keyboard) is up. No FAB on /booking and /account (they have their own bars).
 * Visibility is written to the DOM directly (no React state per scroll).
 */
import { useEffect, useRef } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { Icon } from '@/components/ui/Icon';

function setHidden(el: HTMLElement, hidden: boolean) {
  if (hidden) { el.dataset.hidden = 'true'; el.setAttribute('aria-hidden', 'true'); el.tabIndex = -1; }
  else { delete el.dataset.hidden; el.removeAttribute('aria-hidden'); el.removeAttribute('tabindex'); }
}

/** the footer counts as «on screen» this far below the viewport: pill zone (12 + 52 + 12) + mobile --section-y (56) + slack */
const FOOTER_MARGIN = '0px 0px 140px 0px';
/** a form counts as «on screen» once its top is within the pill zone (12 + 52 + 12) + slack below the viewport: the pill is gone
 *  before the first field reaches it */
const FORM_MARGIN = '0px 0px 80px 0px';

export function BookFab({ label, aria }: { label: string; aria: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLAnchorElement>(null);
  const off = pathname.startsWith('/booking') || pathname.startsWith('/account');
  useEffect(() => {
    const fab = ref.current;
    if (!fab) return;
    const anchor = document.querySelector('[data-fab-anchor]');
    const footer = document.querySelector('.site-footer');
    const forms = [...document.querySelectorAll('main form')];
    // hide while the hero CTA is on screen (or still below), while the footer (its own «Записаться») is near, and while a form is
    const state = { anchor: !!anchor, footer: false, forms: new Set<Element>() };
    const apply = () => setHidden(fab, state.anchor || state.footer || state.forms.size > 0);
    const top = new IntersectionObserver(([e]) => { state.anchor = e.isIntersecting || e.boundingClientRect.top > 0; apply(); }, { threshold: 0 });
    const end = new IntersectionObserver(([e]) => { state.footer = e.isIntersecting; apply(); }, { threshold: 0, rootMargin: FOOTER_MARGIN });
    const form = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) state.forms.add(e.target); else state.forms.delete(e.target); }
      apply();
    }, { threshold: 0, rootMargin: FORM_MARGIN });
    if (anchor) top.observe(anchor);
    if (footer) end.observe(footer);
    forms.forEach((f) => form.observe(f));
    apply();
    return () => { top.disconnect(); end.disconnect(); form.disconnect(); };
  }, [pathname]);
  if (off) return null;
  // SSR / first paint: hidden, so it never flashes over the hero before the observer runs
  return (
    // the wrapper clips the slide-out below the screen edge (fixed elements count in mobile overflow) and leaves room for the shadow
    <span className="fab-wrap">
      <Link ref={ref} href="/booking" className="fab" aria-label={aria} data-hidden="true" aria-hidden="true" tabIndex={-1}>
        {label}
        <Icon name="arrow-right" />
      </Link>
    </span>
  );
}
