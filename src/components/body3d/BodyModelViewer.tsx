'use client';

import { useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { locales } from '@/i18n/routing';
import { Body3DSlot } from './Body3DSlot';
import { BodyViewerBackgroundPicker } from './BodyViewerBackgroundPicker';
import { BodyViewerCallouts } from './BodyViewerCallouts';
import { ModelSwitch } from './HeroControls';

const DEFAULT_BACKGROUND = '#eee9e2';

function contrastingInk(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? '#000' : '#fff';
}

export function BodyModelViewer({ autoRotate = false }: { autoRotate?: boolean }) {
  const t = useTranslations('body3d');
  const language = useTranslations('nav.langSwitch');
  const locale = useLocale();
  const page = autoRotate ? 'body-model-auto' : 'body-model';
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const style = autoRotate ? {
    backgroundColor: background,
    '--viewer-ink': background === DEFAULT_BACKGROUND ? undefined : contrastingInk(background),
  } as CSSProperties : undefined;

  return (
    <main className={autoRotate ? 'body-viewer body-viewer--auto' : 'body-viewer'} style={style}>
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
        {autoRotate && <BodyViewerBackgroundPicker color={background} onChange={setBackground} />}
      </div>
    </main>
  );
}
