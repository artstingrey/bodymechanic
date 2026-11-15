import { getAltegioConfig } from '@/server/config';
import { createBookingRecord } from '@/server/booking/create-record';
import { parseRecordRequest, requestSource } from '@/server/booking/record-request';
import { recordResponse, unavailable } from '@/server/booking/record-result';
import { claimRecord } from '@/server/booking/record-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!process.env.BOOKING_ORIGIN) return recordResponse(unavailable, 'en');
  const ip = requestSource(request);
  if (!ip) return recordResponse({ status: 403, code: 'INVALID_ORIGIN' }, 'en');
  const parsed = await parseRecordRequest(request);
  if ('error' in parsed) return recordResponse(parsed.error, parsed.locale ?? 'en');

  const { data, instant } = parsed;
  let locationId: number;
  try {
    ({ locationId } = getAltegioConfig());
  } catch {
    console.warn('[booking] Record configuration unavailable');
    return recordResponse(unavailable, data.locale);
  }
  const claim = claimRecord(locationId, ip, data);
  if ('outcome' in claim) return recordResponse(claim.outcome, data.locale);

  const result = await createBookingRecord(locationId, data, instant);
  claim.finish(result);
  return recordResponse(result, data.locale);
}
