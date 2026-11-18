'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { bodyAnchors } from '@/lib/body3d/anchors';
import { VIEWER_CALLOUTS } from '@/lib/body3d/viewer-callouts';
import { baseOf, zoneLabel } from '@/lib/body3d/zones';

export function BodyViewerCallouts() {
  const t = useTranslations();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const overlay = list.current;
    if (!overlay) return;
    const items = Array.from(overlay.querySelectorAll('li'), (row) => ({
      row,
      name: row.querySelector<HTMLElement>('.body-viewer__label')!,
      line: row.querySelector<HTMLElement>('.atlas-line')!,
      dot: row.querySelector<HTMLElement>('.atlas-dot')!,
    }));

    const draw = () => {
      const { mode, zones, width, height } = bodyAnchors.get();
      if (mode !== 'viewer') return;
      const anchors = new Map(zones.filter((point) => point.visible).map((point) => [point.zoneId, point]));
      const column = Math.min(180, Math.max(73, width * 0.2));
      const leftRail = Math.max(column + 10, width / 2 - height * 0.21);
      const gap = width < 600 ? 42 : 30;
      const placed = new Set<HTMLLIElement>();

      for (const side of ['left', 'right'] as const) {
        const left = side === 'left';
        const rail = left ? leftRail : width - leftRail;
        const end = rail + (left ? 5 : -5);
        const candidates = VIEWER_CALLOUTS.flatMap((zone, index) => {
          const point = anchors.get(zone.id);
          return zone.side === side && point && (left ? point.x > end : point.x < end) ? [{ point, ...items[index] }] : [];
        }).sort((a, b) => a.point.y - b.point.y);

        let nextY = gap / 2;
        for (const { point, row, name, line, dot } of candidates) {
          const y = Math.max(nextY, Math.min(point.y, height - gap / 2));
          if (y > height - gap / 2) break;
          nextY = y + gap;
          placed.add(row);
          name.style.width = `${column}px`;
          name.style.left = `${left ? rail - column : rail}px`;
          name.style.top = `${y}px`;
          const dx = end - point.x;
          const dy = y - point.y;
          dot.style.transform = `translate(${point.x}px, ${point.y}px)`;
          line.style.transform = `translate(${point.x}px, ${point.y}px) rotate(${Math.atan2(dy, dx)}rad) scaleX(${Math.hypot(dx, dy)})`;
        }
      }
      for (const { row } of items) row.hidden = !placed.has(row);
    };

    const unsubscribe = bodyAnchors.subscribe(draw);
    draw();
    return unsubscribe;
  }, []);

  return (
    <ul className="body-viewer__callouts" aria-label={t('body3d.viewer.labels')} ref={list}>
      {VIEWER_CALLOUTS.map(({ id, side }) => (
        <li key={id} hidden data-zone={id} data-side={side} aria-label={zoneLabel(t, id)}>
          <span className="body-viewer__label">{t(`body3d.zones.${baseOf(id)}`)}</span>
          <span className="atlas-line" aria-hidden="true" />
          <span className="atlas-dot" aria-hidden="true"><i /></span>
        </li>
      ))}
    </ul>
  );
}
