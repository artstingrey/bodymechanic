import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const fetchOriginal = globalThis.fetch;
const datetime = process.env.RECORD_FIXTURE_DATETIME;
const date = process.env.RECORD_FIXTURE_DATE;
const scenarioFile = process.env.RECORD_FIXTURE_SCENARIO;
const journal = `${scenarioFile}.journal`;
const receiptHash = 'fixture-record-hash-secret';
const success = (data, status = 200) => Response.json({ success: true, data }, { status });
const reject = (code) => Response.json({
  success: false, meta: { errors: [{ code, message: 'fixture-private-upstream-error' }] },
}, { status: 422 });

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== 'api.alteg.io') return fetchOriginal(input, init);

  const [, api, version, resource, location, ...rest] = url.pathname.split('/');
  assert.equal(url.origin, 'https://api.alteg.io');
  assert.deepEqual([api, version, location], ['api', 'v1', process.env.ALTEGIO_LOCATION_ID]);
  const headers = new Headers(init?.headers ?? input.headers);
  const signal = init?.signal ?? input.signal;
  const method = init?.method ?? input.method ?? 'GET';
  assert.equal(init?.redirect ?? input.redirect, 'error');
  assert.equal(init?.cache ?? input.cache, 'no-store');
  assert.equal(headers.get('authorization'), 'Bearer fixture-partner-token');
  assert.equal(headers.get('accept'), 'application/vnd.api.v2+json');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.match(headers.get('accept-language'), /^(en-US|ru-RU)$/);
  appendFileSync(journal, `${method} ${resource}\n`);
  const scenario = readFileSync(scenarioFile, 'utf8');

  if (method === 'GET') {
    if (resource === 'book_services') {
      assert.deepEqual(rest, []);
      assert.equal(url.search, '?without_seances=1');
      return success({ services: [
        { id: 13982355, title: 'Sports massage', prepaid: 'forbidden' },
        { id: 13983057, title: 'Mobility', prepaid: 'required' },
        { id: 91201, title: 'Optional prepayment', prepaid: 'allowed' },
        { id: 91202, title: 'Unknown prepayment' },
      ] });
    }
    if (resource === 'book_staff') {
      assert.deepEqual(rest, []);
      assert.ok(url.search === '' || url.search === '?service_ids%5B%5D=13982355');
      return success([{ id: 91601, name: 'Example specialist', bookable: false }]);
    }
    if (resource === 'book_dates') {
      assert.deepEqual(rest, []);
      assert.match(url.search, /^\?service_ids%5B%5D=13982355&staff_id=(0|91601)$/);
      return success({ booking_dates: [date] });
    }
    if (resource === 'book_times') {
      assert.equal(rest[1], date);
      assert.ok(['0', '91601'].includes(rest[0]));
      assert.match(url.search, /^\?service_ids%5B%5D=(13982355|91201)$/);
      return success(scenario === 'empty-time' ? [] : [{ datetime, time: '23:20' }]);
    }
    assert.equal(resource, 'book_record');
    assert.deepEqual(rest, ['12345', receiptHash]);
    assert.equal(url.search, '');
    if (scenario === 'no-details') return new Response(null, { status: 403 });
    return Response.json({
      id: 12345, datetime: new Date(datetime).toISOString(), deleted: false,
      services: [{ id: 13982355 }], staff: { id: 91601, name: 'Example specialist', private: 'fixture-private-upstream-error' },
      client: { fullname: 'fixture-private-fullname', phone: '+971501234567' }, record_hash: receiptHash,
    });
  }

  assert.equal(method, 'POST');
  assert.deepEqual(rest, []);
  assert.equal(url.search, '');
  const payload = JSON.parse(init?.body ?? await input.text());
  const { appointments } = payload;
  assert.equal(appointments.length, 1);
  const appointment = appointments[0];
  assert.ok([0, 91601].includes(appointment.staff_id));
  assert.equal(appointment.services.length, 1);
  assert.ok([13982355, 91201].includes(appointment.services[0]));
  assert.deepEqual(appointment, { id: 1, staff_id: appointment.staff_id, services: appointment.services, datetime });

  if (resource === 'book_check') {
    assert.deepEqual(Object.keys(payload), ['appointments']);
    if (scenario === 'check-conflict') return reject(433);
    if (scenario === 'check-staff') return reject(436);
    if (scenario === 'check-429') return new Response(null, { status: 429, headers: { 'Retry-After': '17' } });
    if (scenario === 'check-bad') return success([], 201);
    if (scenario === 'checked-json') return Response.json({ success: true, meta: { message: 'Created' } }, { status: 201 });
    if (scenario === 'competition') {
      while (readFileSync(journal, 'utf8').match(/^POST book_check$/gm)?.length < 2) await delay(20, undefined, { signal });
    }
    return new Response(null, { status: 201 });
  }

  assert.equal(resource, 'book_record');
  assert.deepEqual(Object.keys(payload).sort(), ['appointments', 'email', 'fullname', 'phone']);
  assert.match(payload.email, /^visitor\d*@example\.test$/);
  assert.match(payload.phone, /^\+97150\d{7}$/);
  assert.equal(payload.fullname, 'fixture-private-fullname');
  if (scenario === 'record-sms') return reject(432);
  if (scenario === 'record-429') return new Response(null, { status: 429, headers: { 'Retry-After': 'Tue, 01 Jan 2030 00:00:00 GMT' } });
  if (scenario === 'bad-receipt') return success([{ id: 2, record_id: 12345, record_hash: receiptHash }], 201);
  if (scenario === 'hold-record') {
    while (!existsSync(`${scenarioFile}.release`)) await delay(20, undefined, { signal });
  }
  if (scenario === 'competition' || scenario === 'record-timeout') {
    try {
      writeFileSync(`${scenarioFile}.created`, '', { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') return reject(433);
      throw error;
    }
  }
  if (scenario === 'record-timeout') await delay(50_000, undefined, { signal });
  return success([{ id: 1, record_id: 12345, record_hash: receiptHash }], 201);
};
