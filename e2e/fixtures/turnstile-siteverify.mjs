import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { turnstileEnv } from './turnstile.mjs';

const checked = new Set();
const retried = new Set();
const failure = (...codes) => Response.json({ success: false, 'error-codes': codes });

export async function siteverifyFixture(url, init) {
  assert.equal(url.href, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(init.method, 'POST');
  assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  const { secret, response, idempotency_key: idempotencyKey } = JSON.parse(init.body);
  assert.ok(secret === turnstileEnv.TURNSTILE_SECRET_KEY, 'Siteverify fixture must use the synthetic secret');
  assert.match(idempotencyKey, /^[0-9a-f-]{36}$/);
  const journal = process.env.RECORD_FIXTURE_TURNSTILE_JOURNAL;
  if (journal) appendFileSync(journal, `${idempotencyKey}\n`);

  const success = { success: true, hostname: 'thebodymechanic.io', action: 'booking' };
  switch (response) {
    case 'synthetic-captcha-expired': return failure('timeout-or-duplicate');
    case 'synthetic-captcha-hostname': return Response.json({ ...success, hostname: 'example.com' });
    case 'synthetic-captcha-action': return Response.json({ ...success, action: 'other' });
    case 'synthetic-captcha-dummy': return Response.json({ success: true, hostname: 'example.com' });
    case 'synthetic-captcha-bad-json': return new Response('not json');
    case 'synthetic-captcha-http': return new Response(null, { status: 503 });
    case 'synthetic-captcha-shape': return Response.json({ success: 'true' });
    case 'synthetic-captcha-timeout':
      await delay(15_000, undefined, { signal: init.signal });
      return Response.json(success);
    case 'synthetic-captcha-hold-invalid':
      await delay(500);
      return failure('invalid-input-response');
    case 'synthetic-captcha-retry':
      if (!retried.has(idempotencyKey)) {
        retried.add(idempotencyKey);
        throw new Error('Synthetic transport failure');
      }
      return Response.json(success);
    default:
      if (!/^synthetic-captcha-[a-f0-9-]{36}$/.test(response)) return failure('invalid-input-response');
      if (checked.has(response)) return failure('timeout-or-duplicate');
      checked.add(response);
      return Response.json(success);
  }
}
