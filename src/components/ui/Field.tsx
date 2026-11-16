'use client';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Icon } from './Icon';

type Meta = { label: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode; className?: string; hideLabel?: boolean };

/** Label + control + hint/error, wired with aria-describedby. Error is always icon + text (never colour alone). */
function Shell({ id, label, required, hint, error, className, extra, children, hideLabel }: Meta & { id: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>{label}{required ? <span className="req" aria-hidden="true"> *</span> : null}</label>
      {children}
      {extra}
      {error ? <p className="err" id={`${id}-err`}><Icon name="alert" />{error}</p> : hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}
const described = (id: string, m: Meta, more?: string) => [m.error ? `${id}-err` : m.hint ? `${id}-hint` : null, more].filter(Boolean).join(' ') || undefined;

export function TextField({ label, required, hint, error, className, id: idProp, ...input }: Meta & Omit<ComponentProps<'input'>, 'className'>) {
  const auto = useId(); const id = idProp ?? auto; const m = { label, required, hint, error };
  return (
    <Shell id={id} {...m} className={className}>
      <div className="input" data-invalid={error ? true : undefined}>
        <input id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={described(id, m)} {...input} />
      </div>
    </Shell>
  );
}

export function PhoneField({ label, required, hint, error, className, id: idProp, ...input }:
  Meta & Omit<ComponentProps<'input'>, 'className' | 'type'>) {
  const auto = useId(); const id = idProp ?? auto; const m = { label, required, hint, error };
  return (
    <Shell id={id} {...m} className={className}>
      <div className="input" data-invalid={error ? true : undefined}>
        <input id={id} type="tel" inputMode="tel" autoComplete="tel" required={required} aria-invalid={error ? true : undefined} aria-describedby={described(id, m)}
          {...input} />
      </div>
    </Shell>
  );
}

/** Select: native <select> (OS picker on phones, full keyboard support) in the kit field shell. */
export function SelectField({ label, required, hint, error, className, hideLabel, id: idProp, children, ...select }: Meta & Omit<ComponentProps<'select'>, 'className'>) {
  const auto = useId(); const id = idProp ?? auto; const m = { label, required, hint, error };
  return (
    <Shell id={id} {...m} className={className} hideLabel={hideLabel}>
      <div className="input input--select" data-invalid={error ? true : undefined}>
        <select id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={described(id, m)} {...select}>{children}</select>
        <Icon name="chevron-down" />
      </div>
    </Shell>
  );
}

/** Textarea with a live counter «N из 1000» (counter text comes from the deck via `counterText`). */
export function TextAreaField({ label, required, hint, error, className, id: idProp, maxLength = 1000, counterText, onChange, ...area }:
  Meta & { counterText: (n: number, max: number) => string } & Omit<ComponentProps<'textarea'>, 'className'>) {
  const auto = useId(); const id = idProp ?? auto; const m = { label, required, hint, error };
  const initial = String(area.value ?? area.defaultValue ?? '').length;
  const [n, setN] = useState(initial);
  const count = area.value !== undefined ? String(area.value).length : n;
  return (
    <Shell id={id} {...m} className={className}
      extra={<p className="counter" id={`${id}-count`} data-limit={count >= maxLength || undefined} aria-live="polite">{counterText(count, maxLength)}</p>}>
      <div className="input input--area" data-invalid={error ? true : undefined}>
        <textarea id={id} required={required} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={described(id, m, `${id}-count`)}
          onChange={(e) => { setN(e.currentTarget.value.length); onChange?.(e); }} {...area} />
      </div>
    </Shell>
  );
}
