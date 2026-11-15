import 'server-only';

const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function localBookingOrigin(host: string | null, protocol = 'http:') {
  if (process.env.NODE_ENV !== 'development' || process.env.BOOKING_QUICK_FORM_ENABLED === 'false' ||
    !host || !loopbackHost.test(host) || (protocol !== 'http:' && protocol !== 'https:')) return undefined;
  const url = `${protocol}//${host}`;
  return URL.canParse(url) ? new URL(url).origin : undefined;
}
