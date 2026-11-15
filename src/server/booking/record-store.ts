import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';
import type { BookingRecordRequest } from '@/lib/contracts/booking-record';
import { processing, unavailable, unknown, type RecordOutcome } from './record-result';

const DAY = 24 * 60 * 60 * 1000;
const LIMIT_WINDOW = 10 * 60 * 1000;
const MAX_PER_SUBJECT = 5;
const MAX_ATTEMPTS = 10_000;
const MAX_PROCESSING_TIME = 90_000;

type Attempt = {
  fingerprint: string;
  phoneHash: string;
  ipHash: string;
  consentedAt: number;
  result?: RecordOutcome;
};

// Process-local until the Redis store is implemented. Claiming an attempt does not yield to other requests.
const attempts = new Map<string, Attempt>();
const secret = randomBytes(32);

function digest(scope: string, value: string) {
  return createHmac('sha256', secret).update(scope).update('\0').update(value).digest('hex');
}

export function claimRecord(locationId: number, ip: string, input: BookingRecordRequest):
  { outcome: RecordOutcome } | { finish: (result: RecordOutcome) => void } {
  const now = Date.now();
  const key = digest('key', input.idempotencyKey);
  const fingerprint = digest('request', JSON.stringify([locationId, input]));
  const previous = attempts.get(key);
  if (previous && now - previous.consentedAt < DAY) {
    if (previous.fingerprint !== fingerprint) return { outcome: { status: 409, code: 'IDEMPOTENCY_CONFLICT' } };
    return { outcome: previous.result ?? (now - previous.consentedAt >= MAX_PROCESSING_TIME ? unknown : processing) };
  }

  const ipHash = digest('ip', ip);
  const phoneHash = digest('phone', input.contact.phone);
  const byIp = { count: 0, oldest: now };
  const byPhone = { count: 0, oldest: now };
  for (const [storedKey, attempt] of attempts) {
    const age = now - attempt.consentedAt;
    if (age >= DAY) attempts.delete(storedKey);
    if (age >= LIMIT_WINDOW) continue;
    if (attempt.ipHash === ipHash) {
      byIp.count++;
      byIp.oldest = Math.min(byIp.oldest, attempt.consentedAt);
    }
    if (attempt.phoneHash === phoneHash) {
      byPhone.count++;
      byPhone.oldest = Math.min(byPhone.oldest, attempt.consentedAt);
    }
  }

  const retryMs = Math.max(
    byIp.count >= MAX_PER_SUBJECT ? byIp.oldest + LIMIT_WINDOW - now : 0,
    byPhone.count >= MAX_PER_SUBJECT ? byPhone.oldest + LIMIT_WINDOW - now : 0,
  );
  if (retryMs > 0) {
    return { outcome: { status: 429, code: 'RATE_LIMITED', retryAfter: String(Math.ceil(retryMs / 1000)) } };
  }
  if (attempts.size >= MAX_ATTEMPTS) return { outcome: unavailable };

  const attempt: Attempt = { fingerprint, ipHash, phoneHash, consentedAt: now };
  attempts.set(key, attempt);
  return { finish(result) { attempt.result = result; } };
}
