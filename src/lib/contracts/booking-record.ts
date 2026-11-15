import type { CatalogLocale } from './catalog';

export interface BookingRecordRequest {
  serviceId: number;
  staffId: number;
  datetime: string;
  locale: CatalogLocale;
  contact: { fullname: string; phone: string; email: string };
  age?: number;
  condition?: string;
  consent: true;
  idempotencyKey: string;
}

export interface BookingRecordPart {
  recordId: number;
  title: string;
  datetime: string;
  durationSeconds?: number;
  staff?: { id: number; name: string };
}

export type BookingRecordData =
  | { status: 'processing' | 'unknown' }
  | {
    status: 'created';
    recordId: number;
    serviceId: number;
    datetime: string;
    staff?: { id: number; name: string };
    parts?: BookingRecordPart[];
  };

export type BookingRecordField = 'serviceId' | 'staffId' | 'datetime' | 'locale' | 'contact'
  | 'fullname' | 'phone' | 'email' | 'age' | 'condition' | 'consent' | 'idempotencyKey';

export type BookingRecordErrorCode =
  | 'INVALID_BODY' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'INVALID_ORIGIN'
  | 'BOOKING_UNAVAILABLE' | 'INVALID_FIELDS' | 'IDEMPOTENCY_CONFLICT'
  | 'SERVICE_NOT_FOUND' | 'STAFF_NOT_FOUND' | 'SLOT_TAKEN' | 'PREPAYMENT_REQUIRED'
  | 'SMS_REQUIRED' | 'BOOKING_REJECTED' | 'RATE_LIMITED' | 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_TIMEOUT';

export type BookingRecordResponse =
  | { data: BookingRecordData }
  | { error: { code: BookingRecordErrorCode; message: string; fields?: BookingRecordField[] } };
