/**
 * Pages whose ADDRESS is personal (RC-9, security review S-2): /{locale}/account/… — the record link
 * /account/record/{id}/{hash}/ opens a booking without a login. A tag manager sends the page address (and the previous
 * one as the referrer) to Google and Meta with every hit, so on these pages there is no analytics at all:
 *   - the GTM container is not loaded and nothing is written to dataLayer (lib/analytics/gtm, track);
 *   - an account address never shares a document with a public page: every in-site link that crosses the border, in
 *     either direction, is a full page load (components/layout/PrivateBoundary — one rule for all links; PrivateLink is
 *     its explicit form for the two links that lead in). History entries made by one document stay «same-document»
 *     even after a reload, so a client-side way out (logo → F5 → «Назад») would bring the record address back under a
 *     live container;
 *   - belt and braces: a document that started on such an address has no analytics until the next full page load,
 *     whatever it shows — `startedPrivate`;
 *   - the account pages carry <meta name="referrer" content="no-referrer"> (their generateMetadata), so the address never
 *     reaches the next document as its referrer (the language switch on a record page is a full load).
 * Events of ТЗ §14 that happen in the account (account_login, booking_cancel, booking_reschedule) are therefore not sent.
 */
const PRIVATE_PATH = /^\/(?:ru|en)\/account(?:\/|$)/;

/**
 * The path as a host resolves it: percent-escapes decoded (a broken escape stays as written), «\» read as «/», repeated
 * slashes collapsed, «.» and «..» segments resolved. A browser resolves a written «/../» itself, but not one behind an
 * escaped slash: «/ru/x/..%2Faccount/» arrives as written, the host decodes %2F, climbs a level and serves the account
 * page (seen on the live host, 12.11.2026). The rule follows the forms a static host is known to resolve — these, and
 * «//ru/account/…», «/ru/%61ccount/…»; a host that resolves an address in yet another way needs that way added here.
 * Never throws, whatever the input.
 */
const normalise = (pathname: string): string => {
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch { /* a malformed escape: test the raw path */ }
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue; // repeated slashes and «.» change nothing
    if (seg === '..') out.pop(); // one level up; above the root there is nothing to leave
    else out.push(seg);
  }
  return `/${out.join('/')}`;
};

export const isPrivatePath = (pathname: string): boolean => PRIVATE_PATH.test(normalise(pathname));

/** read once, with the page's own scripts: the address this document was opened with */
const startedPrivate = typeof window !== 'undefined' && isPrivatePath(window.location.pathname);

/** No container, no events: the document started in the account, or the current address is an account one. */
export const analyticsOff = (): boolean =>
  typeof window === 'undefined' || startedPrivate || isPrivatePath(window.location.pathname);
