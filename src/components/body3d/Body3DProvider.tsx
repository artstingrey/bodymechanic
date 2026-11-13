'use client';
/**
 * One persistent 3D canvas for the whole site (README §14).
 * The provider lives in [locale]/layout, so it survives client-side navigation. It owns a single host <div>;
 * whichever page renders a <Body3DSlot> gets the host moved into its slot (DOM move — the WebGL context, the scene and
 * the loaded model stay alive). Hero → /booking therefore never reloads or re-parses the model.
 * The three.js runtime is loaded with a dynamic import after the first paint (ТЗ §13: 3D не входит в JS первого экрана).
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { hydrateBody } from '@/lib/body3d/store';

export type SlotMode = 'hero' | 'booking';
type Slot = { el: HTMLElement; mode: SlotMode; id: number };
type RuntimeProps = { host: HTMLDivElement; slot: Slot | null };

const Ctx = createContext<{ register: (el: HTMLElement, mode: SlotMode) => () => void } | null>(null);
export const useBody3DHost = () => useContext(Ctx);

let seq = 0;

export function Body3DProvider({ children }: { children: React.ReactNode }) {
  const parking = useRef<HTMLDivElement>(null);
  // Created on the client only (null during prerender — the static HTML contains just the poster).
  const [host] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = 'b3d-host';
    el.dataset.testid = 'b3d-host';
    return el;
  });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [Runtime, setRuntime] = useState<ComponentType<RuntimeProps> | null>(null);
  const wantRuntime = useRef(false);

  useEffect(() => { hydrateBody(); }, []); // restore the booking draft (sessionStorage) once on the client

  const loadRuntime = useCallback(() => {
    if (wantRuntime.current) return;
    wantRuntime.current = true;
    const go = () => import('./runtime/Body3DRuntime').then((m) => setRuntime(() => m.default));
    // after the first paint and when the browser is idle (ТЗ §06: модель грузится после отрисовки первого экрана)
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 1200 }) : setTimeout(cb, 200));
    if (document.readyState === 'complete') requestAnimationFrame(() => idle(go));
    else window.addEventListener('load', () => requestAnimationFrame(() => idle(go)), { once: true });
  }, []);

  const register = useCallback((el: HTMLElement, mode: SlotMode) => {
    const slot = { el, mode, id: ++seq };
    setSlots((s) => [...s, slot]);
    loadRuntime();
    return () => setSlots((s) => s.filter((q) => q.id !== slot.id));
  }, [loadRuntime]);

  const active = slots.length ? slots[slots.length - 1] : null;

  // Move the host into the active slot, or park it (hidden) when no page needs 3D.
  useLayoutEffect(() => {
    if (!host) return;
    const target = active?.el ?? parking.current;
    if (target && host.parentElement !== target) target.appendChild(host);
  }, [host, active]);

  const value = useMemo(() => ({ register }), [register]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div ref={parking} hidden aria-hidden="true" />
      {Runtime && host ? <Runtime host={host} slot={active} /> : null}
    </Ctx.Provider>
  );
}
