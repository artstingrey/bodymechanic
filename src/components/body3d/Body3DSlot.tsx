'use client';
/**
 * Where the persistent 3D canvas appears on a page. Static HTML = the poster (LCP candidate);
 * the canvas is moved in after the first paint and cross-fades over the poster when the model is ready.
 *
 * Fallbacks (ТЗ 6.10/6.11 + lead's decision for the hero):
 *  - booking: no WebGL / FPS < 20 / 15 s timeout / «Перейти в 2D» → the 2D silhouette (Fallback2D);
 *  - hero: NO 2D silhouette — the front-view poster stays (data-fallback), the anchors for the hero index are published from
 *    the poster (usePosterAnchors); no sway, no pause button, no loading / timeout UI over the hero.
 *  - standalone viewer: use the selected model's poster when WebGL is unavailable or loading fails.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import assets from '@/lib/body3d/assets.json';
import { useBody, useBodyStore } from '@/lib/body3d/store';
import { useBody3DHost, type SlotMode } from './Body3DProvider';
import { LiveRegion } from './LiveRegion';
import { usePosterAnchors } from './usePosterAnchors';
import { heroIntro, heroReveal, REVEAL_FAILSAFE_MS } from '@/lib/body3d/heroIntro';

// the 2D module (silhouettes + body2d-callouts) is needed only in 2D mode on /booking → its own chunk, not on the first screen
const Fallback2D = dynamic(() => import('./Fallback2D').then((m) => m.Fallback2D), { ssr: false });

/** hero shows the static poster instead of the 3D model */
export const heroFallback = (s: { mode2d: unknown; status: string }) => !!s.mode2d || s.status === 'timeout' || s.status === 'error';

export function Body3DSlot({ mode, className = '' }: { mode: SlotMode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const ctx = useBody3DHost();
  const t = useTranslations();
  const store = useBodyStore();
  const model = useBody((s) => s.model);
  const status = useBody((s) => s.status);
  const progress = useBody((s) => s.progress);
  const mode2d = useBody((s) => s.mode2d);
  const hint = useBody((s) => s.hint);
  const posterMode = mode === 'hero' && heroFallback({ mode2d, status });
  // the visible hint (e.g. tap on the head / front of the shin) fades after 5 s; aria-live announces it separately
  useEffect(() => { if (!hint) return; const id = window.setTimeout(() => store.clearHint(), 5000); return () => window.clearTimeout(id); }, [hint, store]);

  useEffect(() => { if (ref.current && ctx) return ctx.register(ref.current, mode); }, [ctx, mode]);
  // RC-5 (lead; FB + AD): the hero index stands on the POSTER's anchors also while the model loads (not only in the fallback)
  // — the rows, dots and lines are where the live 3D anchors will put them, so the handover does not move them (it used
  // to jump 27–37 px and the lines appeared only with the model). The runtime's first publish replaces them seamlessly
  // (the poster's are not cleared).
  usePosterAnchors(ref, mode === 'hero' && (posterMode || status !== 'ready'), model);

  // RC-5 (lead, HM-04): the hero shows the model only once the index intro has drawn its lines on the poster
  // (lib/body3d/heroIntro); until then the poster stays over the canvas and data-status at «loading»; failsafe: 1 s after
  // ready. Every other mode is untouched.
  const hero = mode === 'hero';
  const introDone = useSyncExternalStore(heroIntro.subscribe, heroIntro.canReveal, () => false);
  const [late, setLate] = useState(false);
  const held = hero && status === 'ready' && !mode2d && !introDone && !late;
  // the hero mounts with the model already live (a client navigation from /booking): no intro to wait for — the signal at
  // once (before HeroAtlas's first draw: child layout effects run first), so neither the poster covers the live model nor
  // the lines draw over it
  useLayoutEffect(() => { if (hero && store.get().status === 'ready') heroIntro.done(true); }, [hero, store]);
  useEffect(() => {
    if (!hero || status !== 'ready' || mode2d) return;
    heroReveal.ready();
    if (introDone || late) return;
    const id = window.setTimeout(() => setLate(true), REVEAL_FAILSAFE_MS);
    return () => window.clearTimeout(id);
  }, [hero, status, mode2d, introDone, late]);
  // the runtime starts the sway clock from here (Scene): the model waited in the front pose under the poster
  useLayoutEffect(() => { if (hero && status === 'ready' && !mode2d && !held) heroReveal.show(!introDone); }, [hero, status, mode2d, held, introDone]);

  const p = assets.posters[model];
  const booking = mode === 'booking';
  const viewer = mode === 'viewer';
  const viewerAlert = status === 'unavailable' ? 'body3d.mode2d.noWebgl'
    : status === 'error' ? 'body3d.load.error'
    : status === 'timeout' ? 'body3d.load.timeoutTitle' : null;
  return (
    <div ref={ref} className={`b3d-slot ${className}`} data-mode={mode} data-status={held ? 'loading' : status} data-mode2d={mode2d || undefined}
      data-fallback={posterMode || undefined} role="group"
      aria-label={t(viewer ? (status === 'ready' ? 'body3d.viewer.canvasLabel' : 'body3d.viewer.title') : 'body3d.canvasLabel')}>
      <picture className="b3d-poster" style={held ? { zIndex: 2 } : undefined}>
        <source srcSet={p.avif} type="image/avif" />
        <source srcSet={p.webp} type="image/webp" />
        {/* the LCP element of / and /booking: no decoding="async" — it let the paint slip behind the hydration tasks (R-FINAL-2: render delay) */}
        <img src={p.png} width={p.width} height={p.height} alt={t('home.hero.posterAlt')} fetchPriority="high" />
      </picture>
      {/* RC-6 (lead + AD): no loading badge over the hero figure — the hero's caption under the model shows the progress */}
      {status === 'loading' && !mode2d && !hero ? <div className={viewer ? 'sr-only' : 'b3d-loader'} role="status">{t('body3d.load.progress', { percent: Math.round(progress * 100) })}</div> : null}
      {viewer && viewerAlert ? <p className="sr-only" role="alert">{t(viewerAlert)}</p> : null}
      {booking && status === 'error' && !mode2d ? (
        <div className="b3d-loader" role="alert">
          {t('body3d.load.error')}{' '}
          <button type="button" onClick={() => store.retryLoad()}>{t('common.actions.retry')}</button>{' '}
          <button type="button" onClick={() => store.setMode2d('user')}>{t('body3d.load.switchTo2d')}</button>
        </div>
      ) : null}
      {booking && status === 'timeout' && !mode2d ? (
        <div className="b3d-dialog" role="alertdialog" aria-labelledby="b3d-timeout-title">
          <p id="b3d-timeout-title"><b>{t('body3d.load.timeoutTitle')}</b></p>
          <p>{t('body3d.load.timeoutText')}</p>
          <button type="button" onClick={() => store.setMode2d('timeout')}>{t('body3d.load.switchTo2d')}</button>
          <button type="button" onClick={() => store.setStatus('loading')}>{t('body3d.load.keepWaiting')}</button>
        </div>
      ) : null}
      {hint && !mode2d ? <p className="b3d-hint" key={hint.seq}>{t(`body3d.hint.${hint.key}`)}</p> : null}
      {booking && mode2d ? <Fallback2D /> : null}
      {!viewer ? <LiveRegion mode={mode} /> : null}
    </div>
  );
}
