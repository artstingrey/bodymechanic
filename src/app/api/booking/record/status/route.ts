import { getAltegioConfig } from '@/server/config';
import { authorizeRecordRequest, parseRecordStatusRequest } from '@/server/booking/record-request';
import { recordResponse, unavailable } from '@/server/booking/record-result';
import { getRecordOutcome } from '@/server/booking/record-store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const source = authorizeRecordRequest(request);
  if ('error' in source) return recordResponse(source.error, 'en');
  const parsed = await parseRecordStatusRequest(request);
  if ('error' in parsed) return recordResponse(parsed.error, 'en');
  const { idempotencyKey, recoveryKey, locale } = parsed.data;
  try {
    const { locationId } = getAltegioConfig();
    const response = recordResponse(getRecordOutcome(locationId, idempotencyKey, recoveryKey), locale);
    response.headers.set('X-Booking-Outcome', 'stored');
    return response;
  } catch {
    return recordResponse(unavailable, locale);
  }
}
