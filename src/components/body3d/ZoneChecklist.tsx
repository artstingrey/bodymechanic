'use client';
/**
 * Zone list (ТЗ 6.10): the always-available alternative to the 3D model on /booking — zones as checkboxes, the same markers
 * as 3D and 2D. Kept apart from Fallback2D so the 2D module (body2d-callouts + SVG) loads only in 2D mode.
 */
import { useTranslations } from 'next-intl';
import { body, useBody } from '@/lib/body3d/store';
import { BASE_ZONES, PAIRED, zoneLabel } from '@/lib/body3d/zones';

export const ALL_KEYS = BASE_ZONES.flatMap((z) => (PAIRED.has(z) ? [`${z}_l`, `${z}_r`] : [z]));

/** zone list / 2D: toggles the marker of a zone (a new one gets the next free number, the store keeps the 10 limit) */
export function toggleZone(zoneId: string) {
  const m = body.get().markers.find((q) => q.zoneId === zoneId);
  if (m) body.removeMarker(m.id);
  else body.addMarker({ zoneId, position: [0, 0, 0] }); // 3D anchors it on the zone surface when it loads
}

/** Always-available alternative to the 3D model (ТЗ 6.10): zones as checkboxes — the same markers as 3D and 2D. */
export function ZoneChecklist() {
  const t = useTranslations();
  const markers = useBody((s) => s.markers);
  const checked = new Set(markers.map((m) => m.zoneId));
  return (
    <fieldset className="b2d-list" id="zone-list">
      <legend>{t('body3d.list.title')}</legend>
      <p className="todo">{t('body3d.list.text')}</p>
      <p role="status">{t('body3d.list.selected', { count: checked.size })}</p>
      {ALL_KEYS.map((k) => (
        <label key={k}><input type="checkbox" checked={checked.has(k)} onChange={() => toggleZone(k)} /> {zoneLabel(t, k)}</label>
      ))}
    </fieldset>
  );
}
