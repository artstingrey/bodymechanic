/** Keep the 30-day grid, including any later days offered by the branch. */
export function bookingCalendarDays(today: string, available: string[]) {
  const first = Date.parse(today);
  const dayMs = 86_400_000;
  const last = Math.max(first + 29 * dayMs, ...available.map((date) => Date.parse(date)));
  return Array.from({ length: (last - first) / dayMs + 1 }, (_, index) =>
    new Date(first + index * dayMs).toISOString().slice(0, 10));
}
