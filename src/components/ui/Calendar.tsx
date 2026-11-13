'use client';
/**
 * 30-day calendar (ui-kit «Календарь», R-HIFI-01): one grid for the whole window (no month paging), weekday header,
 * the first day of a new month carries the month name. Every day of the window is a button (the gate counts 30):
 * unavailable days stay in place with aria-disabled (hatched); every button has an aria-label with the full date
 * (+ «Нет свободного времени»). Header cells and leading pads are not interactive. Days are Dubai calendar days
 * («YYYY-MM-DD», formatted in UTC so the visitor's time zone never shifts them).
 */
import { useLocale } from 'next-intl';

const at = (s: string) => new Date(`${s}T12:00:00Z`);

export function Calendar({ days, available, selected, onSelect, unavailableLabel, label, className }: {
  days: string[]; available: Set<string>; selected: string | null; onSelect: (d: string) => void; unavailableLabel: string; label: string; className?: string;
}) {
  const locale = useLocale();
  if (!days.length) return null;
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' });
  const wd = fmt({ weekday: 'short' }), mon = fmt({ month: 'long' }), monShort = fmt({ month: 'short' }), full = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const first = at(days[0]), last = at(days[days.length - 1]);
  const pads = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const title = cap(mon.format(first)) + (last.getUTCMonth() !== first.getUTCMonth() ? ` — ${mon.format(last)}` : '') + ` ${last.getUTCFullYear()}`;
  return (
    <div className="calendar">
      <p className="calendar__title"><b>{title}</b></p>
      <div className={['cal', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
        {Array.from({ length: 7 }, (_, i) => <span key={`w${i}`} className="wd" aria-hidden="true">{wd.format(new Date(Date.UTC(2024, 0, 1 + i))).replace('.', '')}</span>)}
        {Array.from({ length: pads }, (_, i) => <span key={`p${i}`} className="pad" aria-hidden="true" />)}
        {days.map((key, i) => {
          const d = at(key);
          const on = available.has(key);
          return (
            <button key={key} type="button" aria-label={full.format(d) + (on ? '' : `, ${unavailableLabel}`)} aria-disabled={!on || undefined}
              aria-pressed={selected === key} data-available={on || undefined} data-today={i === 0 || undefined} onClick={() => { if (on) onSelect(key); }}>
              {d.getUTCDate() === 1 && i > 0 ? <small>{monShort.format(d).replace('.', '')}</small> : null}
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Static skeleton of the calendar + slots (README п.15: no shimmer loop): the same grid geometry as <Calendar>, so the
 * step keeps its shape while the dates load or before a service is chosen. Decorative — aria-hidden; the state is
 * announced by the caller (role=status / a state card).
 */
export function TimeSkeleton({ cells = 30 }: { cells?: number }) {
  return (
    <div className="bk-time bk-time--skel" aria-hidden="true">
      <div className="calendar">
        <span className="skel skel--title" />
        <div className="cal">
          {Array.from({ length: 7 }, (_, i) => <span key={`w${i}`} className="skel skel--wd" />)}
          {Array.from({ length: cells }, (_, i) => <span key={i} className="skel skel--day" />)}
        </div>
      </div>
      <div className="bk-slots">
        {[4, 6, 3].map((n, g) => (
          <div key={g} className="slots-part">
            <span className="skel skel--h" />
            <div className="slots">{Array.from({ length: n }, (_, i) => <span key={i} className="skel skel--slot" />)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Slots grouped by part of day (morning < 12:00 ≤ day < 17:00 ≤ evening); each group has a heading (h2). */
export function SlotPicker({ slots, selected, onSelect, labels }: {
  slots: { datetime: string; time: string }[]; selected: string | null; onSelect: (iso: string) => void; labels: { morning: string; day: string; evening: string };
}) {
  const groups = { morning: [] as typeof slots, day: [] as typeof slots, evening: [] as typeof slots };
  for (const s of slots) { const h = Number(s.time.slice(0, 2)); groups[h < 12 ? 'morning' : h < 17 ? 'day' : 'evening'].push(s); }
  return (
    <>
      {(Object.keys(groups) as (keyof typeof groups)[]).filter((k) => groups[k].length).map((k) => (
        <div key={k} className="slots-part" role="group" aria-label={labels[k]}>
          <h2 className="slots-h">{labels[k]}</h2>
          <div className="slots">
            {groups[k].map((s) => <button key={s.datetime} type="button" className="slot" aria-pressed={selected === s.datetime} onClick={() => onSelect(s.datetime)}>{s.time}</button>)}
          </div>
        </div>
      ))}
    </>
  );
}
