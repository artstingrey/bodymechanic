'use client';
/**
 * Native scroll snap for touch and trackpads, with mouse dragging on scrollable tracks.
 */
import { Children, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { IconButton } from './Button';

function slideOffsets(track: HTMLUListElement) {
  const padding = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
  const start = track.getBoundingClientRect().left + track.clientLeft + padding;
  const end = track.scrollWidth - track.clientWidth;
  return Array.from(track.children, (slide) => {
    const offset = slide.getBoundingClientRect().left - start + track.scrollLeft;
    return Math.max(0, Math.min(end, offset));
  });
}

function adjacentOffset(offsets: number[], position: number, direction: 1 | -1) {
  return direction === 1
    ? offsets.find((offset) => offset > position + 1)
    : offsets.slice().reverse().find((offset) => offset < position - 1);
}

function nearestOffset(offsets: number[], position: number) {
  return offsets.reduce((nearest, offset) => (
    Math.abs(offset - position) < Math.abs(nearest - position) ? offset : nearest
  ), offsets[0] ?? 0);
}

const scrollBehavior = (): ScrollBehavior => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

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
  const drag = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const settleFrame = useRef<number | null>(null);
  const items = Children.toArray(children);
  const [edges, setEdges] = useState({ start: true, end: items.length <= 1 });

  const measure = useCallback(() => {
    const el = track.current; if (!el) return;
    const start = el.scrollLeft < 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((current) => current.start === start && current.end === end ? current : { start, end });
    const bar = thumb.current;
    if (bar) { // set here, not through state: the thumb follows the finger without re-rendering the strip
      const max = el.scrollWidth - el.clientWidth;
      const w = Math.max(0.12, el.clientWidth / el.scrollWidth);
      bar.style.width = `${w * 100}%`;
      bar.style.transform = `translateX(${(1 / w - 1) * (max > 0 ? el.scrollLeft / max : 0) * 100}%)`;
    }
  }, []);

  const stopSettling = useCallback((el: HTMLUListElement) => {
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = null;
    delete el.dataset.settling;
  }, []);

  useEffect(() => {
    const el = track.current; if (!el) return;
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    on();
    return () => {
      el.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
      stopSettling(el);
    };
  }, [measure, items.length, stopSettling]);

  const settleAt = (el: HTMLUListElement, left: number) => {
    const start = el.scrollLeft;
    const distance = left - start;
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);

    // Keep native snapping off until the track reaches the chosen slide.
    el.dataset.settling = '';
    delete el.dataset.dragging;
    if (Math.abs(distance) <= 1 || scrollBehavior() === 'auto') {
      el.scrollLeft = left;
      stopSettling(el);
      return;
    }

    const duration = Math.max(160, Math.min(420, Math.abs(distance) * 0.8));
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      el.scrollLeft = start + distance * eased;
      if (progress < 1) settleFrame.current = requestAnimationFrame(animate);
      else stopSettling(el);
    };
    settleFrame.current = requestAnimationFrame(animate);
  };

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const left = adjacentOffset(slideOffsets(el), el.scrollLeft, dir);
    if (left === undefined) return;
    if (settleFrame.current !== null) settleAt(el, left);
    else el.scrollTo({ left, behavior: scrollBehavior() });
  };

  const startDrag = (event: PointerEvent<HTMLUListElement>) => {
    const el = event.currentTarget;
    suppressClick.current = false;
    if (event.pointerType !== 'mouse') {
      stopSettling(el);
      return;
    }
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || el.scrollWidth <= el.clientWidth) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: el.scrollLeft,
      active: false,
    };
  };

  const moveDrag = (event: PointerEvent<HTMLUListElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const el = event.currentTarget;
    const distance = state.startX - event.clientX;
    if (!state.active) {
      const vertical = Math.abs(event.clientY - state.startY);
      if (vertical >= 6 && vertical > Math.abs(distance)) {
        drag.current = null;
        return;
      }
      if (Math.abs(distance) < 6) return;
      state.active = true;
      suppressClick.current = true;
      el.dataset.dragging = '';
      if (settleFrame.current !== null) {
        state.scrollLeft = el.scrollLeft;
        stopSettling(el);
      }
      el.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    el.scrollLeft = state.scrollLeft + distance;
  };

  const endDrag = (event: PointerEvent<HTMLUListElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || (event.type === 'pointerleave' && state.active)) return;
    drag.current = null;
    if (!state.active) return;

    const el = event.currentTarget;
    const offsets = slideOffsets(el);
    const start = nearestOffset(offsets, state.scrollLeft);
    let left = nearestOffset(offsets, el.scrollLeft);
    const distance = state.startX - event.clientX;
    // Advance short, deliberate swipes even when the current slide is still the nearest snap point.
    if (event.type === 'pointerup' && left === start && Math.abs(distance) >= 36) {
      left = adjacentOffset(offsets, start, distance > 0 ? 1 : -1) ?? start;
    }
    settleAt(el, left);
  };

  return (
    <div className="car" role="region" aria-roledescription={t.label} aria-label={label} data-nocount={hideCount || undefined}>
      <ul className="track" ref={track} data-scrollable={!(edges.start && edges.end) || undefined}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onLostPointerCapture={endDrag}
        onDragStart={(event) => {
          if (drag.current) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current || event.detail === 0) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onWheel={(event) => {
          if (event.deltaX || event.shiftKey) stopSettling(event.currentTarget);
        }}>
        {items.map((c, i) => <li key={i} aria-label={position(i + 1, items.length)}>{c}</li>)}
      </ul>
      {items.length > 1 ? (
        <div className="ctl">
          <div className="prog" aria-hidden="true"><i ref={thumb} /></div>
          <div className="arr">
            <IconButton ghost icon="chevron-left" label={t.prev} aria-disabled={edges.start || undefined} onClick={() => !edges.start && step(-1)} />
            <IconButton ghost icon="chevron-right" label={t.next} aria-disabled={edges.end || undefined} onClick={() => !edges.end && step(1)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
