'use client';
/** Hero: model switch (ТЗ §05.1) and the visible pause/play of the auto-rotation (WCAG 2.2.2, A11Y-15). */
import { useTranslations } from 'next-intl';
import { body, useBody } from '@/lib/body3d/store';
import { Icon } from '@/components/ui/Icon';

export function ModelSwitch() {
  const t = useTranslations();
  const model = useBody((s) => s.model);
  return (
    <div role="group" aria-label={t('body3d.model.label')} className="b3d-switch">
      {(['male', 'female'] as const).map((g) => (
        <button key={g} type="button" aria-pressed={model === g} onClick={() => body.setModel(g)}>{t(`body3d.model.${g}`)}</button>
      ))}
    </div>
  );
}

/**
 * R-3D-01 F-03 (WCAG 4.1.2): constant name «Остановить вращение» + aria-pressed = the PAUSE state
 * (false while the model rotates, true when paused). Hidden under prefers-reduced-motion: nothing rotates there (CSS).
 */
export function RotationToggle() {
  const t = useTranslations();
  const on = useBody((s) => s.autorotate);
  const fallback = useBody((s) => !!s.mode2d || s.status === 'timeout' || s.status === 'error'); // static poster: nothing moves
  const label = t('home.hero.pauseRotation');
  if (fallback) return null;
  return (
    <button type="button" className="b3d-rot" aria-pressed={!on} aria-label={label} title={label} onClick={() => body.setAutorotate(!on)} data-testid="b3d-rotation">
      <Icon name={on ? 'pause' : 'play'} />
    </button>
  );
}
