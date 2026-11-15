'use client';
/**
 * Burger menu on all breakpoints (RC-8, the client's approved «floating header» layout: site/review/skill-bakeoff/variant-final.html):
 * full screen on phones, a panel under the burger from 768; four sections large and four smaller, «Мои записи», language and
 * socials, «Записаться» pinned at the bottom. The burger itself turns into the cross and stays above the panel, so the header
 * has to paint over it: a modal <dialog> lives in the top layer, above everything, hence a non-modal one, a sibling of the
 * pill (.site-header__bar moves with a transform on phones — an ancestor with a transform would become the panel's containing block).
 * What a modal dialog gave for free is done here: the rest of the page is inert, Tab cycles burger ↔ panel, Esc closes, focus returns.
 * The panel stays laid out while closed (visibility, see layout.css), so opening and closing are plain interruptible transitions.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { LangSwitch } from './LangSwitch';
import { PrivateLink } from './PrivateLink';
import { isTodo } from '@/components/ui/Todo';
import { useBackCloses } from '@/lib/ui/useBackCloses';

/** put the page back where it was (instant, also one frame later: the browser may scroll after a focus move) */
function keepPlace(top: number) {
  window.scrollTo({ top, behavior: 'instant' });
  requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
}

type Menu = {
  open: boolean; toggle: () => void; close: () => void; follow: (e: MouseEvent<HTMLAnchorElement>) => void;
  btn: RefObject<HTMLButtonElement | null>; dialog: RefObject<HTMLDialogElement | null>; panel: RefObject<HTMLDivElement | null>;
};
const MenuContext = createContext<Menu | null>(null);
const useMenu = () => { const m = useContext(MenuContext); if (!m) throw new Error('BurgerButton / BurgerDialog outside BurgerRoot'); return m; };

/** The state shared by the button (inside the pill) and the panel (next to it). */
export function BurgerRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), panel = useRef<HTMLDivElement>(null);
  // R-CODE-02 F-02: keep the reader's place — scrollY before opening, put back after closing, unless the menu closed for a
  // link (navigation, /#anchor) that owns the scroll from there.
  const scrollY = useRef(0);
  const leaving = useRef(false);

  /** Where the panel starts and which edge it hangs from. */
  const place = useCallback(() => {
    const b = btn.current, d = dialog.current, bar = b?.closest<HTMLElement>('.site-header__bar'), header = b?.closest<HTMLElement>('.site-header');
    if (!b || !d || !bar || !header) return;
    const phone = window.innerWidth < 768;
    bar.style.transform = '';
    const r = bar.getBoundingClientRect();
    const rest = (parseFloat(getComputedStyle(header).top) || 0) + bar.offsetTop;
    const up = phone ? Math.max(0, Math.round(r.top - rest)) : 0;
    bar.style.transform = up ? `translateY(-${up}px)` : '';
    d.style.setProperty('--menu-top', `${Math.round(r.bottom - up + (phone ? 12 : 8))}px`);
    d.style.setProperty('--menu-right', `${Math.max(12, Math.round(d.getBoundingClientRect().right - b.getBoundingClientRect().right))}px`); // from the dialog's own edge: it stops before the scrollbar gutter
  }, []);

  /** the focus goes back to the burger; after a tap or a click without a ring (WebKit rings a scripted focus), after Esc with one */
  const close = useCallback((keyboard = false) => {
    const b = btn.current;
    const bar = b?.closest<HTMLElement>('.site-header__bar');
    if (bar) bar.style.transform = '';
    const a = document.activeElement;
    if (b && !leaving.current && (a === document.body || panel.current?.contains(a))) {
      if (!keyboard) { b.setAttribute('data-noring', ''); b.addEventListener('blur', () => b.removeAttribute('data-noring'), { once: true }); }
      b.focus({ preventScroll: true });
    }
    setOpen(false);
  }, []);

  const show = useCallback(() => {
    scrollY.current = window.scrollY; leaving.current = false;
    place();
    setOpen(true);
  }, [place]);

  const follow = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    // the page itself (no #anchor): just close and go to the top — a same-URL navigation would leave a duplicate entry
    const u = new URL(e.currentTarget.href);
    if (!u.hash && u.pathname + u.search === window.location.pathname + window.location.search) { e.preventDefault(); scrollY.current = 0; close(); return; }
    leaving.current = true;
    dialog.current?.removeAttribute('open'); // now, not at the next render: the page must be scrollable when the link scrolls to its anchor
    close();
  }, [close]);

  // Android «Back» closes the menu (reviewer, device matrix). A menu link REPLACES the menu's history entry (`replace`),
  // so Back on the next page returns straight here.
  useBackCloses(open, () => close(), () => leaving.current);

  // while open: the page and the rest of the header are inert, the panel takes the focus (not its first link: WebKit would ring it)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      if (wasOpen.current && !leaving.current) keepPlace(scrollY.current);
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const header = btn.current?.closest('.site-header');
    const others = [
      ...Array.from(document.body.children).filter((e) => e !== header && !['SCRIPT', 'STYLE', 'TEMPLATE', 'NEXT-ROUTE-ANNOUNCER'].includes(e.tagName)),
      ...Array.from(header?.querySelectorAll('.site-header__row > *:not(.burger)') ?? []),
    ].filter((e) => !e.hasAttribute('inert'));
    others.forEach((e) => e.setAttribute('inert', ''));
    panel.current?.focus({ preventScroll: true });
    keepPlace(scrollY.current); // locking the page must not move it (R-CODE-02 F-02: 1500 → 1153 without this)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key !== 'Tab') return;
      const items = [btn.current, ...Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button') ?? [])].filter(Boolean) as HTMLElement[];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); } else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      others.forEach((e) => e.removeAttribute('inert'));
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open, close, place]);

  // iOS applies :active (the press feedback) only when the page listens to touches
  useEffect(() => {
    const noop = () => {};
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);

  const value = useMemo<Menu>(() => ({ open, toggle: () => (open ? close() : show()), close: () => close(), follow, btn, dialog, panel }), [open, show, close, follow]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

/** Three lines that turn into the cross: the same button opens and closes the menu. */
export function BurgerButton() {
  const t = useTranslations();
  const { open, toggle, btn } = useMenu();
  return (
    <button ref={btn} type="button" className="burger" aria-label={t(open ? 'nav.burger.close' : 'nav.burger.open')} aria-haspopup="dialog" aria-expanded={open} aria-controls="burger-dialog" onClick={toggle}>
      {/* strokes, not span backgrounds: a browser's forced dark mode lightens foreground and left dark bars on a dark pill */}
      <svg viewBox="0 0 18 14" aria-hidden="true" focusable="false"><line x1="1" x2="17" y1="1" y2="1" /><line x1="1" x2="17" y1="7" y2="7" /><line x1="1" x2="17" y1="13" y2="13" /></svg>
    </button>
  );
}

const ITEMS: [string, string][] = [
  ['/services', 'nav.burger.services'], ['/prices', 'nav.main.prices'], ['/team', 'nav.main.team'], ['/#approach', 'nav.main.approach'],
  ['/#reviews', 'nav.main.reviews'], ['/#faq', 'nav.main.faq'], ['/journal', 'nav.burger.journal'], ['/contacts', 'nav.burger.contacts'],
];
/** the first four are the large tier: what, how much, who, how */
const MAJOR = 4;

export function BurgerDialog() {
  const t = useTranslations();
  const { open, close, follow, dialog, panel, btn } = useMenu();
  const btnFocus = () => btn.current?.focus({ preventScroll: true });
  return (
    <dialog ref={dialog} id="burger-dialog" className="burger-dialog" open={open} aria-modal="true" aria-label={t('nav.burger.sections')}>
      <div className="burger-dialog__scrim" onClick={close} />
      <div ref={panel} className="burger-dialog__panel" tabIndex={-1}>
        <div className="burger-dialog__scroll">
          <nav aria-label={t('nav.burger.sections')}>
            <ul className="big">
              {ITEMS.map(([href, key], i) => (
                <li key={key} className={i < MAJOR ? 'is-major' : 'is-minor'} style={{ '--i': i } as CSSProperties}>
                  <Link href={href} replace onClick={follow}>{t(key)}{i < MAJOR ? <span className="arr" aria-hidden="true">→</span> : null}</Link>
                </li>
              ))}
            </ul>
          </nav>
          {/* RC-9 (S-2): a full page load — the account runs without the tag manager (PrivateLink) */}
          <PrivateLink href="/account" className="acct" replace onClick={follow}>
            <span className="av" aria-hidden="true"><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg></span>
            <span><b>{t('nav.burger.account')}</b><small>{t('nav.burger.accountHint')}</small></span>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </PrivateLink>
          <div className="meta">
            <LangSwitch variant="long" />
            {isTodo(t('footer.socialLinks')) ? null : <span className="soc">{t('nav.burger.social')}: {t('footer.socialLinks')}</span>}
          </div>
        </div>
        <div className="burger-dialog__cta"><ButtonLink href="/booking" full replace onClick={follow}>{t('nav.book')}</ButtonLink></div>
        {/* the end of the Tab loop where the browser stops on other things than links (Safari tabs to the scrolling list, not to links) */}
        <span className="burger-dialog__guard" tabIndex={0} onFocus={() => btnFocus()} />
      </div>
    </dialog>
  );
}
