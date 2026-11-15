import 'server-only';

import { isIP } from 'node:net';
import type { BookingRecordField, BookingRecordRequest } from '@/lib/contracts/booking-record';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { normalizePhone, rules } from '@/lib/forms/validate';
import { isRecord } from '../altegio/client';
import { parseBookingDatetime } from './availability';
import type { RecordOutcome } from './record-result';

const MAX_BODY_BYTES = 4096;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function requestSource(request: Request) {
  const expectedOrigin = process.env.BOOKING_ORIGIN;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!expectedOrigin || request.headers.get('origin') !== expectedOrigin ||
    (fetchSite !== null && fetchSite !== 'same-origin')) return null;
  if (!URL.canParse(expectedOrigin)) return null;
  const origin = new URL(expectedOrigin);
  if (origin.origin !== expectedOrigin) return null;
  const local = loopback.has(origin.hostname) && loopback.has(new URL(request.url).hostname);
  if (!local && origin.protocol !== 'https:') return null;

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
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return { error: oversized };
  if (!request.body) return { error: { status: 400, code: 'INVALID_BODY' } };

  const reader = request.body.getReader();
  const bytes = Buffer.alloc(MAX_BODY_BYTES);
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
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))) as unknown };
  } catch {
    return { error: { status: 400, code: 'INVALID_BODY' } };
  } finally {
    reader.releaseLock();
  }
}

export function validId(value: unknown, minimum = 1): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function boundedText(value: unknown, max: number) {
  return typeof value === 'string' && value.length <= max &&
    !Array.from(value).some((character) => character < ' ' || character === '\x7f') ? value.trim() : '';
}

export async function parseRecordRequest(request: Request): Promise<ParsedRequest> {
  const read = await readJson(request);
  if ('error' in read) return read;
  if (!isRecord(read.value)) return { error: { status: 400, code: 'INVALID_BODY' } };

  const { serviceId, staffId, datetime, locale, contact, consent, idempotencyKey } = read.value;
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
  const fullname = boundedText(contact.fullname, 100);
  const phone = boundedText(contact.phone, 32);
  const email = boundedText(contact.email, 254);
  if (rules.name(fullname)) fields.push('fullname');
  if (rules.phone(phone)) fields.push('phone');
  if (!email || rules.email(email)) fields.push('email');
  if (fields.length || !instant) return invalid();

  return { instant, data: {
    serviceId: serviceId as number,
    staffId: staffId as number,
    datetime: datetime as string,
    locale: locale as CatalogLocale,
    contact: { fullname, phone: normalizePhone(phone), email },
    consent: true,
    idempotencyKey: (idempotencyKey as string).toLowerCase(),
  } };
}
