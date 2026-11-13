'use client';
/**
 * Non-modal bottom sheet with three snap points (ТЗ 6.9, R-FINAL F-01; ui-kit «Нижний лист»): peek (handle + head),
 * half, full. Active on phones in the sheet layout (lib/ui/media SHEET_MQ: under 768 px, not short landscape — RC-3) — wider
 * screens and short landscape phones get the children as a plain panel (the sheet chrome is hidden).
 *  - handle = <button aria-expanded>: tap toggles peek ⇄ half; ↑/↓ move one snap; Esc (anywhere in the sheet) → peek,
 *    focus back on the handle;
 *  - drag on the handle and the head only (touch-action: none there); the body keeps its own native scroll;
 *  - motion: transform only (README п.15), 300 ms --e-out; reduced motion → instant; the snap follows the finger 1:1.
 * The canvas under the sheet is never touched: the sheet is a sibling of the 3D slot, above it in z-order.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useBackCloses } from '@/lib/ui/useBackCloses';
import { isSheetLayout } from '@/lib/ui/media';

export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

export function BottomSheet({ head, label, swipeHint, children, className, expandOn }: {
  head: ReactNode; label: string; swipeHint: string; children: ReactNode; className?: string;
  /** when this value grows (e.g. the marker count), the sheet opens to «half» so the new card is visible */
  expandOn?: number;
}) {
  const [snap, setSnap] = useState<Snap>('peek');
  // Android «Back» brings an open sheet (half / full, phones) back to peek instead of leaving the page (Frontend Builder)
  useBackCloses(snap !== 'peek' && isSheetLayout(), () => setSnap('peek'));
  const ref = useRef<HTMLElement>(null);
  const grab = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const drag = useRef<{ y0: number; t0: number; from: number; dy: number; id: number; cap: boolean } | null>(null);

  // offsets (px from the fully open position) of each snap, read from CSS custom properties of the sheet
  const offsets = useCallback(() => {
    const el = ref.current; if (!el) return { peek: 0, half: 0, full: 0 };
    const h = el.offsetHeight, cs = getComputedStyle(el);
    // custom properties keep their units (52svh stays «52svh»): convert svh / vh / px here
    const vhPx = (window.visualViewport?.height ?? window.innerHeight) / 100;
    const px = (v: string) => {
      const raw = cs.getPropertyValue(v).trim(), n = parseFloat(raw);
      if (!Number.isFinite(n)) return 0;
      return /vh$/.test(raw) ? n * vhPx : n;
    };
    return { peek: Math.max(0, h - px('--peek')), half: Math.max(0, h - px('--half')), full: 0 };
  }, []);

  // open to «half» when the watched count grows (new marker on a phone)
  const prev = useRef(expandOn ?? 0);
  useEffect(() => {
    const n = expandOn ?? 0;
    if (n > prev.current && isSheetLayout()) setSnap((s) => (s === 'peek' ? 'half' : s));
    prev.current = n;
  }, [expandOn]);

  // pointer: capture at once (the finger leaves the 70 px head on the first move); a short press is a tap → toggle;
  // keyboard activation of the handle (click with detail 0) toggles too. Pointer clicks on the handle are ignored there.
  const toggle = () => setSnap((s) => (s === 'peek' ? 'half' : 'peek'));
  const onDown = (e: React.PointerEvent) => {
    if (!isSheetLayout() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { y0: e.clientY, t0: performance.now(), from: offsets()[snap], dy: 0, id: e.pointerId, cap: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, el = ref.current; if (!d || !el) return;
    d.dy = e.clientY - d.y0;
    if (!d.cap) { if (Math.abs(d.dy) < 6) return; d.cap = true; el.dataset.dragging = ''; }
    const o = offsets(); const y = Math.min(o.peek, Math.max(0, d.from + d.dy));
    el.style.transform = `translateY(${y}px)`;
  };
  const onUp = () => {
    const d = drag.current, el = ref.current; drag.current = null; if (!d || !el) return;
    if (!d.cap) { toggle(); return; } // a tap
    delete el.dataset.dragging; el.style.transform = '';
    const o = offsets(); const y = d.from + d.dy; const v = d.dy / Math.max(1, performance.now() - d.t0); // px/ms, + = down
    let next: Snap = ORDER.reduce((best, s) => (Math.abs(o[s] - y) < Math.abs(o[best] - y) ? s : best), 'peek' as Snap);
    if (Math.abs(v) > 0.6) next = ORDER[Math.max(0, Math.min(2, ORDER.indexOf(snap) + (v < 0 ? 1 : -1)))]; // a flick moves one snap
    setSnap(next);
  };
  const onCancel = () => { const el = ref.current; drag.current = null; if (el) { delete el.dataset.dragging; el.style.transform = ''; } };

  // iOS keeps the layout viewport under the on-screen keyboard: publish its height as --kb so the fixed sheet and the CTA
  // bar ride above it (Android resizes the layout viewport → --kb stays 0)
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    const root = document.documentElement;
    const on = () => { const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); root.style.setProperty('--kb', `${kb}px`); };
    on(); vv.addEventListener('resize', on); vv.addEventListener('scroll', on);
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); root.style.removeProperty('--kb'); };
  }, []);
  // a field inside the sheet gets focus (marker note, general note): open fully and keep the field visible
  const onFocusIn = (e: React.FocusEvent) => {
    if (!isSheetLayout()) return;
    const el = e.target as HTMLElement;
    if (!el.matches('textarea, input, select')) return;
    setSnap('full');
    window.setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 320); // after the snap transition and the keyboard
  };
  useEffect(() => {
    if (snap === 'peek') return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return; // modal dialogs own Esc
      setSnap('peek'); if (ref.current?.contains(document.activeElement)) grab.current?.focus();
    };
    window.addEventListener('keydown', onEsc); return () => window.removeEventListener('keydown', onEsc);
  }, [snap]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && snap !== 'peek') { e.stopPropagation(); setSnap('peek'); grab.current?.focus(); }
  };
  const onGrabKey = (e: React.KeyboardEvent) => {
    const i = ORDER.indexOf(snap);
    if (e.key === 'ArrowUp' && i < 2) { e.preventDefault(); setSnap(ORDER[i + 1]); }
    if (e.key === 'ArrowDown' && i > 0) { e.preventDefault(); setSnap(ORDER[i - 1]); }
  };

  return (
    <section ref={ref} className={['bsheet', className].filter(Boolean).join(' ')} data-snap={snap} onKeyDown={onKey} aria-label={label}>
      <div className="bsheet__head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
        <button ref={grab} type="button" className="bsheet__grab" aria-expanded={snap !== 'peek'} aria-controls={bodyId}
          onKeyDown={onGrabKey}
          onClick={(e) => { if (e.detail === 0) toggle(); }}>
          <span className="sr-only">{swipeHint}</span>
        </button>
        {head}
      </div>
      <div className="bsheet__body" id={bodyId} onFocus={onFocusIn}>{children}</div>
    </section>
  );
}
