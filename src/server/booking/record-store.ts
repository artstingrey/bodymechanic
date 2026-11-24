import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';
import type { NormalizedBookingRecordRequest } from '@/lib/contracts/booking-record';
import { captchaInvalid, processing, unavailable, unknown, type RecordOutcome } from './record-result';

const DAY = 24 * 60 * 60 * 1000;
const LIMIT_WINDOW = 10 * 60 * 1000;
const MAX_PER_SUBJECT = 5;
const MAX_ATTEMPTS = 10_000;
const MAX_PROCESSING_TIME = 90_000;

type Attempt = {
  locationId: number;
  fingerprint: string;
  recoveryHash?: string;
  phoneHash: string;
  ipHash: string;
  consentedAt: number;
  verifying?: Promise<RecordOutcome | null>;
  captchaRejected?: true;
  result?: RecordOutcome;
};

// Process-local until the Redis store is implemented. Claiming an attempt does not yield to other requests.
const processState = globalThis as typeof globalThis & {
  bodyMechanicBookingStore?: { attempts: Map<string, Attempt>; secret: Buffer };
};
const { attempts, secret } = processState.bodyMechanicBookingStore ??= { attempts: new Map<string, Attempt>(), secret: randomBytes(32) };

function digest(scope: string, value: string) {
  return createHmac('sha256', secret).update(scope).update('\0').update(value).digest('hex');
}

function resultOf(attempt: Attempt, now: number) {
  return attempt.result ?? (now - attempt.consentedAt >= MAX_PROCESSING_TIME ? unknown : processing);
}

export function getRecordOutcome(locationId: number, idempotencyKey: string, recoveryKey: string): RecordOutcome {
  const attempt = attempts.get(digest('key', idempotencyKey));
  const now = Date.now();
  if (!attempt || attempt.locationId !== locationId || now - attempt.consentedAt >= DAY ||
    attempt.recoveryHash !== digest('recovery', recoveryKey)) return unknown;
  return resultOf(attempt, now);
}

export function claimRecord(
  locationId: number, ip: string, input: NormalizedBookingRecordRequest, captchaToken: string | null,
  verifyCaptcha: (token: string) => Promise<RecordOutcome | null>,
):
  { outcome: RecordOutcome | Promise<RecordOutcome> } | {
    verification: Promise<RecordOutcome | null>;
    finish: (result: RecordOutcome) => void;
  } {
  const now = Date.now();
  const key = digest('key', input.idempotencyKey);
  const fingerprint = digest('request', JSON.stringify([locationId, input]));
  const previous = attempts.get(key);
  if (previous && now - previous.consentedAt < DAY) {
    if (previous.fingerprint !== fingerprint) return { outcome: { status: 409, code: 'IDEMPOTENCY_CONFLICT' } };
    if (previous.verifying) {
      return { outcome: previous.verifying.then((rejection) => rejection ?? resultOf(previous, Date.now())) };
    }
    if (!previous.captchaRejected) return { outcome: resultOf(previous, now) };
  }
  if (!captchaToken) return { outcome: captchaInvalid };

  const ipHash = digest('ip', ip);
  const phoneHash = digest('phone', input.contact.phone);
  const byIp = { count: 0, oldest: now };
  const byPhone = { count: 0, oldest: now };
  for (const [storedKey, attempt] of attempts) {
    const age = now - attempt.consentedAt;
    if (age >= DAY) attempts.delete(storedKey);
    if (age >= LIMIT_WINDOW || storedKey === key) continue;
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
  if (attempts.size >= MAX_ATTEMPTS && !attempts.has(key)) return { outcome: unavailable };

  const recoveryHash = input.recoveryKey ? digest('recovery', input.recoveryKey) : undefined;
  // A duplicate waits for verification so a definitive rejection is visible to both requests.
  const attempt: Attempt = { locationId, fingerprint, recoveryHash, ipHash, phoneHash, consentedAt: now };
  const verification = verifyCaptcha(captchaToken).then((rejection) => {
    attempt.verifying = undefined;
    if (rejection) {
      attempt.result = rejection;
      attempt.captchaRejected = true;
    }
    return rejection;
  });
  attempt.verifying = verification;
  attempts.set(key, attempt);
  return { verification, finish(result) { attempt.result = result; } };
}
