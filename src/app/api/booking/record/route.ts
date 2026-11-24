import { getAltegioConfig } from '@/server/config';
import { createBookingRecord } from '@/server/booking/create-record';
import { authorizeRecordRequest, parseRecordRequest } from '@/server/booking/record-request';
import { recordResponse, unavailable } from '@/server/booking/record-result';
import { claimRecord } from '@/server/booking/record-store';
import { verifyBookingCaptcha } from '@/server/booking/turnstile';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const source = authorizeRecordRequest(request);
  if ('error' in source) return recordResponse(source.error, 'en');
  const parsed = await parseRecordRequest(request);
  if ('error' in parsed) return recordResponse(parsed.error, parsed.locale ?? 'en');

  const { data, instant, legacySelection, captchaToken } = parsed;
  let locationId: number;
  try {
    ({ locationId } = getAltegioConfig());
  } catch {
    console.warn('[booking] Record configuration unavailable');
    return recordResponse(unavailable, data.locale);
  }
  const claim = claimRecord(locationId, source.ip, data, captchaToken, verifyBookingCaptcha);
  if ('outcome' in claim) return recordResponse(await claim.outcome, data.locale, legacySelection);

  const rejection = await claim.verification;
  if (rejection) return recordResponse(rejection, data.locale, legacySelection);

  const result = await createBookingRecord(locationId, data, instant);
  claim.finish(result);
  return recordResponse(result, data.locale, legacySelection);
}
