'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Segmented } from '@/components/ui/Choice';
import { locales } from '@/i18n/routing';
import { useBody, useBodyStore } from '@/lib/body3d/store';
import { Body3DSlot } from './Body3DSlot';
import { BodyViewerCallouts } from './BodyViewerCallouts';
import { ModelSwitch } from './HeroControls';
import type { BodySide } from './Fallback2D';

export function BodyModelViewer() {
  const t = useTranslations('body3d');
  const language = useTranslations('nav.langSwitch');
  const locale = useLocale();
  const store = useBodyStore();
  const mode2d = useBody((s) => s.mode2d);
  const [side, setSide] = useState<BodySide>('front');

  const show3d = () => {
    if (!mode2d || mode2d === 'noWebgl') return;
    const { status } = store.get();
    if (status === 'error' || status === 'timeout') store.retryLoad();
    store.setMode2d(false);
  };

  return (
    <main className="body-viewer">
      <h1 className="sr-only">{t('viewer.title')}</h1>
      <div className="body-viewer__controls" role="group" aria-label={t('toolbar.label')}>
        <div className="seg" role="group" aria-label={t('viewer.mode')}>
          <button type="button" aria-label={t('toolbar.switch3d')} aria-pressed={!mode2d} onClick={show3d}
            disabled={mode2d === 'noWebgl'} title={mode2d === 'noWebgl' ? t('mode2d.noWebgl') : undefined}>{t('toolbar.switch3dShort')}</button>
          <button type="button" aria-label={t('toolbar.switch2d')} aria-pressed={!!mode2d}
            onClick={() => { if (!mode2d) store.setMode2d('user'); }}>{t('toolbar.switch2dShort')}</button>
        </div>
        <ModelSwitch />
        {mode2d ? (
          <Segmented label={t('viewer.side')} value={side} onChange={setSide}
            options={[{ value: 'front', label: t('list.groupFront') }, { value: 'back', label: t('list.groupBack') }]} />
        ) : (
          <button className="body-viewer__reset" type="button" onClick={store.resetView}>{t('toolbar.reset')}</button>
        )}
        <nav className="seg lang-switch body-viewer__languages" aria-label={language('label')}>
          {locales.map((id) => id === locale ? (
            <span key={id} lang={id} aria-current="page">{language(id)}</span>
          ) : (
            <a key={id} href={`/${id}/body-model/`} hrefLang={id} rel="nofollow"
              aria-label={`${language(id)}. ${language(id === 'ru' ? 'toRu' : 'toEn')}`}>{language(id)}</a>
          ))}
        </nav>
      </div>
      <div className="body-viewer__stage">
        <Body3DSlot mode="viewer" viewerSide={side} />
        {!mode2d ? <BodyViewerCallouts /> : null}
      </div>
    </main>
  );
}
