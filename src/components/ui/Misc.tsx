import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon, type IconName } from './Icon';

type Href = Parameters<typeof Link>[0]['href'];

/** Accordion item (FAQ): native <details>, works without JS; the panel fades in, height is never animated (README п.15). */
export function AccordionItem({ q, children, open }: { q: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="acc" open={open}>
      <summary>{q}<Icon name="chevron-down" /></summary>
      <div className="panel">{children}</div>
    </details>
  );
}

/** Breadcrumbs: links + current page (aria-current). */
export function Breadcrumbs({ label, items }: { label: string; items: { href?: Href; label: string }[] }) {
  return (
    <nav className="crumbs" aria-label={label}>
      <ol>
        {items.map((it, i) => (
          <li key={i} style={{ display: 'contents' }}>
            {i > 0 ? <span className="sep" aria-hidden="true">/</span> : null}
            {it.href && i < items.length - 1 ? <Link href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Empty / error state card. Error = icon + text (never colour alone) + a way out (retry / other action). */
export function StateCard({ kind = 'empty', icon, text, action }: { kind?: 'empty' | 'error'; icon?: IconName; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="state" data-kind={kind} role={kind === 'error' ? 'alert' : undefined}>
      <span className="ic" aria-hidden="true"><Icon name={icon ?? (kind === 'error' ? 'alert' : 'calendar')} /></span>
      <p>{text}</p>
      {action}
    </div>
  );
}

/** 3D loader with real progress (tabular %, bar scaleX — no width animation). */
export function Loader3D({ percent, label, slowNote }: { percent: number; label: string; slowNote?: ReactNode }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="loader3d" role="status">
      <span className="pct" aria-hidden="true">{p}%</span>
      <span className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${p / 100})` }} /></span>
      <span className="cap">{label}</span>
      {slowNote ? <span className="cap">{slowNote}</span> : null}
    </div>
  );
}

/** Stepper: 7 steps on desktop (done / current / upcoming), «Шаг N из 7» + progress on phones. */
/**
 * Booking stepper. `done[i]` says whether step i is really filled (R-CODE-03: a deep link to ?step=4 without a service
 * must not show steps 1–3 as completed). Earlier steps stay links either way; unfilled ones look «open», not ticked.
 */
export function Stepper({ steps, current, label, mobileLabel, hrefFor, done }: {
  steps: string[]; current: number; label: string; mobileLabel: string; hrefFor?: (i: number) => Href; done?: boolean[];
}) {
  return (
    <nav aria-label={label}>
      <ol className="steps">
        {steps.map((s, i) => {
          const state = i === current ? 'current' : i < current ? (done?.[i] ?? true ? 'done' : 'open') : 'next';
          const inner = <><i>{i + 1}</i>{s}</>;
          return (
            <li key={s}>
              {(state === 'done' || state === 'open') && hrefFor
                ? <Link className="s" data-state={state} href={hrefFor(i)} prefetch={false}>{inner}</Link>
                : <span className="s" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>{inner}</span>}
            </li>
          );
        })}
      </ol>
      <div className="mstep">
        <span><b>{mobileLabel}</b><span className="mstep__name"> · {steps[current]}</span></span>
        <span className="prog" aria-hidden="true"><i style={{ transform: `scaleX(${(current + 1) / steps.length})` }} /></span>
      </div>
    </nav>
  );
}

/** Toast with «Вернуть» (undo). Lives 6 s; politely announced. */
export function Toast({ text, actionLabel, onAction }: { text: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <span style={{ flex: 1 }}>{text}</span>
      <button type="button" className="btn btn--text" onClick={onAction}><Icon name="undo" />{actionLabel}</button>
    </div>
  );
}
