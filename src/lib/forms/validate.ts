/**
 * Form validation (R-CODE-02 F-05, A11Y-05): the same rules for the home form «Начните с себя», booking step 5 and the
 * «Мои записи» login. Forms are noValidate; these rules give a code → message forms.error.<code> (deck), shown in the field
 * (Field / Checkbox error → aria-invalid + aria-describedby + text) and in the summary (components/forms/ErrorSummary).
 */
export type ErrorCode =
  | 'required' | 'nameShort' | 'phoneInvalid' | 'emailInvalid' | 'ageInvalid' | 'ageRange'
  | 'consentRequired' | 'healthRequired' | 'serviceRequired' | 'datetimeRequired';

/** Technical bounds of the age field. TODO(content): forms.todo.ageBounds — the client's age policy (minors). */
export const AGE_BOUNDS = { min: 1, max: 120 };

/** «+971 50 123-45-67» → «+971501234567» (E.164 as the BFF expects it, ТЗ §08). */
export const normalizePhone = (v: string) => v.replace(/[\s\-().]/g, '');
/** E.164; UAE numbers (+971) need their 8–9 national digits (mobile 9, landline 8) — «+971 12345» is not a number yet. */
export const isE164 = (v: string) => {
  const n = normalizePhone(v);
  return /^\+971/.test(n) ? /^\+971\d{8,9}$/.test(n) : /^\+[1-9]\d{7,14}$/.test(n);
};

export const rules = {
  name: (v: string): ErrorCode | null => (!v.trim() ? 'required' : v.trim().length < 2 ? 'nameShort' : null),
  phone: (v: string): ErrorCode | null => {
    const n = normalizePhone(v);
    if (!n) return 'required';
    return isE164(n) ? null : 'phoneInvalid';
  },
  email: (v: string | undefined): ErrorCode | null => (!v?.trim() ? null : /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v.trim()) ? null : 'emailInvalid'),
  /** optional; `badInput` = the number field holds text the browser could not parse */
  age: (v: string | number | undefined, badInput = false): ErrorCode | null => {
    if (badInput) return 'ageInvalid';
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (!/^\d{1,3}$/.test(s)) return 'ageInvalid';
    const n = Number(s);
    return n < AGE_BOUNDS.min || n > AGE_BOUNDS.max ? 'ageRange' : null;
  },
  filled: (v: unknown, code: ErrorCode = 'required'): ErrorCode | null => (v === undefined || v === null || v === '' || v === false ? code : null),
};

export function requiredEmail(value: string | undefined): ErrorCode | null {
  return value?.trim() ? rules.email(value) : 'required';
}

/** forms.error.<code> with its values (ageRange needs min / max). */
export const messageArgs = (code: ErrorCode) => (code === 'ageRange' ? AGE_BOUNDS : undefined);

/** Ordered field id → error code (the order of the form): null / undefined values are dropped. */
export function collect(entries: [string, ErrorCode | null | undefined][]): Record<string, ErrorCode> {
  return Object.fromEntries(entries.filter((e): e is [string, ErrorCode] => !!e[1]));
}
