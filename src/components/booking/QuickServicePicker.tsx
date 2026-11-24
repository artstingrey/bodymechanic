'use client';

import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/Choice';
import { Icon } from '@/components/ui/Icon';

export function QuickServicePicker({ services, selected, label, placeholder, disabled, error, description, onChange }: {
  services: { id: number; title: string }[];
  selected: number[];
  label: string;
  placeholder: string;
  disabled: boolean;
  error?: string;
  description: string;
  onChange: (id: number, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const expanded = open && !disabled;
  const title = services.filter(({ id }) => selected.includes(id)).map(({ title }) => title).join(' · ');

  useEffect(() => {
    if (!expanded) return;
    let tabFrame = 0;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        cancelAnimationFrame(tabFrame);
        tabFrame = requestAnimationFrame(() => {
          // WebKit can move focus outside the picker while a checkbox is being clicked.
          if (!root.current?.contains(document.activeElement)) setOpen(false);
        });
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', handleKeys);
    return () => {
      cancelAnimationFrame(tabFrame);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', handleKeys);
    };
  }, [expanded]);

  return (
    <div className="field" ref={root}>
      <label htmlFor="qf-service" id="qf-service-label">{label}<span className="req" aria-hidden="true"> *</span></label>
      <div className="qform__services">
        <button className="input input--select qform__services-trigger" ref={trigger} id="qf-service" type="button"
          disabled={disabled} aria-expanded={expanded} aria-controls="qf-service-options"
          aria-labelledby="qf-service-label qf-service-value" aria-describedby={description}
          data-invalid={!!error || undefined} onClick={(event) => {
            event.currentTarget.focus();
            setOpen((value) => !value);
          }}>
          <span id="qf-service-value">{title || placeholder}</span><Icon name="chevron-down" />
        </button>
        <div className="qform__services-options" id="qf-service-options" role="group" aria-labelledby="qf-service-label" hidden={!expanded}>
          {services.map(({ id, title }) => <Checkbox key={id} value={id} checked={selected.includes(id)}
            onChange={(event) => onChange(id, event.target.checked)}>{title}</Checkbox>)}
        </div>
      </div>
      {selected.map((id) => <input key={id} type="hidden" name="service" value={id} />)}
      <input type="hidden" name="serviceTitle" value={title} />
      {error && <p className="err" id="qf-service-err"><Icon name="alert" />{error}</p>}
    </div>
  );
}
