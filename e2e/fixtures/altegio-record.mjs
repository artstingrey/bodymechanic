import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const fetchOriginal = globalThis.fetch;
const datetime = process.env.RECORD_FIXTURE_DATETIME;
const date = process.env.RECORD_FIXTURE_DATE;
const scenarioFile = process.env.RECORD_FIXTURE_SCENARIO;
const journal = `${scenarioFile}.journal`;
const receiptHash = 'fixture-record-hash-secret';
const packageIds = [13982379, 13982380];
const packageParts = [
  { id: 12345, datetime: `${date}T00:20:00.123+0400`, length: 2700, staff: { id: 91601, name: 'Example specialist' } },
  { id: 12346, datetime: `${date}T01:05:00.123+0400`, length: 2700, staff: { id: 91602, name: 'Capsule operator' } },
];
const multiStaff = new Map([
  [91201, [91601, 91602, 91603]], [91203, [91601]], [91204, [91605]],
  [13982355, [91601, 91602]], [13982379, [91601, 91603]], [13983057, [91601]],
]);
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
  const scenario = readFileSync(scenarioFile, 'utf8');
  const landing = scenario.startsWith('lp-');
  const multi = scenario.startsWith('multi-');
  const needsConcreteStaff = scenario === 'package-classic' || scenario === 'package-any-no-slot';
  appendFileSync(journal, `${method} ${resource}\n`);

  if (method === 'GET') {
    if (resource === 'book_services') {
      assert.deepEqual(rest, []);
      const staffId = Number(url.searchParams.get('staff_id'));
      assert.equal(url.search, staffId ? `?without_seances=1&staff_id=${staffId}` : '?without_seances=1');
      const services = [
        ...(scenario === 'multi-service-removed' ? [] : [{ id: 13982355, title: 'Sports massage', prepaid: 'forbidden' }]),
        { id: 13983057, title: 'Mobility', prepaid: 'required' },
        { id: 91201, title: 'Optional prepayment', prepaid: 'allowed', price_min: 125.5, price_max: 125.5, seance_length: 1800 },
        { id: 91202, title: 'Unknown prepayment' },
        { id: 13982379, title: 'Sports massage + Infrared capsule', prepaid: 'forbidden', is_composite: true },
        { id: 13982380, title: 'Classic massage + Infrared capsule', prepaid: 'forbidden', is_composite: true },
        ...(multi ? [
          { id: 91203, title: 'Infrared capsule', prepaid: 'forbidden', price_min: 80, price_max: 80, seance_length: 1800 },
          { id: 91204, title: 'Other specialist only', prepaid: 'forbidden' },
        ] : []),
      ];
      if (scenario === 'multi-renamed-catalog') {
        return success({ services: services.map((item) => ({ ...item, title: 'Changed catalog title', price_min: 900, price_max: 900 })) });
      }
      if (!multi || !staffId) return success({ services });
      return success({ services: services.filter(({ id }) => multiStaff.get(id)?.includes(staffId)).map((service) =>
        service.id === 91201 ? { ...service, price_min: 95, price_max: 95, seance_length: 1500 } : service) });
    }
    if (resource === 'book_staff') {
      assert.deepEqual(rest, []);
      if (multi) {
        const ids = url.searchParams.getAll('service_ids[]').map(Number);
        if (!ids.length) return success([...new Set([...multiStaff.values()].flat())].map((id) => ({ id, name: `Specialist ${id}` })));
        assert.equal(ids.length, 1);
        assert.ok(multiStaff.has(ids[0]));
        appendFileSync(journal, `ASSIGNMENTS ${headers.get('accept-language')} ${ids[0]}\n`);
        return success(multiStaff.get(ids[0]).map((id) => ({ id, name: `Specialist ${id}` })));
      }
      assert.match(url.search, /^(|\?service_ids%5B%5D=(91201|13982355|13982379|13982380))$/);
      return success([
        ...(url.searchParams.get('service_ids[]') === '13982380' ? [{ id: 91603, name: 'Other specialist' }] : []),
        { id: 91601, name: 'Example specialist', bookable: false },
      ]);
    }
    if (multi && (resource === 'book_dates' || resource === 'book_times')) {
      const ids = url.searchParams.getAll('service_ids[]').map(Number);
      const staff = resource === 'book_dates' ? Number(url.searchParams.get('staff_id')) : Number(rest[0]);
      assert.deepEqual(ids, [...new Set(ids)].sort((a, b) => a - b));
      assert.ok(ids.every((id) => multiStaff.has(id)));
      if (ids.length > 1) assert.ok(ids.every((id) => multiStaff.get(id).includes(staff)));
      appendFileSync(journal, `WINDOW ${headers.get('accept-language')} ${staff} ${ids.join(',')}\n`);
      const hasSlot = ids.length === 1 ||
        (scenario !== 'multi-no-window' && !(scenario === 'multi-next-staff' && staff === 91601));
      if (resource === 'book_dates') return success({ booking_dates: hasSlot ? [date] : [] });
      assert.equal(rest[1], date);
      return success(hasSlot ? [{ datetime, time: '23:20', seance_length: 1800, sum_length: ids.length * 1800 + 300 }] : []);
    }
    if (resource === 'book_dates') {
      assert.deepEqual(rest, []);
      assert.match(url.search, /^\?service_ids%5B%5D=(13982355|13982379|13982380|91201)&staff_id=(0|91601)$/);
      if (landing) assert.equal(url.searchParams.get('staff_id'), '0');
      return success({ booking_dates: [date] });
    }
    if (resource === 'book_times') {
      assert.equal(rest[1], date);
      assert.ok(['0', '91601', '91603'].includes(rest[0]));
      assert.match(url.search, /^\?service_ids%5B%5D=(13982355|13982379|13982380|91201)$/);
      if (landing) assert.equal(rest[0], '0');
      const lostSlot = scenario === 'lp-conflict' && readFileSync(journal, 'utf8').includes('POST book_check\n');
      if (lostSlot) return success([{ datetime: `${date}T15:20:00+04:00`, time: '15:20' }]);
      const noSlot = scenario === 'empty-time' || (scenario === 'package-any-no-slot' && rest[0] !== '0');
      return success(noSlot ? [] : [{ datetime, time: '23:20' }]);
    }
    assert.equal(resource, 'book_record');
    if (multi) {
      const appointment = JSON.parse(readFileSync(`${scenarioFile}.selection`, 'utf8'));
      const part = Number(rest[0]) - 12345;
      assert.deepEqual(rest, [String(12345 + part), `${receiptHash}-${part}`]);
      assert.equal(url.search, '');
      let ids = appointment.services;
      if (scenario === 'multi-missing-detail') ids = ids.slice(0, 1);
      if (scenario === 'multi-extra-detail') ids = [...ids, 999];
      if (scenario === 'multi-duplicate-detail') ids = [...ids, ids[0]];
      if (scenario === 'multi-composite-expanded') ids = part === 0 ? [91201] : [91203];
      if (scenario === 'multi-composite-parts') ids = part === 0 ? [91201] : [13982379];
      const staff = scenario === 'multi-wrong-staff' ? 91605 : appointment.staff_id;
      return Response.json({
        id: 12345 + part, datetime: part === 0 ? new Date(datetime).toISOString() : `${date}T01:20:00.123+04:00`,
        deleted: false, length: scenario === 'multi-composite-parts' ? 3600
          : ids.length * 1800 + (scenario === 'multi-receipt-hold' ? 600 : 300),
        services: ids.map((id) => ({ id, title: `Service ${id}`,
          ...(scenario === 'multi-wrong-quantity' && id === ids[0] ? { amount: 2 } : {}) })),
        staff: { id: staff, name: `Specialist ${staff}` }, record_hash: `${receiptHash}-${part}`,
      });
    }
    if (scenario.startsWith('package-')) {
      const part = packageParts.find(({ id }) => String(id) === rest[0]);
      assert.ok(part);
      assert.deepEqual(rest, [String(part.id), `${receiptHash}-${part.id}`]);
      assert.equal(url.search, '');
      if (scenario === 'package-unreadable' && part.id === 12346) return new Response(null, { status: 403 });
      const first = part.id === 12345;
      const massage = scenario === 'package-classic'
        ? { id: 13982356, title: 'Classic massage' }
        : { id: 13982355, title: 'Sports massage' };
      return Response.json({
        ...part,
        ...(scenario === 'package-wrong-start' && first ? { datetime: `${date}T00:25:00.123+0400` } : {}),
        deleted: scenario === 'package-deleted' && !first,
        services: scenario === 'package-grouped' ? [{ id: 13982379, title: 'Sports massage + Infrared capsule' }]
          : [first ? massage : { id: 91203, title: 'Infrared capsule' }],
        record_hash: `${receiptHash}-${part.id}`,
      });
    }
    assert.deepEqual(rest, ['12345', receiptHash]);
    assert.equal(url.search, '');
    if (scenario === 'no-details') return new Response(null, { status: 403 });
    return Response.json({
      id: 12345, datetime: new Date(datetime).toISOString(), deleted: false,
      services: [{ id: landing ? Number(readFileSync(`${scenarioFile}.service`, 'utf8')) : 13982355 }],
      staff: { id: 91601, name: 'Example specialist', private: 'fixture-private-upstream-error' },
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
  if (multi) {
    assert.ok(appointment.services.every((id) => multiStaff.get(id)?.includes(appointment.staff_id)));
    assert.deepEqual(appointment.services, [...new Set(appointment.services)].sort((a, b) => a - b));
    appendFileSync(journal, `APPOINTMENT ${resource} ${appointment.staff_id} ${appointment.services.join(',')}\n`);
  } else {
    assert.ok([0, 91601, 91603].includes(appointment.staff_id));
    assert.equal(appointment.services.length, 1);
    assert.ok([13982355, 91201, ...packageIds].includes(appointment.services[0]));
  }
  assert.deepEqual(appointment, { id: 1, staff_id: appointment.staff_id, services: appointment.services, datetime });
  if (landing) assert.equal(appointment.staff_id, 0);

  if (resource === 'book_check') {
    assert.deepEqual(Object.keys(payload), ['appointments']);
    if (needsConcreteStaff && [0, 91603].includes(appointment.staff_id)) {
      return Response.json({ success: false, data: null, meta: { message: 'fixture-private-upstream-error' } }, { status: 404 });
    }
    if (scenario === 'check-conflict' || scenario === 'lp-conflict' || scenario === 'multi-check-conflict') return reject(433);
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
  if (landing) writeFileSync(`${scenarioFile}.service`, String(appointment.services[0]));
  if (needsConcreteStaff) assert.equal(appointment.staff_id, 91601);
  assert.deepEqual(Object.keys(payload).sort(), ['appointments', ...('comment' in payload ? ['comment'] : []), 'email', 'fullname', 'phone']);
  assert.match(payload.email, /^visitor\d*@example\.test$/);
  if (scenario === 'phone-uae') assert.equal(payload.phone, '+971501234567');
  else if (scenario === 'phone-uk') assert.equal(payload.phone, '+442079460958');
  else assert.match(payload.phone, /^\+97150\d{7}$/);
  assert.equal(payload.fullname, 'fixture-private-fullname');
  if ('comment' in payload) {
    assert.ok(typeof payload.comment === 'string' && payload.comment.length <= 1000);
    appendFileSync(`${scenarioFile}.comments`, JSON.stringify(payload.comment) + '\n');
  }
  if (scenario === 'record-sms') return reject(432);
  if (scenario === 'multi-create-conflict') return reject(433);
  if (scenario === 'lp-invalid-phone') return reject(431);
  if (scenario === 'record-429') return new Response(null, { status: 429, headers: { 'Retry-After': 'Tue, 01 Jan 2030 00:00:00 GMT' } });
  if (scenario === 'bad-receipt' || scenario === 'lp-unknown') return success([{ id: 2, record_id: 12345, record_hash: receiptHash }], 201);
  if (['hold-record', 'multi-hold-record', 'multi-receipt-hold'].includes(scenario)) {
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
  if (multi) {
    writeFileSync(`${scenarioFile}.selection`, JSON.stringify(appointment));
    const split = ['multi-composite-parts', 'multi-composite-expanded'].includes(scenario);
    return success(Array.from({ length: split ? 2 : 1 }, (_, part) => ({
      id: split ? 150 + part : 1, record_id: 12345 + part, record_hash: `${receiptHash}-${part}`,
    })).reverse(), 201);
  }
  if (scenario.startsWith('package-') || scenario === 'unexpected-multiple') {
    const useComponentIds = scenario !== 'package-grouped' && scenario !== 'unexpected-multiple';
    const receipts = packageParts.map(({ id }, index) => ({
      id: useComponentIds ? appointment.services[0] * 10 + index : appointment.id,
      record_id: id,
      record_hash: `${receiptHash}-${id}`,
    }));
    if (scenario === 'package-invalid-id') receipts[0].id = null;
    if (scenario === 'package-partial' || scenario === 'package-grouped') return success(receipts.slice(0, 1), 201);
    if (scenario === 'package-duplicate') return success([receipts[0], receipts[0]], 201);
    return success(receipts.reverse(), 201);
  }
  return success([{ id: 1, record_id: 12345, record_hash: receiptHash }], 201);
};
