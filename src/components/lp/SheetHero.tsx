'use client';
/**
 * A/B test variant of the hero (?form=sheet, lead): a button with the test label «Записаться на первый визит» and the same
 * form in a bottom sheet (native modal dialog: focus trap, Esc, focus back on the button). Rendered in the static HTML for
 * both variants; the inline flag script in the layout shows one of them before the first paint (no layout shift).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useBackCloses } from '@/lib/ui/useBackCloses';
import { LeadForm } from './LeadForm';

export function SheetHero({ variant, chips, waHref, privacyHref }: {
  variant: 'a' | 'b'; chips: { id: string; label: string }[]; waHref: string; privacyHref: string;
}) {
  const t = useTranslations('lp');
  const tc = useTranslations('common.actions');
  const dlg = useRef<HTMLDialogElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // Android «Назад» closes the sheet instead of leaving the page (README-CONTEXT «ВСЕ iPhone И ВСЕ Android»): the shared
  // hook of the site sheets keeps one history entry while it is open; closed by ×, Esc, the backdrop or Chrome's close
  // watcher → the entry goes away again
  const [open, setOpen] = useState(false);
  useBackCloses(open, () => dlg.current?.close());
  useEffect(() => {
    const d = dlg.current; if (!d) return;
    const show = () => { if (!d.open) { d.showModal(); setOpen(true); } };
    const onClose = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
    window.addEventListener('lp:open-sheet', show);
    d.addEventListener('close', onClose);
    return () => { window.removeEventListener('lp:open-sheet', show); d.removeEventListener('close', onClose); };
  }, []);
  return (
    <>
      <div className="lp-hero-cta">
        <div className="row">
          <button ref={btn} type="button" className="btn btn--p" aria-haspopup="dialog" data-lp-cta="" onClick={() => window.dispatchEvent(new Event('lp:open-sheet'))}>
            {t('form.submit')}<Icon name="arrow-right" />
          </button>
          <a className="btn btn--wa btn--icon" href={waHref} target="_blank" rel="noopener noreferrer" aria-label={t('form.whatsapp')} data-track="whatsapp"><span className="wa"><Icon name="whatsapp" /></span></a>
        </div>
        <p className="resp">{t('form.phoneHint')}</p>
      </div>
      <dialog ref={dlg} className="lp-sheet" aria-labelledby="lp-sheet-title" onClick={(e) => { if (e.target === e.currentTarget) dlg.current?.close(); }}>
        <div className="lp-sheet__top">
          <h2 id="lp-sheet-title">{t('form.title')}</h2>
          <button type="button" className="lp-sheet__x" aria-label={tc('close')} onClick={() => dlg.current?.close()}><Icon name="x" /></button>
        </div>
        <LeadForm id="lp-fs" variant={variant} chips={chips} submitLabel={t('form.submit')} waHref={waHref} privacyHref={privacyHref} cta={false} />
      </dialog>
    </>
  );
}
