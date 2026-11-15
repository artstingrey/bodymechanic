import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const settings = () => JSON.parse(readFileSync(process.env.STAFF_PROFILE_FIXTURE, 'utf8'));
const originalFetch = globalThis.fetch;

// Move only the wall-clock date used by the app. Timeouts and retry deadlines still run in real time.
globalThis.Date = new Proxy(Date, {
  construct(target, args) { return new target(...(args.length ? args : [settings().now])); },
});

const ok = (data) => Response.json({ success: true, data });
const failure = (status) => new Response(null, { status, headers: { 'Retry-After': '2' } });
const times = (values) => values.map((datetime) => ({ datetime }));

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== 'https://api.alteg.io') return originalFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const language = headers.get('Accept-Language');
  assert.ok(language === 'ru-RU' || language === 'en-US');
  assert.equal(headers.get('Authorization'), 'Bearer fixture-partner-token');
  assert.equal(init?.method ?? (input instanceof Request ? input.method : 'GET'), 'GET');
  assert.equal(init?.cache ?? (input instanceof Request ? input.cache : undefined), 'no-store');
  const [, api, version, resource, location, staffId, date] = url.pathname.split('/');
  assert.deepEqual([api, version, location], ['api', 'v1', process.env.ALTEGIO_LOCATION_ID]);
  const { catalog, slots } = settings();
  const ru = language === 'ru-RU';

  if (resource === 'book_staff') {
    assert.equal(url.search, '');
    if (catalog === 'failed') return failure(503);
    return ok([
      { id: 91601, name: ru ? 'Анна Пример' : 'Anna Example', position: { title: ru ? 'Специалист студии' : 'Studio specialist' },
        specialization: ru ? 'Спортивный массаж' : 'Sports massage', avatar_big: 'https://images.example.test/portrait.webp', privateNote: 'fixture raw staff detail' },
      { id: 91602, name: 'No Portrait', avatar: 'https://app.alteg.io/images/no-master.png' },
      { id: 91603, name: 'Broken Portrait', avatar: 'https://images.example.test/broken.webp' },
      { id: 91604, name: 'Hidden', hidden: 1 },
      { id: 91605, name: 'Fired', fired: 1 },
    ]);
  }

  console.info('[staff-profile-fixture]', resource, slots, language);
  if (resource === 'book_staff_seances') {
    assert.equal(url.search, '');
    assert.match(staffId, /^9160[1-3]$/);
    assert.equal(date, undefined);
    if (slots === '429') return failure(429);
    if (slots === 'error') return failure(503);
    if (slots === 'fallback') return failure(400);
    if (slots === 'tomorrow') return ok({ seance_date: '2026-11-16', seances: times(['2026-11-16T09:00:00+04:00']) });
    if (slots === 'empty') return ok({ seances: [] });
    if (slots === 'boundary') return ok({ seances: times(['2026-11-15T19:59:00Z', '2026-11-15T20:03:00Z', '2026-11-15T20:01:00Z']) });
    assert.equal(slots, 'mixed');
    await delay(300);
    return ok({ seances: times([
      '2026-11-15T17:00:00Z', '2026-11-16T02:00:00+04:00', '2026-11-15T16:00:00+04:00',
      '2026-11-15T12:45:00Z', '2026-11-15T16:30:00+04:00', '2026-11-15T17:30:00+04:00',
      '2026-11-15T13:00:00+03:00', '2026-11-15T13:00:00Z', '2026-11-15T17:00:00+04:00',
    ]) });
  }
  assert.equal(slots, 'fallback');
  if (resource === 'book_services') {
    assert.equal(url.search, '?without_seances=1&staff_id=91601');
    return ok({ services: [{ id: 13982355, title: 'Sports massage' }, { id: 13982356, title: 'Classic massage' }] });
  }
  assert.equal(resource, 'book_times');
  assert.equal(staffId, '91601');
  assert.equal(date, '2026-11-15');
  const serviceId = url.searchParams.get('service_ids[]');
  assert.equal(url.searchParams.size, 1);
  if (serviceId === '13982355') return ok(times(['2026-11-15T17:45:00+04:00', '2026-11-16T00:00:00+04:00']));
  assert.equal(serviceId, '13982356');
  return ok(times(['2026-11-15T13:45:00Z', '2026-11-15T16:15:00+04:00']));
};
