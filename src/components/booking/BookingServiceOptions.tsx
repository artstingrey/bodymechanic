'use client';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';

export function BookingServiceOptions({ name, services, selected, recommended, suggestedLabel, onSelect }: {
  name: string;
  services: { id: number; title: string; categoryTitle?: string; price: string; originalPrice?: string; duration: string | null }[];
  selected: readonly number[];
  recommended?: readonly number[];
  suggestedLabel?: string;
  onSelect: (id: number, checked: boolean) => void;
}) {
  return (
    <ul className="bk-list">
      {services.map((service) => (
        <li key={service.id}>
          <label className="rcard bk-opt">
            <input type="checkbox" name={name} value={service.id} checked={selected.includes(service.id)}
              onChange={(event) => onSelect(service.id, event.target.checked)} />
            <span className="bk-opt__check" aria-hidden="true"><Icon name="check" /></span>
            <span className="bk-opt__body">
              <b>{service.title}</b>
              {service.categoryTitle && <span>{service.categoryTitle}</span>}
              {recommended?.includes(service.id) && <Badge tone="accent">{suggestedLabel}</Badge>}
            </span>
            <span className="bk-opt__meta tn"><b>{service.price}</b>{service.originalPrice && <s>{service.originalPrice}</s>}
              {service.duration && <span>{service.duration}</span>}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
