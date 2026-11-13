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

/**
 * Phone: one international field (lead decision, hi-fi): «+971 » is prefilled on focus when empty and removed on blur if untouched;
 * any other country code is typed over it. inputmode=tel, autocomplete=tel. Placeholder from the deck (forms.field.phonePlaceholder).
 */
export function PhoneField({ label, required, hint, error, className, id: idProp, onFocus, onBlur, onChange, onPrefill, defaultPrefix = '+971 ', ...input }:
  Meta & { defaultPrefix?: string; /** controlled fields: called with the prefix on focus and with '' on blur when untouched */ onPrefill?: (v: string) => void } & Omit<ComponentProps<'input'>, 'className' | 'type'>) {
  const auto = useId(); const id = idProp ?? auto; const m = { label, required, hint, error };
  return (
    <Shell id={id} {...m} className={className}>
      <div className="input" data-invalid={error ? true : undefined}>
        <input id={id} type="tel" inputMode="tel" autoComplete="tel" required={required} aria-invalid={error ? true : undefined} aria-describedby={described(id, m)}
          onFocus={(e) => {
            // next frame, and only if still empty: a value that arrives right after the focus (iOS autofill, paste, an
            // instant fill) must win over the prefix (Frontend Builder, WebKit race)
            const el = e.currentTarget;
            requestAnimationFrame(() => { if (!el.value) { if (input.value === undefined) el.value = defaultPrefix; else onPrefill?.(defaultPrefix); } });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            // R-HIFI-01: an untouched prefix is not a value — clear it, so the field shows the placeholder again
            if (e.currentTarget.value.trim() === defaultPrefix.trim()) { if (input.value === undefined) e.currentTarget.value = ''; else onPrefill?.(''); }
            onBlur?.(e);
          }}
          onChange={(e) => {
            // a full number pasted or autofilled after the focus prefix: «+971 +971 50…» → keep the pasted number
            // (Frontend Builder, F-05 tests). Runs before the caller's onChange, so controlled state gets the clean value.
            const v = e.currentTarget.value, plus = v.lastIndexOf('+');
            if (plus > 0 && v.startsWith(defaultPrefix.trim())) e.currentTarget.value = v.slice(plus);
            onChange?.(e);
          }}
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
