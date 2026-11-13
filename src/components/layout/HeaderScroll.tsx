'use client';
import { useEffect, useRef } from 'react';

/** Sets data-scrolled on the header after 24 px of scroll (80 → 64). Passive listener, one rAF per frame, no React state. */
export function HeaderScroll() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const header = ref.current?.closest('.site-header');
    if (!header) return;
    let raf = 0;
    const apply = () => { raf = 0; header.toggleAttribute('data-scrolled', window.scrollY > 24); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return <span ref={ref} hidden />;
}
