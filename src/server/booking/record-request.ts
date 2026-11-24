import 'server-only';

import { isIP } from 'node:net';
import { isBookingAttemptKey, type BookingRecord3DDetails, type BookingRecordField, type BookingRecordStatusRequest, type NormalizedBookingRecordRequest } from '@/lib/contracts/booking-record';
import { normalizeBookingServices, validBookingId } from '@/lib/contracts/booking-services';
import { DEFAULT_MARKER_INTENSITY, GENERAL_NOTE_LIMIT, isMarkerIntensity, MARKER_NOTE_LIMIT, MAX_MARKERS } from '@/lib/body3d/booking-details';
import { ZONE_KEYS } from '@/lib/body3d/zones';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { normalizePhone, requiredEmail, rules } from '@/lib/forms/validate';
import { LANDING_BOOKING_STAFF, landingBookingChips } from '@/lib/lp/booking';
import { landingPhoneError } from '@/lib/lp/phone';
import { isRecord } from '../altegio/client';
import { parseBookingDatetime } from './availability';
import { localBookingOrigin } from './local-origin';
import { unavailable, type RecordOutcome } from './record-result';

const MAX_FORM_BODY_BYTES = 8 * 1024;
const MAX_3D_BODY_BYTES = 16 * 1024;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

export function authorizeRecordRequest(request: Request): { ip: string } | { error: RecordOutcome } {
  const localOrigin = localBookingOrigin(request.headers.get('host'), new URL(request.url).protocol);
  const origin = localOrigin ?? process.env.BOOKING_ORIGIN;
  if (!origin) return { error: unavailable };
  const ip = requestSource(request, origin, Boolean(localOrigin));
  return ip ? { ip } : { error: { status: 403, code: 'INVALID_ORIGIN' } };
}

function requestSource(request: Request, expectedOrigin: string, localDevelopment: boolean) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== expectedOrigin ||
    (localDevelopment && fetchSite !== 'same-origin') ||
    (fetchSite !== null && fetchSite !== 'same-origin')) return null;
  if (!URL.canParse(expectedOrigin)) return null;
  const origin = new URL(expectedOrigin);
  if (origin.origin !== expectedOrigin) return null;
  const local = loopback.has(origin.hostname) && loopback.has(new URL(request.url).hostname);
  if (!local && origin.protocol !== 'https:') return null;
  if (localDevelopment) {
    const peer = request.headers.get('x-forwarded-for');
    return local && (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1') ? '127.0.0.1' : null;
  }

  // The configured ingress must overwrite this header with one address.
  const ipHeader = process.env.BOOKING_CLIENT_IP_HEADER;
  if (ipHeader && !/^[a-z\d-]+$/i.test(ipHeader)) return null;
  const ip = ipHeader ? request.headers.get(ipHeader) : local ? '127.0.0.1' : null;
  if (!ip || ip.includes('%')) return null;
  const version = isIP(ip);
  if (!version) return null;
  if (version === 4) return ip;
  const normalized = new URL(`http://[${ip}]`).hostname;
  const mapped = /^\[::ffff:([\da-f]{1,4}):([\da-f]{1,4})\]$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export type ParsedRequest = {
  data: NormalizedBookingRecordRequest;
  captchaToken: string | null;
  instant: Date;
  legacySelection: boolean;
} | { error: RecordOutcome; locale?: CatalogLocale };

async function readJson(request: Request): Promise<{ value: unknown } | { error: RecordOutcome }> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return { error: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' } };
  }
  const oversized: RecordOutcome = { status: 413, code: 'PAYLOAD_TOO_LARGE' };
  if (Number(request.headers.get('content-length')) > MAX_3D_BODY_BYTES) return { error: oversized };
  if (!request.body) return { error: { status: 400, code: 'INVALID_BODY' } };

  const reader = request.body.getReader();
  const bytes = Buffer.alloc(MAX_3D_BODY_BYTES);
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.length > bytes.length) {
        void reader.cancel().catch(() => {});
        return { error: oversized };
      }
      bytes.set(chunk.value, length);
      length += chunk.value.length;
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    if (length > MAX_FORM_BODY_BYTES && (!isRecord(value) || value.source !== '3d')) return { error: oversized };
    return { value };
  } catch {
    return { error: length > MAX_FORM_BODY_BYTES ? oversized : { status: 400, code: 'INVALID_BODY' } };
  } finally {
    reader.releaseLock();
  }
}

export async function parseRecordStatusRequest(request: Request): Promise<{ data: BookingRecordStatusRequest } | { error: RecordOutcome }> {
  const read = await readJson(request);
  if ('error' in read) return read;
  if (!isRecord(read.value)) return { error: { status: 400, code: 'INVALID_BODY' } };
  const { idempotencyKey, recoveryKey, locale } = read.value;
  if (!isBookingAttemptKey(idempotencyKey) || !isBookingAttemptKey(recoveryKey) || (locale !== 'ru' && locale !== 'en') ||
    Object.keys(read.value).length !== 3) return { error: { status: 400, code: 'INVALID_FIELDS' } };
  return { data: { idempotencyKey: idempotencyKey.toLowerCase(), recoveryKey: recoveryKey.toLowerCase(), locale } };
}

function boundedText(value: unknown, max: number, multiline = false) {
  return typeof value === 'string' && value.length <= max &&
    !Array.from(value).some((character) => character === '\x7f' || (character < ' ' &&
      !(multiline && '\r\n\t'.includes(character)))) ? value.trim() : null;
}

function readNote(value: unknown, limit: number) {
  if (value === undefined) return '';
  const text = boundedText(value, limit, true);
  return text?.isWellFormed() ? text.replace(/\r\n?/g, '\n') : null;
}

function parseBody3D(value: unknown, fields: BookingRecordField[]): BookingRecord3DDetails | null {
  if (!isRecord(value)) { fields.push('body3d'); return null; }
  const { model, markers } = value;
  const generalNote = readNote(value.generalNote, GENERAL_NOTE_LIMIT);
  const validModel = model === 'male' || model === 'female';
  if (!validModel) fields.push('model');
  if (generalNote === null) fields.push('generalNote');
  const parsed: BookingRecord3DDetails['markers'] = [];
  if (Array.isArray(markers) && markers.length <= MAX_MARKERS) {
    for (const marker of markers) {
      if (!isRecord(marker)) break;
      const { zoneId, intensity = DEFAULT_MARKER_INTENSITY } = marker;
      const note = readNote(marker.note, MARKER_NOTE_LIMIT);
      if (typeof zoneId !== 'string' || !ZONE_KEYS.includes(zoneId) || !isMarkerIntensity(intensity) || note === null) break;
      parsed.push({ zoneId, intensity, ...(note ? { note } : {}) });
    }
    if (parsed.length !== markers.length) fields.push('markers');
  } else fields.push('markers');
  if (fields.length || !validModel) return null;
  return { model, markers: parsed, ...(generalNote ? { generalNote } : {}) };
}

export async function parseRecordRequest(request: Request): Promise<ParsedRequest> {
  const read = await readJson(request);
  if ('error' in read) return read;
  if (!isRecord(read.value)) return { error: { status: 400, code: 'INVALID_BODY' } };

  const { serviceId, serviceIds: rawServiceIds, staffId, datetime, locale, contact, consent, idempotencyKey, recoveryKey, age, source } = read.value;
  const legacySelection = rawServiceIds === undefined;
  const serviceIds = normalizeBookingServices(serviceId, rawServiceIds);
  const fields: BookingRecordField[] = [];
  const invalid = (): ParsedRequest => ({
    error: { status: 400, code: 'INVALID_FIELDS', fields }, locale: locale === 'ru' ? 'ru' : 'en',
  });
  const landing = source === 'lp';
  if (!serviceIds) fields.push(legacySelection ? 'serviceId' : 'serviceIds');
  if (!validBookingId(staffId, 0) || (landing && staffId !== LANDING_BOOKING_STAFF)) fields.push('staffId');
  const instant = typeof datetime === 'string' && datetime.length <= 48 ? parseBookingDatetime(datetime) : null;
  if (!instant) fields.push('datetime');
  if (locale !== 'ru' && locale !== 'en') fields.push('locale');
  if (consent !== true) fields.push('consent');
  const key = isBookingAttemptKey(idempotencyKey) ? idempotencyKey.toLowerCase() : undefined;
  const recovery = isBookingAttemptKey(recoveryKey) ? recoveryKey.toLowerCase() : undefined;
  if (!key) fields.push('idempotencyKey');
  if (recoveryKey !== undefined && (!recovery || recovery === key)) fields.push('recoveryKey');
  if (!isRecord(contact)) {
    fields.push('contact');
    return invalid();
  }
  const fullname = boundedText(contact.fullname, 100) ?? '';
  const phone = boundedText(contact.phone, 32) ?? '';
  const email = boundedText(contact.email, 254) ?? '';
  const condition = readNote(read.value.condition, 1000);
  if (rules.name(fullname)) fields.push('fullname');
  if (landing ? landingPhoneError(phone) : rules.phone(phone)) fields.push('phone');
  if (requiredEmail(email)) fields.push('email');
  if (age !== undefined && (landing || typeof age !== 'number' || rules.age(age))) fields.push('age');
  if (condition === null || (source === '3d' && read.value.condition !== undefined)) fields.push('condition');
  if ((source !== undefined && source !== '3d' && !landing) ||
    (source !== '3d' && read.value.body3d !== undefined)) fields.push('source');
  const body3d = source === '3d' ? parseBody3D(read.value.body3d, fields) : null;
  let details: string[] | undefined;
  if (read.value.details !== undefined) {
    const raw = read.value.details;
    if (!landing || !Array.isArray(raw) ||
      raw.length > landingBookingChips.size || !raw.every((id) => typeof id === 'string' && landingBookingChips.has(id))) {
      fields.push('details');
    } else details = [...new Set<string>(raw)];
  }
  if (fields.length || !instant || !serviceIds || !key) return invalid();

  const token = read.value.captchaToken;
  const captchaToken = typeof token === 'string' && token.length > 0 && token.length <= 2048 &&
    token.isWellFormed() && !/[\s\p{Cc}]/u.test(token) ? token : null;
  const base = {
    serviceIds,
    staffId: staffId as number,
    datetime: datetime as string,
    locale: locale as CatalogLocale,
    contact: { fullname, phone: normalizePhone(phone), email },
    ...(typeof age === 'number' ? { age } : {}),
    consent: true as const,
    idempotencyKey: key,
    ...(recovery ? { recoveryKey: recovery } : {}),
  };
  if (landing) {
    const rawUtm = read.value.utm;
    const utm = isRecord(rawUtm) ? Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign'].flatMap((key) => {
      const value = boundedText(rawUtm[key], 100);
      return value?.isWellFormed() ? [[key, value]] : [];
    })) : {};
    return { instant, legacySelection, captchaToken, data: { ...base, source: 'lp', ...(details?.length ? { details } : {}), ...(condition ? { condition } : {}),
      ...(Object.keys(utm).length ? { utm } : {}) } };
  }
  return { instant, legacySelection, captchaToken, data: body3d
    ? { ...base, source: '3d', body3d }
    : { ...base, ...(condition ? { condition } : {}) } };
}
