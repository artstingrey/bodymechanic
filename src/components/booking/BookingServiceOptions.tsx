'use client';

import { Badge } from '@/components/ui/Badge';

export function BookingServiceOptions({ name, services, selected, recommended, suggestedLabel, onSelect }: {
  name: string;
  services: { id: number; title: string; categoryTitle?: string; price: string; duration: string | null }[];
  selected: number | null;
  recommended?: number;
  suggestedLabel?: string;
  onSelect: (id: number) => void;
}) {
  return (
    <ul className="bk-list">
      {services.map((service) => (
        <li key={service.id}>
          <label className="rcard bk-opt">
            <input type="radio" name={name} value={service.id} checked={selected === service.id} onChange={() => onSelect(service.id)} />
            <span className="dot" aria-hidden="true" />
            <span className="bk-opt__body">
              <b>{service.title}</b>
              {service.categoryTitle && <span>{service.categoryTitle}</span>}
              {recommended === service.id && <Badge tone="accent">{suggestedLabel}</Badge>}
            </span>
            <span className="bk-opt__meta tn"><b>{service.price}</b>{service.duration && <span>{service.duration}</span>}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
