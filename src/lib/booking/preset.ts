/**
 * A choice carried INTO the booking (ТЗ §07: service page → its service; specialist page → the specialist; one of his
 * free windows → the specialist, the day and the time; «Записаться снова» → both). RC-10, security review Ж-9: the choice
 * does not travel in the address. Ad tags send the page address by themselves — Meta's pixel, Google's tag and GA4 on
 * every history change too, past the triggers of the container — so /booking/?service=101 reached them, although the
 * service number is meant for GA4 only.
 *   - a link INSIDE the site (components/booking/BookingLink) hands the choice over at the click: the tab's sessionStorage
 *     (survives the full page load out of the account) and the document's memory (storage switched off). Its href is the
 *     bare /booking/;
 *   - a link from OUTSIDE (/booking/?service=…&staff=…&date=…&time=… — ТЗ §07, the address JSON-LD names) still works:
 *     the parameters are moved into the same hand-over and leave the address at once. Three places do this one step, in
 *     the order they can run: the inline script of the booking page (ABSORB_PRESET_INLINE: while the HTML is parsed —
 *     before the router reads the address and long before a tag exists), the booking flow, and the container loader
 *     right before it inserts the container (lib/analytics/gtm). Whichever comes first does it, the others find nothing:
 *     «address clean → container» is kept by code, not by the shape of the component tree;
 *   - the booking takes the hand-over ONCE (`takePreset`): read, removed, and older than a minute it is ignored — a click
 *     that did not end in the booking must not surface at the next direct visit.
 * Only service, staff, date and time leave the address: the step, UTM tags, click ids and the hash stay where they are.
 * Numbers, a day and a time: nothing about wellbeing passes here.
 */
export interface BookingPreset { service?: number; staff?: number; date?: string; time?: string; staffProfile?: true }
/** what the booking takes: the preset and/or the word that the entry it replaces was opened with a service of its own */
export type HandOver = BookingPreset & { own?: boolean };

export const PRESET_KEY = 'bm.bookingPreset';
export const PRESET_PARAMS = ['service', 'staff', 'date', 'time'] as const;
/**
 * The hand-over of a CLICK belongs to the navigation that follows it, not to a later visit: a minute. A hand-over made by
 * the document that will also take it (the address of a link from outside, moved while the page loads) has no limit —
 * on a slow network the page may come alive later than that, and the choice must not be lost silently. `doc` names the
 * document: performance.timeOrigin, the same number for the inline script and for the modules of one page load.
 */
const FRESH_MS = 60_000;
const thisDocument = (): number => (typeof performance !== 'undefined' ? performance.timeOrigin : 0);

/** the copy for a client-side navigation when the storage is switched off */
let handed: unknown = null;

function hand(values: Record<string, unknown>, sameDocument = false): void {
  const rec = { ...values, at: Date.now(), ...(sameDocument ? { doc: thisDocument() } : {}) };
  handed = rec;
  try { sessionStorage.setItem(PRESET_KEY, JSON.stringify(rec)); } catch { /* storage off: the memory copy serves this document */ }
}

/** values as a link or an address gave them → a hand-over of known shape, or null */
function clean(v: unknown): HandOver | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const id = (x: unknown) => {
    const n = typeof x === 'number' ? x : typeof x === 'string' && /^\d{1,9}$/.test(x) ? Number(x) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const service = id(r.service);
  const staff = id(r.staff);
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined;
  const time = typeof r.time === 'string' && /^\d{2}:\d{2}$/.test(r.time) ? r.time : undefined;
  const p: HandOver = {
    ...(service ? { service } : {}), ...(staff ? { staff } : {}), ...(date ? { date } : {}), ...(time ? { time } : {}),
    ...(staff && r.staffProfile === true ? { staffProfile: true as const } : {}),
    ...(r.own === 1 ? { own: true } : {}),
  };
  return Object.keys(p).length ? p : null;
}

/** A link of the site, at the click that navigates in this tab. */
export function handPreset(p: BookingPreset): void {
  hand({ ...p });
}

/** The booking, once per visit: the hand-over is removed as it is read. */
export function takePreset(): HandOver | null {
  let v: unknown = handed;
  handed = null;
  try {
    const raw = sessionStorage.getItem(PRESET_KEY);
    if (raw !== null) {
      sessionStorage.removeItem(PRESET_KEY);
      if (v === null) v = JSON.parse(raw);
    }
  } catch { /* storage off or a broken value: the memory copy, if there is one */ }
  if (!v || typeof v !== 'object') return null;
  const { at, doc } = v as { at?: unknown; doc?: unknown };
  const age = Date.now() - Number(at);
  return (doc !== undefined && doc === thisDocument()) || (age >= 0 && age < FRESH_MS) ? clean(v) : null;
}

/**
 * An address that carries a choice → the hand-over FIRST, then the address is left without it. Repeatable: a second call
 * finds nothing to move. The history entry keeps its state object, so the router takes the entry for its own and does
 * not navigate (the booking flow tells the router the new address when it has to). `router.replace` is not an option:
 * it is asynchronous, a container would see the old address.
 * @param onBookingAddressOnly for a caller that runs on every page (the container loader): other pages are left alone
 */
export function absorbPresetFromUrl(onBookingAddressOnly = false): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    if (!PRESET_PARAMS.some((k) => q.has(k))) return;
    if (onBookingAddressOnly && !/\/booking\/?$/.test(url.pathname)) return;
    const values: Record<string, string> = {};
    for (const k of PRESET_PARAMS) {
      const v = q.get(k);
      if (v !== null) values[k] = v;
      q.delete(k);
    }
    hand(values, true);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* an address the URL parser refuses, or a sandboxed history: left as it is */ }
}

/**
 * Was this history entry opened with a service of its own? `now` — the visit has just brought one. It used to be told by
 * ?service= in the address, which stayed there through F5; the address no longer says so, and F5 must not start offering
 * the choice as «a draft found». The entry therefore keeps a flag — a flag only, no numbers. The state object is passed
 * on whole, so the router takes the entry for its own and does not navigate.
 */
export function entryBroughtService(now: boolean): boolean {
  try {
    const entry = window.history.state as { bmPreset?: number } | null;
    if (entry?.bmPreset) return true;
    if (now) window.history.replaceState({ ...(entry ?? {}), bmPreset: 1 }, '');
  } catch { /* a sandboxed history: the answer for this load is still right */ }
  return now;
}

/**
 * The language switch opens the same page as a new history entry (a full page load; ?service= used to travel with it):
 * the flag of this entry goes along — the word «own», no numbers; the choice itself is already in the tab's storage.
 */
export function carryEntryFlag(): void {
  try {
    if ((window.history.state as { bmPreset?: number } | null)?.bmPreset) hand({ own: 1 });
  } catch { /* a sandboxed history: the other language offers the choice as a draft, nothing is lost */ }
}

/**
 * The same step as an inline script of the booking page: it runs while the HTML is parsed — before the router reads the
 * address (so the router never holds the parameters) and before any tag can be inserted. When the storage refuses the
 * value nothing is removed here: the booking flow does it with the memory copy.
 * No parameters in the address, but a fresh hand-over of a click waiting (a full page load: «Записаться снова» out of the
 * account)? It is marked as this document's: its minute has covered the way over the network, not the time the page
 * needs to come alive.
 */
export const ABSORB_PRESET_INLINE =
  "(function(){try{var K='bm.bookingPreset',D=performance.timeOrigin,u=new URL(location.href),q=u.searchParams,k=['service','staff','date','time'],o={},n=0,i,r;"
  + "for(i=0;i<k.length;i++)if(q.has(k[i])){o[k[i]]=q.get(k[i]);q.delete(k[i]);n++}"
  + "if(!n){r=JSON.parse(sessionStorage.getItem(K)||'null');if(r&&r.doc===undefined&&Date.now()-r.at>=0&&Date.now()-r.at<60000){r.doc=D;sessionStorage.setItem(K,JSON.stringify(r))}return}"
  + "o.at=Date.now();o.doc=D;sessionStorage.setItem(K,JSON.stringify(o));"
  + "history.replaceState(history.state,'',u.pathname+u.search+u.hash)}catch(e){}})();";
