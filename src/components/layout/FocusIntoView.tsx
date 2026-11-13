'use client';
/**
 * Phones (README-CONTEXT «МОБИЛЬНЫЙ»: iOS Safari first): the on-screen keyboard must not cover the field being typed in.
 * On a coarse pointer, a focused text field that sits in the lower 40 % of the visible viewport (or under the sticky
 * header) is scrolled to the middle — right away, again after the keyboard animation, and when the visual viewport
 * shrinks (keyboard opened / suggestion bar changed). Checkboxes and radios are left alone (no keyboard).
 */
import { useEffect } from 'react';

const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select';
const HEADER = 72; // sticky header height on phones (+ a little air)

function fit(el: Element) {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0, h = vv?.height ?? window.innerHeight;
  const r = el.getBoundingClientRect();
  if (r.bottom > top + h * 0.6 || r.top < top + HEADER) el.scrollIntoView({ block: 'center', inline: 'nearest' });
}

export function FocusIntoView() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    let timer = 0;
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches(TYPING)) return;
      requestAnimationFrame(() => fit(el));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (document.activeElement === el) fit(el); }, 350); // after the keyboard slid in
    };
    const onViewport = () => { const a = document.activeElement; if (a && a.matches(TYPING)) fit(a); };
    document.addEventListener('focusin', onFocus);
    window.visualViewport?.addEventListener('resize', onViewport);
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
