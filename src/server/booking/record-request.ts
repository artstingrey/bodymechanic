import 'server-only';

import { isIP } from 'node:net';
import type { BookingRecord3DDetails, BookingRecordField, BookingRecordRequest } from '@/lib/contracts/booking-record';
import { DEFAULT_MARKER_INTENSITY, GENERAL_NOTE_LIMIT, isMarkerIntensity, MARKER_NOTE_LIMIT, MAX_MARKERS } from '@/lib/body3d/booking-details';
import { ZONE_KEYS } from '@/lib/body3d/zones';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { normalizePhone, requiredEmail, rules } from '@/lib/forms/validate';
import { isRecord } from '../altegio/client';
import { parseBookingDatetime } from './availability';
import type { RecordOutcome } from './record-result';

const MAX_FORM_BODY_BYTES = 8 * 1024;
const MAX_3D_BODY_BYTES = 16 * 1024;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function requestSource(request: Request, expectedOrigin: string, localDevelopment: boolean) {
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

export type ParsedRequest = { data: BookingRecordRequest; instant: Date } | { error: RecordOutcome; locale?: CatalogLocale };

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

export function validId(value: unknown, minimum = 1): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
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
  const { healthConsent, model, markers } = value;
  const generalNote = readNote(value.generalNote, GENERAL_NOTE_LIMIT);
  const validModel = model === 'male' || model === 'female';
  if (healthConsent !== true) fields.push('healthConsent');
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
  return { healthConsent: true, model, markers: parsed, ...(generalNote ? { generalNote } : {}) };
}

export async function parseRecordRequest(request: Request): Promise<ParsedRequest> {
  const read = await readJson(request);
  if ('error' in read) return read;
  if (!isRecord(read.value)) return { error: { status: 400, code: 'INVALID_BODY' } };

  const { serviceId, staffId, datetime, locale, contact, consent, idempotencyKey, age, source } = read.value;
  const fields: BookingRecordField[] = [];
  const invalid = (): ParsedRequest => ({
    error: { status: 400, code: 'INVALID_FIELDS', fields }, locale: locale === 'ru' ? 'ru' : 'en',
  });
  if (!validId(serviceId)) fields.push('serviceId');
  if (!validId(staffId, 0)) fields.push('staffId');
  const instant = typeof datetime === 'string' && datetime.length <= 48 ? parseBookingDatetime(datetime) : null;
  if (!instant) fields.push('datetime');
  if (locale !== 'ru' && locale !== 'en') fields.push('locale');
  if (consent !== true) fields.push('consent');
  if (typeof idempotencyKey !== 'string' || !uuidV4.test(idempotencyKey)) fields.push('idempotencyKey');
  if (!isRecord(contact)) {
    fields.push('contact');
    return invalid();
  }
  const fullname = boundedText(contact.fullname, 100) ?? '';
  const phone = boundedText(contact.phone, 32) ?? '';
  const email = boundedText(contact.email, 254) ?? '';
  const condition = read.value.condition === undefined ? '' : boundedText(read.value.condition, 1000, true);
  if (rules.name(fullname)) fields.push('fullname');
  if (rules.phone(phone)) fields.push('phone');
  if (requiredEmail(email)) fields.push('email');
  if (age !== undefined && (typeof age !== 'number' || rules.age(age))) fields.push('age');
  if (condition === null || (source === '3d' && read.value.condition !== undefined)) fields.push('condition');
  if ((source !== undefined && source !== '3d') || (source === undefined && read.value.body3d !== undefined)) fields.push('source');
  const body3d = source === '3d' ? parseBody3D(read.value.body3d, fields) : null;
  if (fields.length || !instant) return invalid();

  const base = {
    serviceId: serviceId as number,
    staffId: staffId as number,
    datetime: datetime as string,
    locale: locale as CatalogLocale,
    contact: { fullname, phone: normalizePhone(phone), email },
    ...(typeof age === 'number' ? { age } : {}),
    consent: true as const,
    idempotencyKey: (idempotencyKey as string).toLowerCase(),
  };
  return { instant, data: body3d
    ? { ...base, source: '3d', body3d }
    : { ...base, ...(condition ? { condition: condition.replace(/\r\n?/g, '\n') } : {}) } };
}
