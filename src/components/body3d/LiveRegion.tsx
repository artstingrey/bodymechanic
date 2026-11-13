'use client';
/**
 * aria-live announcements of the body module (ТЗ 6.10, 3D-18). All wording comes from messages (body3d.live.*).
 * Each event renders a fresh node (key = event seq), so identical messages are announced again; recent ones stay side by side
 * (store liveLog), so a quick second event does not swallow the first.
 */
import { useTranslations } from 'next-intl';
import { useBody, type LiveEvent } from '@/lib/body3d/store';
import { zoneLabel } from '@/lib/body3d/zones';

export function LiveRegion({ mode = 'booking' }: { mode?: 'hero' | 'booking' }) {
  const t = useTranslations();
  const log = useBody((s) => s.liveLog);
  // the hero falls back to the poster, not to the 2D scheme: «mark the zones on the scheme or in the list» is booking-only
  const shown = log.filter((e) => !(mode === 'hero' && e.event.type === 'mode2d'));
  const text = (e: LiveEvent) =>
    e.type === 'markerAdded' ? t('body3d.live.markerAdded', { n: e.n, zone: zoneLabel(t, e.zoneId) })
    : e.type === 'markerRemoved' ? t('body3d.live.markerRemoved', { n: e.n })
    : e.type === 'modelSwitched' ? `${t('body3d.live.modelSwitched', { model: e.model, kept: e.kept })}${e.dropped ? ' ' + t('body3d.live.markersDropped', { dropped: e.dropped }) : ''}`
    : t(`body3d.live.${e.type}`);
  return (
    <div className="sr-only" aria-live="polite" data-testid="b3d-live">
      {shown.map((e) => <span key={e.seq}>{text(e.event)} </span>)}
    </div>
  );
}
