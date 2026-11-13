/**
 * «В календарь» on the confirmation (ТЗ §07 step 7): an .ics file built in the browser and a Google Calendar template link.
 * Times are absolute (UTC), so the event lands at the right Dubai time in any calendar.
 */
export interface CalEvent { title: string; start: string; durationMin: number; details: string; location: string }

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261110T070000Z
// RFC 5545 TEXT: a carriage return (alone or in CRLF) is a line break too — left raw it would start a new content line, i.e.
// let a value add its own properties to the file (security review З-7; matters once server data goes in)
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function icsText(e: CalEvent, uid: string): string {
  const start = new Date(e.start), end = new Date(start.getTime() + e.durationMin * 60_000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Body Mechanic//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`,
    `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.details)}`, `LOCATION:${esc(e.location)}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function downloadIcs(e: CalEvent, uid: string, filename = 'bodymechanic-booking.ics') {
  const url = URL.createObjectURL(new Blob([icsText(e, uid)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Google Calendar's «new event» page without any data: the `href` of the link (components/ui/PrefilledLink, В-4). */
export const GOOGLE_CALENDAR_BASE = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

/** The complete address — title, record number and zones in it. Built at the click only, never rendered into the page. */
export function googleCalendarUrl(e: CalEvent): string {
  const start = new Date(e.start), end = new Date(start.getTime() + e.durationMin * 60_000);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${utc(start)}/${utc(end)}`, details: e.details, location: e.location, ctz: 'Asia/Dubai' });
  return `https://calendar.google.com/calendar/render?${q}`;
}
