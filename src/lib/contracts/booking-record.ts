import type { CatalogLocale } from './catalog';
import type { BookingServiceReference, BookingServiceSelection, BookingStaff } from './booking-services';

interface BookingRecordBase {
  staffId: number;
  datetime: string;
  locale: CatalogLocale;
  contact: { fullname: string; phone: string; email: string };
  age?: number;
  consent: true;
  idempotencyKey: string;
  recoveryKey?: string;
}

export interface BookingRecord3DDetails {
  model: 'male' | 'female';
  markers: { zoneId: string; intensity?: number; note?: string }[];
  generalNote?: string;
}

type BookingRecordDetails = BookingRecordBase & (
  | { source?: never; condition?: string; body3d?: never }
  | { source: '3d'; body3d: BookingRecord3DDetails; condition?: never }
| {
  source: 'lp';
  details?: string[];
  utm?: Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign', string>>;
  condition?: string;
  body3d?: never;
});

export type BookingRecordRequest = BookingRecordDetails & BookingServiceSelection;
export type NormalizedBookingRecordRequest = BookingRecordDetails & { serviceIds: number[] };

export interface BookingRecordPart {
  recordId: number;
  title: string;
  datetime: string;
  durationSeconds?: number;
  staff?: BookingStaff;
}

export type ConfirmedBookingService = { id: number; title: string };

export interface BookingRecordStatusRequest {
  idempotencyKey: string;
  recoveryKey: string;
  locale: CatalogLocale;
}

export function isBookingAttemptKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

export type BookingRecordConfirmation = {
  status: 'created';
  recordId: number;
  datetime: string;
  staff?: BookingStaff;
  parts?: BookingRecordPart[];
};

export type BookingRecordSetConfirmation = BookingRecordConfirmation & {
  serviceIds: number[];
  services: ConfirmedBookingService[];
  serviceId?: never;
  durationSeconds?: number;
};

export type BookingRecordData =
  | { status: 'processing' | 'unknown' }
  | BookingRecordSetConfirmation
  | (BookingRecordConfirmation & Extract<BookingServiceReference, { serviceId: number }> & {
    services?: never; durationSeconds?: never;
  });

export type BookingRecordField = 'serviceId' | 'serviceIds' | 'staffId' | 'datetime' | 'locale' | 'contact'
  | 'fullname' | 'phone' | 'email' | 'age' | 'condition' | 'consent' | 'idempotencyKey' | 'recoveryKey'
  | 'source' | 'body3d' | 'model' | 'markers' | 'generalNote' | 'details';

export type BookingRecordErrorCode =
  | 'INVALID_BODY' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'INVALID_ORIGIN'
  | 'BOOKING_UNAVAILABLE' | 'INVALID_FIELDS' | 'IDEMPOTENCY_CONFLICT'
  | 'SERVICE_NOT_FOUND' | 'STAFF_NOT_FOUND' | 'SLOT_TAKEN' | 'PREPAYMENT_REQUIRED'
  | 'SMS_REQUIRED' | 'BOOKING_REJECTED' | 'RATE_LIMITED' | 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_TIMEOUT';

export type BookingRecordResponse =
  | { data: BookingRecordData }
  | { error: { code: BookingRecordErrorCode; message: string; fields?: BookingRecordField[] } };
