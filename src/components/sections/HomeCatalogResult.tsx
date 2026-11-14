'use client';

import { useEffect, useRef, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { loadMotion } from '@/components/motion/tokens';

export function HomeCatalogResult({ headingId, slides, failed, error, retry, loading, children }: {
  headingId: string; slides: string; failed: boolean; error: string; retry: string; loading: string; children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const restoreFocus = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  // Refreshing a sibling can replace the RSC children prop without changing this carousel.
  useEffect(() => {
    if (!failed && restoreFocus.current && document.activeElement === document.body) {
      document.getElementById(headingId)?.focus({ preventScroll: true });
    }
    if (!failed) restoreFocus.current = false;
    const scope = root.current;
    let cleanup: (() => void) | undefined;
    let active = true;
    if (scope) loadMotion().then(({ mountReveals, refreshReveals }) => {
      if (!active) return;
      cleanup = mountReveals(scope);
      refreshReveals();
    }).catch(() => { /* Motion is optional. */ });
    return () => { active = false; cleanup?.(); };
  }, [failed, headingId, slides]);

  return (
    <div ref={root} data-motion-scope="">
      {failed ? (
        <div className="home-catalog-state">
          <p className="lead" role="status">{pending ? loading : error}</p>
          <Button variant="secondary" size="sm" aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={(event) => {
            if (pending) return;
            restoreFocus.current = document.activeElement === event.currentTarget;
            startTransition(() => router.refresh());
          }}>{retry}</Button>
        </div>
      ) : children}
    </div>
  );
}
