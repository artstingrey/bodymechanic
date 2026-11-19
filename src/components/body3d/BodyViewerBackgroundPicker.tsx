import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';

function normalizeHex(value: string) {
  const hex = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex.replace(/./g, (digit) => digit + digit)}`;
  return null;
}

export function BodyViewerBackgroundPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const t = useTranslations('body3d.viewer.background');
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(color.toUpperCase());
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  const commit = () => {
    const value = normalizeHex(hex);
    setInvalid(!value);
    if (!value) return;
    setHex(value.toUpperCase());
    onChange(value);
  };

  return (
    <div className="body-viewer__background-picker" onKeyDown={(event) => {
      if (!open || event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} type="button" className="body-viewer__background-toggle" aria-label={t('label')}
        title={t('label')} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </button>
      <div id={id} className="body-viewer__background-panel" role="group" aria-label={t('label')} hidden={!open}>
        <label>
          <span>{t('pick')}</span>
          <input type="color" value={color} onChange={(event) => {
            const value = event.currentTarget.value;
            setHex(value.toUpperCase());
            setInvalid(false);
            onChange(value);
          }} />
        </label>
        <label>
          <span>{t('hex')}</span>
          <input type="text" value={hex} autoComplete="off" spellCheck={false}
            aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setHex(value);
              setInvalid(false);
              const valid = normalizeHex(value);
              if (valid && value.trim().replace(/^#/, '').length === 6) onChange(valid);
            }}
            onBlur={commit} onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commit();
            }} />
        </label>
        {invalid && <p id={`${id}-error`} role="alert">{t('invalid')}</p>}
      </div>
    </div>
  );
}
