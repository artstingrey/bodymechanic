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
const sports = { id: 13982355, title: 'Sports massage' };
const classic = { id: 13982356, title: 'Classic massage' };
const other = { id: 91201, title: 'Other service' };

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
    const staff = [
      { id: 91601, name: ru ? 'Анна Пример' : 'Anna Example', position: { title: ru ? 'Специалист студии' : 'Studio specialist' },
        information: '<p>Experience &amp; training</p><p>Profile <a href="https://example.test">details</a></p><script>internal script</script>',
        specialization: ru ? 'Спортивный массаж' : 'Sports massage', avatar_big: 'https://images.example.test/portrait.webp', privateNote: 'fixture raw staff detail' },
      { id: 91602, name: 'No Portrait', avatar: 'https://app.alteg.io/images/no-master.png' },
      { id: 91603, name: 'Broken Portrait', avatar: 'https://images.example.test/broken.webp' },
      { id: 91604, name: 'Hidden', hidden: 1 },
      { id: 91605, name: 'Fired', fired: 1 },
    ];
    const service = Number(url.searchParams.get('service_ids[]'));
    if (service) {
      assert.equal(url.searchParams.size, 1);
      assert.ok([sports.id, classic.id, other.id].includes(service));
      return ok([service === other.id ? staff[1] : staff[0]]);
    }
    assert.equal(url.search, '');
    return catalog === 'failed' ? failure(503) : ok(staff);
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
  if (resource === 'book_services') {
    if (!url.searchParams.has('staff_id')) {
      assert.equal(url.search, '?without_seances=1');
      return ok({ services: [sports, classic, other] });
    }
    assert.equal(slots, 'fallback');
    assert.equal(url.search, '?without_seances=1&staff_id=91601');
    return ok({ services: [sports, classic] });
  }
  const serviceId = Number(url.searchParams.get('service_ids[]'));
  if (resource === 'book_dates') {
    assert.equal(url.searchParams.size, 2);
    assert.equal(url.searchParams.get('staff_id'), '91601');
    assert.ok([sports.id, classic.id].includes(serviceId));
    return ok({ booking_dates: ['2026-11-15'] });
  }
  assert.equal(resource, 'book_times');
  assert.equal(staffId, '91601');
  assert.equal(date, '2026-11-15');
  assert.equal(url.searchParams.size, 1);
  if (slots === 'fallback') {
    if (serviceId === sports.id) return ok(times(['2026-11-15T17:45:00+04:00', '2026-11-16T00:00:00+04:00']));
    assert.equal(serviceId, classic.id);
    return ok(times(['2026-11-15T13:45:00Z', '2026-11-15T16:15:00+04:00']));
  }
  assert.equal(serviceId, sports.id);
  assert.ok(['mixed', 'gone'].includes(slots));
  return ok(times(slots === 'gone' ? ['2026-11-15T19:00:00+04:00'] : ['2026-11-15T12:30:00Z']));
};
