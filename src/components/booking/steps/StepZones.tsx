'use client';
/** Step 1 «Зоны» (ТЗ §07): 3D (persistent canvas) + marker list + zone list alternative; restored draft offer (N-04). */
import { Body3DSlot } from '@/components/body3d/Body3DSlot';
import { LeftPanel, MarkerList, Toolbar } from '@/components/body3d/ZonesPanel';
import { ZoneChecklist } from '@/components/body3d/ZoneChecklist';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useBackCloses } from '@/lib/ui/useBackCloses';
import type { Flow } from '../useBookingFlow';
import { zoneLabel } from '@/lib/body3d/zones';

export function StepZones({ flow }: { flow: Flow }) {
  const { t, services, markers, canLeaveZones, go, offerRestore, continueDraft, discardDraft } = flow;
  // < 1024 (ТЗ 6.9 / §12): «Помощь / Противопоказания / Цены» open from «?» in a modal bottom sheet (native dialog: focus
  // trap, Esc, focus back on «?»); the panel is rendered only while open
  const help = useRef<HTMLDialogElement>(null);
  const helpBtn = useRef<HTMLButtonElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  useBackCloses(helpOpen, () => help.current?.close()); // Android «Back» closes the help sheet (Frontend Builder)
  useEffect(() => {
    const d = help.current; if (!d) return;
    const onClose = () => { setHelpOpen(false); helpBtn.current?.focus(); };
    d.addEventListener('close', onClose); return () => d.removeEventListener('close', onClose);
  }, []);
  // R-FINAL-2 F2-01: the peek names the latest marker («Маркер 2 · Грудной отдел»); the sheet no longer opens by itself
  const last = markers.reduce<(typeof markers)[number] | null>((a, m) => (!a || m.n > a.n ? m : a), null);
  // phones: the toolbar is one scrolling row — fade the edge that still has buttons behind it (lead, F2-01 follow-up)
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.booking-3d__model .b3d-toolbar'); if (!bar) return;
    const update = () => {
      const more = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 4, less = bar.scrollLeft > 4;
      if (more || less) bar.dataset.fade = more && less ? 'both' : more ? 'end' : 'start'; else delete bar.dataset.fade;
    };
    update();
    bar.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update); ro.observe(bar);
    return () => { bar.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  const count = last ? t('body3d.panel.markerTitle', { n: last.n, zone: zoneLabel(t, last.zoneId) }) : t('body3d.sheet.countZero');
  // RC-6 (lead + AD): the restored-draft offer sits in «Запись», where the count line is — the peek row of the sheet on
  // phones (the two actions, 44 px, the row's height unchanged), the card's line under «Запись» on wider screens / short
  // landscape. It used to be above the model: it appears after the hydration (the draft is in sessionStorage) and pushed
  // the 3D slot 119–154 px down. One region per layout (the other one is display: none), labelled by its title.
  const restore = (peek: boolean) => offerRestore ? (
    <div className={`booking-restore${peek ? ' booking-restore--peek' : ''}`} role="region" aria-label={t('booking.draft.restoreTitle')}>
      {peek ? <p className="sr-only">{t('booking.draft.restoreText')}</p> : (<>
        <span className="booking-restore__ic" aria-hidden="true"><Icon name="undo" /></span>
        <div>
          <p><b>{t('booking.draft.restoreTitle')}</b></p>
          <p>{t('booking.draft.restoreText')}</p>
        </div>
      </>)}
      {/* the sheet's head is its drag handle: a press on an action must not start a drag */}
      <div className="booking-restore__acts" onPointerDown={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={continueDraft}>{t('booking.draft.continue')}</Button>
        <Button size="sm" variant="secondary" onClick={discardDraft}>{t('booking.draft.startOver')}</Button>
      </div>
    </div>
  ) : null;
  return (
    <section aria-labelledby="st1" className="bk-step bk-step--zones">
      <div className="booking-3d">
        {/* left column ≥1024 (ТЗ §12, style frame A): heading, restored-draft offer, help accordions; on phones its children
            join the workspace grid (display: contents) — heading first, the model next, help last */}
        <div className="booking-3d__left">
          <div className="bk-head">
            {/* phones: «Шаг 1 из 7» and the H1 share one row above the model (the stepper nav is visually hidden there) */}
            <span className="bk-head__step" aria-hidden="true">{t('booking.stepper.progress', { current: 1, total: 7 })}</span>
            <h1 id="st1" tabIndex={-1} className="h2">{t('booking.zones.heading')}</h1>
          </div>
          <a href="#zone-list" className="skip-link-inline">{t('body3d.list.skip')}</a>
          <LeftPanel prices={services} />
        </div>
        {/* 3D-17 / R-3D-01 F-06: the accessible alternative is one step away from the canvas */}
        <div className="booking-3d__model">
          <Toolbar />
          <Body3DSlot mode="booking" />
          <button ref={helpBtn} type="button" className="b3d-help-btn" aria-haspopup="dialog" aria-label={t('body3d.helpButtonAria')}
            onClick={() => { setHelpOpen(true); help.current?.showModal(); }}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
          </button>
          <a href="#zone-list" className="b3d-list-link" title={t('body3d.list.link')}><Icon name="list" /><span className="b3d-list-link__t">{t('body3d.list.link')}</span></a>
        </div>
        {/* right column ≥768; on phones the sheet and the CTA bar are fixed to the bottom (display: contents) */}
        <div className="booking-3d__right">
          <BottomSheet className="booking-3d__side" label={t('body3d.sheet.title')} swipeHint={t('body3d.sheet.swipeHint')}
            head={offerRestore ? restore(true) : <p className="bsheet__title"><b>{t('body3d.sheet.title')}</b><span aria-live="polite">{count}</span></p>}>
            <MarkerList countSlot={restore(false) ?? undefined} />
          </BottomSheet>
          <div className="bk-cta">
            {!canLeaveZones ? <p className="hint" id="bk-gate-hint">{t('body3d.panel.gateHint')}</p> : null}
            <Button full disabled={!canLeaveZones} aria-describedby={!canLeaveZones ? 'bk-gate-hint' : undefined} onClick={() => go(2)}>{t('body3d.panel.cta')}</Button>
            <Button variant="text" onClick={() => go(2)}>{t('body3d.panel.skip')}</Button>
          </div>
        </div>
      </div>
      <dialog ref={help} className="sheet-dialog" aria-label={t('body3d.help.title')}
        onClick={(e) => { if (e.target === e.currentTarget) help.current?.close(); }}>
        <div className="sheet-dialog__in">
          <div className="sheet-dialog__top"><span className="grab" aria-hidden="true" />
            <button type="button" className="iconbtn" aria-label={t('common.actions.close')} onClick={() => help.current?.close()}>
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button></div>
          {helpOpen ? <LeftPanel prices={services} /> : null}
        </div>
      </dialog>
      <ZoneChecklist />
    </section>
  );
}
