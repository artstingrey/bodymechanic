'use client';
/**
 * Android hardware «Back» (and the browser Back) closes an open overlay — bottom sheet, burger menu, dialog, cookie
 * settings — instead of leaving the page (README-CONTEXT «ВСЕ iPhone И ВСЕ Android»). While `open`, one history entry
 * with the SAME URL sits on top (Next's own state copied, so its router just re-renders the same page); Back pops it →
 * close(). When the UI closes the overlay, the entry is removed again (history.back()), so the visitor never has to
 * press Back twice.
 * Overlays stack (the help dialog over the half-open «Запись» sheet): each entry carries its depth, and a pop closes
 * only the overlays above the entry Back landed on — one Back, one overlay.
 * `leaving()`: the overlay closes because a link inside it navigates — the entry stays and that link REPLACES it
 * (Link `replace`), so Back on the next page returns straight to this one.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

type OverlayState = { bmOverlay?: number } | null;
const depthOf = (s: unknown) => Number((s as OverlayState)?.bmOverlay) || 0;

export function useBackCloses(open: boolean, close: () => void, leaving?: () => boolean) {
  const closeRef = useRef(close);
  const leavingRef = useRef(leaving);
  useEffect(() => { closeRef.current = close; leavingRef.current = leaving; });
  useEffect(() => {
    if (!open) return;
    const depth = depthOf(window.history.state) + 1;
    window.history.pushState({ ...(window.history.state ?? {}), bmOverlay: depth }, '');
    let popped = false;
    const onPop = (e: PopStateEvent) => { if (depthOf(e.state) < depth) { popped = true; closeRef.current(); } };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // closed by the UI: drop our entry (only if it is still the current one — a link may have replaced it)
      if (!popped && !leavingRef.current?.() && depthOf(window.history.state) === depth) window.history.back();
    };
  }, [open]);
}

/** `open` of a native <dialog> opened with showModal() (no React state of its own) */
export function useDialogOpen(ref: RefObject<HTMLDialogElement | null>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    const sync = () => setOpen(d.open);
    const mo = new MutationObserver(sync);
    mo.observe(d, { attributes: true, attributeFilter: ['open'] });
    sync();
    return () => mo.disconnect();
  }, [ref]);
  return open;
}

/** Back closes this native modal <dialog> */
export function useDialogBackCloses(ref: RefObject<HTMLDialogElement | null>) {
  useBackCloses(useDialogOpen(ref), () => ref.current?.close());
}
