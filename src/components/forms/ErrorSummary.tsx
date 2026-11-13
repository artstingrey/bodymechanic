'use client';
/**
 * Error summary of a form (R-CODE-02 F-05): appears after a submit with two or more errors, role="alert" (announced once
 * per attempt — keyed by the attempt), each line links to its field and focuses it. A single error needs no summary: the
 * focus is already on the field and its error text is read with it (aria-describedby). Visual: .form-errors (Web Art Director).
 */
import { useTranslations } from 'next-intl';
import { messageArgs, type ErrorCode } from '@/lib/forms/validate';

export function ErrorSummary({ errors, labels, attempt }: { errors: Record<string, ErrorCode>; labels: Record<string, string>; attempt: number }) {
  const t = useTranslations('forms.error');
  const ids = Object.keys(errors);
  if (!attempt || ids.length < 2) return null;
  return (
    <div key={attempt} className="form-errors" role="alert" tabIndex={-1}>
      <p>{t('summary')}</p>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            <a href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.focus(); }}>
              {labels[id] ? `${labels[id]}: ` : ''}{t(errors[id], messageArgs(errors[id]))}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
