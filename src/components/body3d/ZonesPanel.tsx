'use client';
/**
 * Booking step 1 «Зоны» (ТЗ 6.2–6.7): tools, marker list (note ≤ 200, intensity 1–10), clear all, general note ≤ 400,
 * left-panel accordions (help / contraindications / prices). Structure only — layout comes from the style frame.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { body, MAX_MARKERS, useBody, type Marker, type Tool } from '@/lib/body3d/store';
import { DEFAULT_MARKER_INTENSITY, GENERAL_NOTE_LIMIT, MARKER_NOTE_LIMIT } from '@/lib/body3d/booking-details';
import { zoneLabel } from '@/lib/body3d/zones';
import { getBookingCatalog } from '@/components/booking/service-catalog';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import { formatCatalogServicePrice } from '@/lib/catalog-service-price';
import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';
import { ModelSwitch } from './HeroControls';
import { Todo } from '@/components/ui/Todo';
import { Icon } from '@/components/ui/Icon';
import { useDialogBackCloses } from '@/lib/ui/useBackCloses';

export function Toolbar() {
  const t = useTranslations();
  const mode2d = useBody((s) => s.mode2d);
  const tool = useBody((s) => s.tool);
  const tools: Tool[] = ['rotate', 'zoom', 'marker'];
  return (
    <div className="b3d-toolbar" role="toolbar" aria-label={t('body3d.toolbar.label')}>
      <ModelSwitch />
      {/* 3D tools only with the 3D model — in 2D they would be dead buttons (R-APP-02 F-01) */}
      {mode2d ? null : (
        <>
          <div role="group" aria-label={t('body3d.toolbar.label')}>
            {tools.map((k) => <button key={k} type="button" aria-pressed={tool === k} title={t(`body3d.toolbar.${k}Hint`)} onClick={() => body.setTool(k)}>{t(`body3d.toolbar.${k}`)}</button>)}
          </div>
          {/* the icon shows only where «Сброс вида» becomes a 44 px icon button (landscape phones ≤ 320 px high, booking.css);
              the label stays the accessible name there */}
          <button type="button" className="b3d-reset" title={t('body3d.toolbar.resetHint')} onClick={() => body.resetView()}><Icon name="undo" /><span className="b3d-reset__t">{t('body3d.toolbar.reset')}</span></button>
        </>
      )}
      {/* ТЗ 6.10: the 2D diagram on demand (keyboard / screen reader / preference); «Try 3D again» brings the model back */}
      {mode2d ? (
        mode2d !== 'noWebgl' ? <button type="button" data-testid="switch-3d" aria-label={`${t('body3d.toolbar.switch3d')}. ${t('body3d.toolbar.switch3dAria')}`} onClick={() => body.setMode2d(false)}><span className="b3d-sw__full">{t('body3d.toolbar.switch3d')}</span><span className="b3d-sw__short" aria-hidden="true">{t('body3d.toolbar.switch3dShort')}</span></button> : null
      ) : (
        <button type="button" data-testid="switch-2d" aria-label={`${t('body3d.toolbar.switch2d')}. ${t('body3d.toolbar.switch2dAria')}`} onClick={() => body.setMode2d('user')}><span className="b3d-sw__full">{t('body3d.toolbar.switch2d')}</span><span className="b3d-sw__short" aria-hidden="true">{t.has('body3d.toolbar.switch2dShort') ? t('body3d.toolbar.switch2dShort') : t('body3d.toolbar.switch2d')}</span></button>
      )}
    </div>
  );
}

/** countSlot (RC-6): replaces the count line under «Запись» — the booking puts its restored-draft offer there */
export function MarkerList({ countSlot }: { countSlot?: ReactNode } = {}) {
  const t = useTranslations();
  const markers = useBody((s) => s.markers);
  const generalNote = useBody((s) => s.generalNote);
  // «Очистить все» (3D-07, R-APP-01 F-03): confirmation in a native modal dialog (focus trap, Esc, focus returns to the
  // button), then a toast with «Вернуть» for 8 s
  const confirmRef = useRef<HTMLDialogElement>(null);
  useDialogBackCloses(confirmRef); // Android «Back» closes the «clear all» confirmation
  const opener = useRef<HTMLElement | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [undo, setUndo] = useState<Marker[] | null>(null);
  useEffect(() => { if (!undo) return; const id = window.setTimeout(() => setUndo(null), 8000); return () => window.clearTimeout(id); }, [undo]);
  // return the focus to «Очистить все» when the dialog closes (Esc / «Оставить»); if it is disabled now, to the «Вернуть» toast
  useEffect(() => {
    const d = confirmRef.current; if (!d) return;
    const back = () => requestAnimationFrame(() => {
      const o = opener.current;
      if (o?.isConnected && !(o as HTMLButtonElement).disabled) o.focus();
      else document.querySelector<HTMLElement>('.b3d-toast button')?.focus();
    });
    d.addEventListener('close', back);
    return () => d.removeEventListener('close', back);
  }, []);
  return (
    <section aria-labelledby="b3d-panel-title" className="b3d-panel">
      <h2 id="b3d-panel-title">{t('body3d.panel.title')}</h2>
      {countSlot ?? <p>{markers.length ? t('body3d.sheet.count', { count: markers.length }) : t('body3d.sheet.countZero')}</p>}
      {markers.length === 0 ? <p>{t('body3d.panel.empty')}</p> : null}
      <ol className="b3d-markers">
        {[...markers].sort((a, b) => a.n - b.n).map((m) => (
          <li key={m.id} data-testid="b3d-marker">
            <h3>{t('body3d.panel.markerTitle', { n: m.n, zone: zoneLabel(t, m.zoneId) })}</h3>
            <label>
              <span className="sr-only">{t('body3d.panel.notePlaceholder')}</span>
              <textarea maxLength={MARKER_NOTE_LIMIT} placeholder={t('body3d.panel.notePlaceholder')} value={m.note ?? ''} onChange={(e) => body.updateMarker(m.id, { note: e.target.value })} />
            </label>
            <span className="b3d-count">{t('body3d.panel.noteCounter', { count: (m.note ?? '').length, max: MARKER_NOTE_LIMIT })}</span>
            <div className="b3d-intensity">
              <p className="cap" id={`int-${m.id}`}>{t('body3d.panel.intensity', { value: m.intensity ?? DEFAULT_MARKER_INTENSITY })}</p>
              {/* R-HIFI-01 N-05: radiogroup 1–10 (sand → terracotta), ←/→ move the value; same handler as the old range */}
              <div className="scale" role="radiogroup" aria-label={t('body3d.panel.intensityAria')} aria-describedby={`int-${m.id}`}>
                {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => {
                  const v = m.intensity ?? DEFAULT_MARKER_INTENSITY;
                  return (
                    <button key={n} type="button" role="radio" aria-checked={v === n} tabIndex={v === n ? 0 : -1}
                      data-fill={n < v ? Math.max(1, Math.min(4, Math.ceil((n / v) * 4))) : undefined}
                      onClick={() => body.updateMarker(m.id, { intensity: n })}
                      onKeyDown={(e) => {
                        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
                        if (!d) return;
                        e.preventDefault();
                        const next = Math.min(10, Math.max(1, v + d));
                        body.updateMarker(m.id, { intensity: next });
                        (e.currentTarget.parentElement?.children[next - 1] as HTMLElement | undefined)?.focus();
                      }}>{n}</button>
                  );
                })}
              </div>
            </div>
            <button type="button" className="b3d-remove" aria-label={t('body3d.panel.removeMarker', { n: m.n })} onClick={() => body.removeMarker(m.id)}>
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </li>
        ))}
      </ol>
      {markers.length >= MAX_MARKERS ? <p role="status">{t('body3d.panel.maxReached', { max: MAX_MARKERS })}</p> : null}
      <button type="button" disabled={!markers.length} onClick={(e) => { opener.current = e.currentTarget; confirmRef.current?.showModal(); keepRef.current?.focus(); }}>{t('body3d.panel.clearAll')}</button>
      <dialog ref={confirmRef} className="b3d-confirm" aria-labelledby="b3d-clear-title">
        <p id="b3d-clear-title"><b>{t('body3d.panel.clearConfirmTitle')}</b></p>
        <button type="button" onClick={() => { const snapshot = body.clearMarkers(); confirmRef.current?.close(); setUndo(snapshot); }}>{t('body3d.panel.clearConfirmYes')}</button>
        {/* the safe choice gets the initial focus (set after showModal: React does not render the autofocus attribute) */}
        <button type="button" ref={keepRef} onClick={() => confirmRef.current?.close()}>{t('body3d.panel.clearConfirmNo')}</button>
      </dialog>
      {undo ? (
        <div className="b3d-toast" role="status">
          {t('body3d.panel.clearedToast')}{' '}
          <button type="button" onClick={() => { body.restoreMarkers(undo); setUndo(null); }}>{t('body3d.panel.undo')}</button>
        </div>
      ) : null}
      <label className="b3d-general">
        {t('body3d.panel.generalNote')}
        <textarea maxLength={GENERAL_NOTE_LIMIT} placeholder={t('body3d.panel.generalNotePlaceholder')} value={generalNote} onChange={(e) => body.setGeneralNote(e.target.value)} />
        <span className="b3d-count" aria-hidden="true">{t('body3d.panel.noteCounter', { count: generalNote.length, max: GENERAL_NOTE_LIMIT })}</span>
      </label>
    </section>
  );
}

function BookingPrices({ locale }: { locale: CatalogLocale }) {
  const t = useTranslations();
  const [services, setServices] = useState<CatalogService[] | null>();
  useEffect(() => {
    const request = new AbortController();
    getBookingCatalog(locale, request.signal).then(
      (catalog) => { if (!request.signal.aborted) setServices(catalog.services); },
      () => { if (!request.signal.aborted) setServices(null); },
    );
    return () => request.abort();
  }, [locale]);

  if (services === undefined) return <p role="status">{t('common.state.loading')}</p>;
  if (services === null) return <p role="status">{t('body3d.prices.loadError')}</p>;
  if (!services.length) return <p role="status">{t('booking.service.empty')}</p>;

  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  return (
    <ul>{services.map((service) => {
      const title = homeServiceTitle(locale, service, translations);
      const price = formatCatalogServicePrice(service, locale, {
        unknown: () => t('home.services.priceUnknown'),
        from: (value) => t('home.services.priceFrom', { price: value }),
      });
      const duration = service.durationMin === null ? null : t('home.services.duration', { minutes: service.durationMin });
      return <li key={service.id}>{[title, price, duration].filter(Boolean).join(' · ')}</li>;
    })}</ul>
  );
}

export function LeftPanel({ locale }: { locale: CatalogLocale }) {
  const t = useTranslations();
  const [pricesOpen, setPricesOpen] = useState(false);
  return (
    <aside className="b3d-left" aria-label={t('body3d.helpButtonAria')}>
      <details open>
        <summary>{t('body3d.help.title')}</summary>
        <p>{t('body3d.help.step1')}</p>
        <p>{t('body3d.help.step2')}</p>
        <p>{t('body3d.help.step3')}</p>
        <p>{t('body3d.help.sides')}</p>
        <p>{t('body3d.help.tools')}</p>
      </details>
      <details>
        <summary>{t('body3d.contra.title')}</summary>
        <p>{t('body3d.contra.intro')}</p>
        {/* starting list of 7 (client, HI-FI decisions; CMS at stage 2, «юристы»): the item set comes from the deck */}
        <ul>{Object.keys(t.raw('contraindications.items') as Record<string, string>).map((k) => <li key={k}>{t(`contraindications.items.${k}`)}</li>)}</ul>
        <Todo as="p">{t('contraindications.todo')}</Todo>
      </details>
      <details onToggle={(event) => setPricesOpen(event.currentTarget.open)}>
        <summary>{t('body3d.prices.title')}</summary>
        <p>{t('body3d.prices.note')}</p>
        {pricesOpen && <BookingPrices key={locale} locale={locale} />}
      </details>
    </aside>
  );
}
