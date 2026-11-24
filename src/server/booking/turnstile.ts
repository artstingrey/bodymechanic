import 'server-only';

import { randomUUID } from 'node:crypto';
import { BOOKING_CAPTCHA_ACTION } from '@/lib/contracts/booking-record';
import { isRecord } from '../altegio/client';
import { captchaInvalid, captchaUnavailable } from './record-result';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EXPECTED_HOSTNAME = 'thebodymechanic.io';
const TIMEOUT_MS = 3_000;

async function verify(body: string) {
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return 'retry';
    const result: unknown = await response.json();
    if (!isRecord(result)) return 'retry';
    if (result.success === true) {
      if (typeof result.hostname !== 'string' || typeof result.action !== 'string') return 'unavailable';
      return result.hostname === EXPECTED_HOSTNAME && result.action === BOOKING_CAPTCHA_ACTION ? 'valid' : 'invalid';
    }
    if (result.success !== false || !Array.isArray(result['error-codes'])) return 'retry';
    const codes: unknown[] = result['error-codes'];
    if (codes.includes('internal-error')) return 'retry';
    return codes.some((code) => code === 'invalid-input-response' || code === 'missing-input-response' ||
      code === 'timeout-or-duplicate') ? 'invalid' : 'unavailable';
  } catch {
    return 'retry';
  }
}

export async function verifyBookingCaptcha(token: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return captchaUnavailable;
  const body = JSON.stringify({ secret, response: token, idempotency_key: randomUUID() });
  let result = await verify(body);
  if (result === 'retry') result = await verify(body);
  if (result === 'valid') return null;
  return result === 'invalid' ? captchaInvalid : captchaUnavailable;
}
