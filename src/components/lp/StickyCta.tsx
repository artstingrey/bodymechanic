'use client';
/**
 * Sticky CTA for phones (lead R-LP-01 F-02 (3); RC-2, like the site's FAB pill). It never lies over a form control: it
 * hides when the controls of a form (the span from its first to its last field / chip / checkbox / button, so no flicker
 * between them) reach into the bar's own strip at the bottom of the screen, when a form button is wholly on screen, and
 * while a field has the focus (the keyboard is up). Never «empty» either: it hides only because of a control that is
 * (at least partly) on screen — not for the card's edge or title alone (lead). It used to show until the form button was
 * fully visible and covered «Имя» and «Телефон» as the form slid in from below (Brand Designer's LP audit).
 * lp.spec: «sticky CTA never covers…» (30 devices, every 48 px) and the first-screen rule (button, first field or bar).
 * Tap → the hero form (scroll + focus «Имя»), or the bottom sheet in the «?form=sheet» test.
 */
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';

export function StickyCta({ label, sheetLabel, waLabel, waHref }: { label: string; sheetLabel: string; waLabel: string; waHref: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current; if (!el) return;
    let typing = false; // R-LP-03 M-03: a form field has the focus (on phones the keyboard is up) → no bar over the next field
    const FIELD = '.lp-form input:not([type="checkbox"]), .lp-form textarea, .lp-form select';
    const CONTROL = 'input:not([type="hidden"]), textarea, select, button, summary, .chip, .check, [data-lp-cta]';
    const BUTTON = 'button[type="submit"], [data-lp-cta]';
    // per form: its controls; the sheet test's hero button is a group of its own. A form in a closed <dialog> (the sheet) is
    // not on the page.
    let groups: Element[][] = [];
    const collect = () => {
      groups = [...document.querySelectorAll('.lp-form, [data-lp-cta]')]
        .filter((f) => !f.closest('dialog') && (f.matches('.lp-form') || !f.closest('.lp-form')))
        .map((f) => (f.matches('.lp-form') ? [...f.querySelectorAll(CONTROL)] : [f]));
    };
    const hidden = () => {
      if (typing) return true;
      const strip = innerHeight - el.offsetHeight; // the bar's own strip at the bottom of the screen
      for (const g of groups) {
        let top = Infinity, bottom = -Infinity;
        for (const c of g) {
          const r = c.getBoundingClientRect(); if (!r.width && !r.height) continue;
          if (c.matches(BUTTON) && r.top >= 0 && r.bottom <= innerHeight) return true; // a form button wholly on screen
          top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
        }
        if (bottom > strip && top < innerHeight - 3) return true; // the form's controls reach into the bar's strip: ≥ 3 px of them on screen (lp.spec: never hidden with no control on screen)
      }
      return false;
    };
    let raf = 0;
    const update = () => { raf = 0; el.toggleAttribute('data-show', !hidden()); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    const onFocus = (e: FocusEvent) => { typing = e.target instanceof Element && e.target.matches(FIELD); update(); };
    const onBlur = (e: FocusEvent) => { typing = e.relatedTarget instanceof Element && e.relatedTarget.matches(FIELD); update(); }; // field → field: no flicker
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    visualViewport?.addEventListener('resize', schedule);
    const mo = new MutationObserver(() => { collect(); schedule(); }); // a form turns into «спасибо», details open
    mo.observe(document.querySelector('.lp') ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    collect(); update();
    return () => {
      cancelAnimationFrame(raf); mo.disconnect();
      document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onBlur);
      removeEventListener('scroll', schedule); removeEventListener('resize', schedule); visualViewport?.removeEventListener('resize', schedule);
    };
  }, []);

  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    const form = document.getElementById('lp-f1'); if (!form) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    window.setTimeout(() => form.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), smooth ? 450 : 0);
  };

  return (
    <div className="lp-sticky" ref={bar}>
      {/* one action, one name (design audit 2): the bar repeats the hero button of the form mode — «Подобрать время» with the
          form in the hero, «Записаться на первый визит» with ?form=sheet (lp.css switches by html[data-lp-form], set before paint) */}
      <a className="btn btn--p l-form" href="#lp-f1" onClick={go}>{label}<Icon name="arrow-right" /></a>
      <button type="button" className="btn btn--p l-sheet" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event('lp:open-sheet'))}>
        {sheetLabel}<Icon name="arrow-right" />
      </button>
      <a className="btn btn--wa btn--icon" href={waHref} target="_blank" rel="noopener noreferrer" aria-label={waLabel} data-track="whatsapp"><span className="wa"><Icon name="whatsapp" /></span></a>
    </div>
  );
}
