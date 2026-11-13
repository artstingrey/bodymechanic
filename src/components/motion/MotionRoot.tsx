'use client';
/**
 * Mounts the scroll-reveal layer (re-scans on client navigation). GSAP is fetched lazily: after the window load event and an
 * idle slot, so it never competes with the first screen or the 3D model (R-CODE-01 F-04). Renders nothing.
 */
import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { loadMotion } from './tokens';

const whenIdle = (cb: () => void) => {
  const run = () => { if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 1500 }); else setTimeout(cb, 200); };
  if (document.readyState === 'complete') run(); else window.addEventListener('load', run, { once: true });
};

export function MotionRoot() {
  const pathname = usePathname();
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let alive = true;
    whenIdle(() => {
      loadMotion().then((m) => { if (alive) cleanup = m.mountReveals(document.getElementById('main') ?? document); }).catch(() => { /* motion is decoration */ });
    });
    return () => { alive = false; cleanup?.(); };
  }, [pathname]);
  return null;
}
