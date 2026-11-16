'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export type LandingChip = { id: string; label: string };

export function LandingDetails({ id, chips, picked, onToggle, children }: {
  id: string; chips: LandingChip[]; picked: string[]; onToggle: (id: string) => void; children?: ReactNode;
}) {
  const t = useTranslations('lp.form.details');
  return (
    <details className="chips-d" id={`${id}-details-box`}>
      <summary>{t('toggle')}</summary>
      <fieldset className="chips">
        <legend>{t('hint')}</legend>
        <div className="row">
          {chips.map((chip) => (
            <button key={chip.id} type="button" className="chip" aria-pressed={picked.includes(chip.id)}
              onClick={() => onToggle(chip.id)}>{chip.label}</button>
          ))}
        </div>
        {children}
        <p className="note">{t('note')}</p>
      </fieldset>
    </details>
  );
}
