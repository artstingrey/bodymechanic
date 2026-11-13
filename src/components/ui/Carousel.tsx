'use client';
/**
 * Carousel (ui-kit «Карусель», README п.14): native CSS scroll-snap — swipe is the browser's own; arrows scroll the track
 * (never the page); a progress bar shows where the strip is; position «Слайд N из M» is announced politely (RC-8: `hideCount` keeps it for
 * screen readers only — the services strip).
 * Shows ≈1.3 / 2.15 / 3.2 cards (phone / tablet / desktop) so the next card peeks out.
 */
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';

export function Carousel({ label, children, t, hideCount }: {
  label: string;
  children: ReactNode;
  /** deck strings (raw templates, serialisable from server components): a11y.carousel.prev / next / goTo «{n}» / position «{current} {total}» */
  t: { label: string; prev: string; next: string; goTo: string; position: string };
  hideCount?: boolean;
}) {
  const position = (c: number, total: number) => t.position.replace('{current}', String(c)).replace('{total}', String(total));
  const track = useRef<HTMLUListElement>(null);
  const thumb = useRef<HTMLElement>(null);
  const items = Children.toArray(children);
  const [cur, setCur] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: items.length <= 1 });

  const measure = useCallback(() => {
    const el = track.current; if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    let best = 0, d = Infinity;
    kids.forEach((k, i) => { const dd = Math.abs(k.offsetLeft - el.offsetLeft - el.scrollLeft); if (dd < d) { d = dd; best = i; } });
    setCur(best);
    setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    const bar = thumb.current;
    if (bar) { // set here, not through state: the thumb follows the finger without re-rendering the strip
      const max = el.scrollWidth - el.clientWidth;
      const w = Math.max(0.12, el.clientWidth / el.scrollWidth);
      bar.style.width = `${w * 100}%`;
      bar.style.transform = `translateX(${(1 / w - 1) * (max > 0 ? el.scrollLeft / max : 0) * 100}%)`;
    }
  }, []);

  useEffect(() => {
    const el = track.current; if (!el) return;
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    on();
    return () => { el.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [measure]);

  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;
  const step = (dir: 1 | -1) => {
    const el = track.current; const k = el?.children[0] as HTMLElement | undefined;
    if (el && k) el.scrollBy({ left: dir * (k.offsetWidth + 16), behavior: smooth() });
  };

  return (
    <div className="car" role="region" aria-roledescription={t.label} aria-label={label} data-nocount={hideCount || undefined}>
      <ul className="track" ref={track}>
        {items.map((c, i) => <li key={i} aria-label={position(i + 1, items.length)}>{c}</li>)}
      </ul>
      {items.length > 1 ? (
        <div className="ctl">
          <div className="prog" aria-hidden="true"><i ref={thumb} /></div>
          <span className="cap tn" data-pos aria-live="polite">{position(cur + 1, items.length)}</span>
          <div className="arr">
            <IconButton ghost icon="chevron-left" label={t.prev} aria-disabled={edges.start || undefined} onClick={() => !edges.start && step(-1)} />
            <IconButton ghost icon="chevron-right" label={t.next} aria-disabled={edges.end || undefined} onClick={() => !edges.end && step(1)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
