'use client';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Segmented control (М/Ж): single choice among 2–4 options, buttons with aria-pressed. */
export function Segmented<T extends string>({ label, options, value, onChange, className }:
  { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={['seg', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Filter chip (toggle). For navigation chips use a Link with className="chip" and aria-current. */
export function Chip({ pressed, children, ...rest }: { pressed: boolean; children: ReactNode } & Omit<ComponentProps<'button'>, 'children'>) {
  return <button type="button" className="chip" aria-pressed={pressed} {...rest}>{children}</button>;
}

/** Switch (cookie categories). role=switch + aria-checked; the visible label is referenced by id. */
export function Switch({ checked, onChange, labelledBy, describedBy, disabled }:
  { checked: boolean; onChange?: (v: boolean) => void; labelledBy: string; describedBy?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-describedby={describedBy}
      disabled={disabled} onClick={() => onChange?.(!checked)} />
  );
}

/**
 * Checkbox: native input (keyboard, forms, autofill) under the drawn box. `error` (R-CODE-02 F-05) = red box + icon and
 * text under the label, tied to the input by aria-describedby; `invalid` alone only marks the box.
 */
export function Checkbox({ children, invalid, error, className, ...input }: { children: ReactNode; invalid?: boolean; error?: ReactNode; className?: string } & Omit<ComponentProps<'input'>, 'type' | 'children' | 'className'>) {
  const errId = `${useId()}-err`;
  const bad = invalid || !!error;
  const describedBy = [input['aria-describedby'], error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <label className={['check', className].filter(Boolean).join(' ')} data-invalid={bad || undefined}>
        <input type="checkbox" {...input} aria-invalid={bad || undefined} aria-describedby={describedBy} />
        <span className="box" aria-hidden="true"><Icon name="check" /></span>
        <span>{children}</span>
      </label>
      {error ? <p className="err check-err" id={errId}><Icon name="alert" />{error}</p> : null}
    </>
  );
}

/** Radio card: native radio stretched over the card (one tab stop per group, arrow keys). */
export function RadioCard({ title, note, className, ...input }: { title: ReactNode; note?: ReactNode; className?: string } & Omit<ComponentProps<'input'>, 'type' | 'className'>) {
  return (
    <label className={['rcard', className].filter(Boolean).join(' ')}>
      <input type="radio" {...input} />
      <span className="dot" aria-hidden="true" />
      <span><b>{title}</b>{note ? <span>{note}</span> : null}</span>
    </label>
  );
}
