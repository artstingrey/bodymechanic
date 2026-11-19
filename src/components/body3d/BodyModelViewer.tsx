'use client';

import { useLocale, useTranslations } from 'next-intl';
import { locales } from '@/i18n/routing';
import { Body3DSlot } from './Body3DSlot';
import { BodyViewerCallouts } from './BodyViewerCallouts';
import { ModelSwitch } from './HeroControls';

export function BodyModelViewer({ autoRotate = false }: { autoRotate?: boolean }) {
  const t = useTranslations('body3d');
  const language = useTranslations('nav.langSwitch');
  const locale = useLocale();
  const page = autoRotate ? 'body-model-auto' : 'body-model';

  return (
    <main className={autoRotate ? 'body-viewer body-viewer--auto' : 'body-viewer'}>
      <h1 className="sr-only">{t('viewer.title')}</h1>
      <div className="body-viewer__controls" role="group" aria-label={t('toolbar.label')}>
        <ModelSwitch />
        <nav className="seg lang-switch body-viewer__languages" aria-label={language('label')}>
          {locales.map((id) => id === locale ? (
            <span key={id} lang={id} aria-current="page">{language(id)}</span>
          ) : (
            <a key={id} href={`/${id}/${page}/`} hrefLang={id} rel="nofollow"
              aria-label={`${language(id)}. ${language(id === 'ru' ? 'toRu' : 'toEn')}`}>{language(id)}</a>
          ))}
        </nav>
      </div>
      <div className="body-viewer__stage">
        <Body3DSlot mode="viewer" autoRotate={autoRotate} />
        <BodyViewerCallouts />
      </div>
    </main>
  );
}
