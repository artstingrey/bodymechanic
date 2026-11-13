/** Today's date in Asia/Dubai as YYYY-MM-DD (ТЗ §07: время всегда в поясе Дубая). No mock data here — safe for the first screen. */
export function dubaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
