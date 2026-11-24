import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-record-'));
const scenarioFile = path.join(dir, 'scenario');
const journal = `${scenarioFile}.journal`;
const marker = `${scenarioFile}.created`;
const release = `${scenarioFile}.release`;
const comments = `${scenarioFile}.comments`;
const selectionFile = `${scenarioFile}.selection`;
const preload = new URL('../e2e/fixtures/altegio-record.mjs', import.meta.url).href;
const day = 86_400_000;
const date = new Date(Date.now() + 7 * day).toISOString().slice(0, 10);
const datetime = `${new Date(Date.now() + 6 * day).toISOString().slice(0, 10)}T23:20:00.123+03:00`;
const bookingOrigin = 'https://booking.fixture.test';
const ipHeader = 'x-fixture-ip';
const secrets = /fixture-partner-token|fixture-record-hash-secret|fixture-private-|visitor\d*@example\.test|\+97150\d{7}|\+442079460958/;
const env = {
  ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
  ALTEGIO_PARTNER_TOKEN: 'fixture-partner-token',
  ALTEGIO_CURRENCY: 'AED',
  BOOKING_ORIGIN: bookingOrigin,
  BOOKING_CLIENT_IP_HEADER: ipHeader,
  RECORD_FIXTURE_SCENARIO: scenarioFile,
  RECORD_FIXTURE_DATETIME: datetime,
  RECORD_FIXTURE_DATE: date,
};

let nextPhone = 1;
let nextAddress = 1;
function request(overrides = {}) {
  const number = nextPhone++;
  return {
    idempotencyKey: randomUUID(), serviceId: 13982355, staffId: 0, datetime, locale: 'en', consent: true,
    contact: { fullname: 'fixture-private-fullname', phone: `+97150${String(number).padStart(7, '0')}`, email: `visitor${number}@example.test` },
    ...overrides,
  };
}

async function scenario(name) {
  for (const file of [marker, release, comments, selectionFile]) await fs.rm(file, { force: true });
  await fs.writeFile(journal, '');
  await fs.writeFile(scenarioFile, name);
}

async function history() {
  return (await fs.readFile(journal, 'utf8')).trim().split('\n').filter(Boolean);
}

async function waitForCall(operation) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if ((await history()).includes(operation)) return;
    await delay(20);
  }
  assert.fail(`CRM request did not start: ${operation}`);
}

function run(check, override = {}) {
  return withProductionServer(async (origin, logs) => {
    try {
      await check(origin, logs);
    } finally {
      assert.doesNotMatch(logs(), secrets);
    }
  }, { preload, env: { ...env, ...override } });
}

async function post(origin, body, { status, code, ip, headers, retryAfter, raw } = {}) {
  const response = await fetch(`${origin}/api/booking/record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: bookingOrigin, 'Sec-Fetch-Site': 'same-origin',
      [ipHeader]: ip ?? `192.0.2.${nextAddress++}`, ...headers,
    },
    body: raw ?? JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.doesNotMatch(text, secrets);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  if (retryAfter !== undefined) assert.equal(response.headers.get('retry-after'), retryAfter);
  if (status !== undefined) assert.equal(response.status, status, text);
  const json = JSON.parse(text);
  if (code) assert.equal(json.error.code, code, text);
  return { status: response.status, ...json };
}

async function lookup(origin, { idempotencyKey, recoveryKey }, status, overrides = {}) {
  const response = await fetch(`${origin}/api/booking/record/status`, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: bookingOrigin, 'Sec-Fetch-Site': 'same-origin', [ipHeader]: '192.0.2.253',
      ...overrides,
    },
    body: JSON.stringify({ idempotencyKey, recoveryKey, locale: 'en' }),
  });
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-booking-outcome'), [201, 202, 409].includes(status) ? 'stored' : null);
  const text = await response.text();
  assert.doesNotMatch(text, secrets);
  return JSON.parse(text).data;
}

const createCall = 'POST book_record';
const checkCall = 'POST book_check';
const confirmed = { status: 'created', recordId: 12345, serviceId: 13982355, datetime, staff: { id: 91601, name: 'Example specialist' } };

async function checkServiceSets(origin) {
  const serviceIds = [91201, 13982355];
  const specialist = { id: 91601, name: 'Specialist 91601' };
  const setRequest = (ids = serviceIds, overrides = {}) => request({
    serviceId: undefined, serviceIds: ids, recoveryKey: randomUUID(), ...overrides,
  });
  const created = (ids, staff = specialist) => ({
    status: 'created', recordId: 12345, serviceIds: ids, services: ids.map((id) => ({ id, title: `Service ${id}` })),
    datetime, staff, durationSeconds: ids.length * 1800 + 300,
  });
  const slot = (ids) => ({ datetime, time: '00:20', durationSeconds: ids.length * 1800 + 300 });
  const triple = [91201, 91203, 13982355];
  const disjoint = [91204, 13982355];

  async function get(resource, ids, options = {}, status = 200) {
    const query = new URLSearchParams(Object.entries(options));
    ids.forEach((id) => query.append('serviceIds', String(id)));
    const response = await fetch(`${origin}/api/booking/${resource}?${query}`);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const json = await response.json();
    return json.data ?? json.error;
  }

  await scenario('multi-normal');
  for (const [ids, legacy] of [[[], undefined], [[0], undefined], [[null], undefined], [['91201'], undefined],
    [[1.5], undefined], [[Number.MAX_SAFE_INTEGER + 1], undefined], [serviceIds, serviceIds[0]], [[91201], 13982355]]) {
    const result = await post(origin, setRequest(ids, { serviceId: legacy }), { status: 400, code: 'INVALID_FIELDS' });
    assert.deepEqual(result.error.fields, ['serviceIds']);
  }
  for (const [ids, opts] of [[[''], {}], [[0], {}], [[91201], { serviceId: 13982355 }], [serviceIds, { serviceId: 91201 }]]) {
    assert.equal((await get('staff', ids, opts, 400)).code, 'INVALID_QUERY');
  }
  assert.deepEqual(await history(), []);
  assert.deepEqual(await get('staff', [91201, 91201], { serviceId: 91201 }), {
    serviceIds: [91201], staff: [specialist, { id: 91602, name: 'Specialist 91602' }, { id: 91603, name: 'Specialist 91603' }],
  });
  assert.deepEqual(await get('staff', [13982355, 91203, 91201, 91203], { locale: 'ru' }), {
    serviceIds: triple, staff: [specialist],
  });
  const dates = { staffId: 0, locale: 'ru' };
  const times = { ...dates, date };
  assert.deepEqual(await get('dates', triple, dates), { serviceIds: triple, staffId: 0, dates: [date] });
  assert.deepEqual(await get('times', triple, times), { serviceIds: triple, staffId: 0, date, times: [slot(triple)] });
  assert.deepEqual(await get('times', serviceIds, { ...times, staffId: 91602 }), {
    serviceIds, staffId: 91602, date, times: [slot(serviceIds)],
  });
  assert.deepEqual(await get('staff', disjoint), { serviceIds: disjoint, staff: [] });
  assert.deepEqual(await get('dates', disjoint, dates), { serviceIds: disjoint, staffId: 0, dates: [] });
  assert.deepEqual(await get('times', disjoint, times), { serviceIds: disjoint, staffId: 0, date, times: [] });
  assert.equal((await get('times', triple, { ...times, staffId: 91602 }, 404)).code, 'STAFF_NOT_FOUND');
  assert.equal((await get('staff', [91201, 99999], {}, 404)).code, 'SERVICE_NOT_FOUND');
  const availableCalls = await history();
  assert.ok(availableCalls.includes('WINDOW ru-RU 91601 91201,91203,13982355'));
  assert.ok(availableCalls.includes('WINDOW ru-RU 91602 91201,13982355'));
  assert.ok(availableCalls.includes('ASSIGNMENTS ru-RU 91203'));

  await scenario('multi-service-removed');
  assert.equal((await get('times', triple, times, 404)).code, 'SERVICE_NOT_FOUND');
  await post(origin, setRequest(triple), { status: 404, code: 'SERVICE_NOT_FOUND' });
  assert.deepEqual(await history(), ['GET book_services', 'GET book_services']);

  await scenario('multi-normal');
  const home = setRequest([13982355, 91201, 13982355]);
  const same = { ...home, serviceIds };
  assert.deepEqual((await post(origin, home, { status: 201 })).data, created(serviceIds));
  assert.deepEqual((await post(origin, same, { status: 201 })).data, created(serviceIds));
  assert.deepEqual(await lookup(origin, home, 201), created(serviceIds));
  assert.deepEqual(await lookup(origin, { ...home, idempotencyKey: randomUUID() }, 202), { status: 'unknown' });
  assert.deepEqual(await lookup(origin, { ...home, recoveryKey: randomUUID() }, 202), { status: 'unknown' });
  await lookup(origin, { ...home, recoveryKey: undefined }, 400);
  await lookup(origin, home, 403, { Origin: 'https://foreign.fixture.test' });
  await post(origin, { ...home, serviceIds: triple }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await history()).filter((call) => call === createCall).length, 1);
  assert.deepEqual((await post(origin, { ...home, serviceIds: triple, idempotencyKey: randomUUID() }, { status: 201 })).data, created(triple));
  const calls = await history();
  for (const ids of [serviceIds, triple]) {
    assert.equal(calls.filter((call) => call === `APPOINTMENT book_check 91601 ${ids.join(',')}`).length, 1);
    assert.equal(calls.filter((call) => call === `APPOINTMENT book_record 91601 ${ids.join(',')}`).length, 1);
  }

  for (const [source, locale, extra] of [
    ['3d', 'ru', { staffId: 91601, body3d: { model: 'female', markers: [{ zoneId: 'knee_l' }] } }],
    ['lp', 'en', { condition: 'fixture-private-note' }],
    ['lp', 'ru', { condition: 'fixture-private-note' }],
  ]) {
    for (const ids of [serviceIds, triple]) {
      await scenario('multi-normal');
      const input = setRequest(ids, { source, locale, ...extra });
      assert.deepEqual((await post(origin, input, { status: 201 })).data, created(ids));
      assert.ok((await history()).includes(`APPOINTMENT book_record 91601 ${ids.join(',')}`));
      assert.ok((await history()).includes(`WINDOW ${locale === 'ru' ? 'ru-RU' : 'en-US'} 91601 ${ids.join(',')}`));
      assert.match(await fs.readFile(comments, 'utf8'), source === 'lp' ? /LP/ : /3D/);
    }
  }
  await scenario('empty-201');
  const oldHome = request();
  assert.deepEqual((await post(origin, oldHome, { status: 201 })).data, confirmed);
  const { serviceId, ...oldHomePayload } = oldHome;
  const { serviceId: ignored, ...expected } = confirmed;
  assert.equal(ignored, serviceId);
  assert.deepEqual((await post(origin, { ...oldHomePayload, serviceIds: [serviceId] }, { status: 201 })).data, {
    ...expected, serviceIds: [serviceId], services: [{ id: serviceId, title: 'Sports massage' }],
  });
  assert.equal((await history()).filter((call) => call === createCall).length, 1);

  await scenario('multi-next-staff');
  assert.deepEqual(await get('times', serviceIds, times), { serviceIds, staffId: 0, date, times: [slot(serviceIds)] });
  assert.deepEqual((await post(origin, setRequest(), { status: 201 })).data,
    created(serviceIds, { id: 91602, name: 'Specialist 91602' }));

  await scenario('multi-no-window');
  assert.equal((await get('times', [13982355], times)).times.length, 1);
  assert.deepEqual((await get('times', serviceIds, times)).times, []);
  assert.deepEqual((await get('dates', serviceIds, dates)).dates, []);
  await post(origin, setRequest(), { status: 409, code: 'SLOT_TAKEN' });
  assert.ok(!(await history()).includes(checkCall));

  for (const [mode, ids, code, status, overrides, sent] of [
    ['multi-normal', disjoint, 'STAFF_NOT_FOUND', 404],
    ['multi-normal', triple, 'STAFF_NOT_FOUND', 404, { staffId: 91602 }],
    ['multi-normal', [91201, 99999], 'SERVICE_NOT_FOUND', 404],
    ['multi-normal', [91201, 13983057], 'PREPAYMENT_REQUIRED', 422, { source: 'lp' }],
    ['multi-normal', serviceIds, 'INVALID_FIELDS', 400, { source: 'lp', staffId: 91601 }],
    ['multi-check-conflict', serviceIds, 'SLOT_TAKEN', 409],
    ['multi-create-conflict', serviceIds, 'SLOT_TAKEN', 409, {}, true],
  ]) {
    await scenario(mode);
    await post(origin, setRequest(ids, overrides), { status, code });
    assert.equal((await history()).includes(createCall), Boolean(sent));
  }

  const mixed = [91201, 13982379];
  await scenario('multi-normal');
  assert.deepEqual((await post(origin, setRequest(mixed), { status: 201 })).data, created(mixed));
  await scenario('multi-composite-parts');
  const parts = (await post(origin, setRequest(mixed), { status: 201 })).data;
  assert.deepEqual(parts.serviceIds, mixed);
  assert.deepEqual(parts.parts.map(({ recordId, title }) => [recordId, title]), [[12345, 'Service 91201'], [12346, 'Service 13982379']]);
  assert.equal(parts.durationSeconds, 7200);

  for (const mode of ['multi-missing-detail', 'multi-extra-detail', 'multi-duplicate-detail', 'multi-wrong-staff',
    'multi-wrong-quantity', 'multi-composite-expanded']) {
    await scenario(mode);
    const input = setRequest(mode === 'multi-composite-expanded' ? mixed : serviceIds);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await post(origin, input, { status: 202 })).data.status, 'unknown');
    }
    assert.deepEqual(await lookup(origin, input, 202), { status: 'unknown' });
    assert.equal((await history()).filter((call) => call === createCall).length, 1);
    await post(origin, { ...input, serviceIds: triple }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  }

  await scenario('multi-hold-record');
  const input = setRequest();
  const pending = post(origin, input, { status: 201 });
  try {
    await waitForCall(createCall);
    assert.equal((await post(origin, { ...input, serviceIds: [...serviceIds].reverse() }, { status: 202, retryAfter: '2' })).data.status, 'processing');
    assert.deepEqual(await lookup(origin, input, 202), { status: 'processing' });
  } finally {
    await fs.writeFile(release, '');
    await pending;
  }
  assert.deepEqual((await post(origin, input, { status: 201 })).data, created(serviceIds));
  assert.deepEqual(await lookup(origin, input, 201), created(serviceIds));
  assert.equal((await history()).filter((call) => call === createCall).length, 1);
}

async function check3DRecord(origin) {
  const body3d = {
    model: 'female', generalNote: 'fixture-private-general\r\nSecond line',
    markers: [{ zoneId: 'knee_l', note: 'fixture-private-marker', position: [101, 202, 303] }, { zoneId: 'neck_collar', intensity: 9 }],
  };
  const input = request({ source: '3d', locale: 'ru', age: 33, body3d });
  const options = { status: 400, code: 'INVALID_FIELDS' };
  const invalidDetails = [
    [undefined, ['body3d']],
    [{ ...body3d, model: 'other' }, ['model']],
    [{ ...body3d, generalNote: 'x'.repeat(401) }, ['generalNote']],
    [{ ...body3d, markers: Array(11).fill(body3d.markers[0]) }, ['markers']],
    [{ ...body3d, markers: [{ zoneId: 'knee' }] }, ['markers']],
    [{ ...body3d, markers: [{ zoneId: 'chest_l', intensity: 6 }] }, ['markers']],
    [{ ...body3d, markers: [{ zoneId: 'knee_l', intensity: 11 }] }, ['markers']],
    [{ ...body3d, markers: [{ zoneId: 'knee_l', note: 'x'.repeat(201) }] }, ['markers']],
  ];
  for (const [details, fields] of invalidDetails) {
    assert.deepEqual((await post(origin, { ...input, body3d: details }, options)).error.fields, fields);
  }
  assert.deepEqual((await post(origin, { ...input, source: undefined }, options)).error.fields, ['source']);
  assert.deepEqual((await post(origin, { ...input, consent: false }, options)).error.fields, ['consent']);
  assert.deepEqual(await history(), []);

  assert.deepEqual((await post(origin, input, { status: 201 })).data, confirmed);
  const comment = JSON.parse(await fs.readFile(comments, 'utf8'));
  assert.match(comment, /^\[Сайт\/3D\].*33/m);
  assert.match(comment, /Колено, левая сторона \/ Knee, left side.*5\/10.*fixture-private-marker/);
  assert.match(comment, /9\/10/);
  assert.match(comment, /fixture-private-general\nSecond line/);
  assert.doesNotMatch(comment, /101,202,303|healthConsent/);
  const equivalentMarkers = [{ ...body3d.markers[0], intensity: 5 }, body3d.markers[1]];
  await post(origin, { ...input, body3d: { ...body3d, markers: equivalentMarkers, healthConsent: true } }, { status: 201 });
  await post(origin, { ...input, body3d: { ...body3d, generalNote: 'Changed note' } }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await history()).filter((call) => call === createCall).length, 1);

  await scenario('empty-201');
  const full = request({ source: '3d', body3d: {
    model: 'male',
    generalNote: '界'.repeat(400),
    markers: Array.from({ length: 10 }, (_, index) => ({
      zoneId: index % 2 ? 'quadriceps_r' : 'hamstrings_l', intensity: index + 1, note: '界'.repeat(190) + '😀'.repeat(5),
    })),
  } });
  const raw = JSON.stringify(full).replaceAll('界', '\\u754c');
  assert.ok(Buffer.byteLength(raw) > 8192);
  await post(origin, full, { status: 201, raw });
  const bounded = JSON.parse(await fs.readFile(comments, 'utf8'));
  assert.ok(bounded.length <= 1000 && bounded.isWellFormed());
  assert.match(bounded, /…/);
  assert.equal((bounded.match(/Back of thigh, left side/g) ?? []).length, 5);
  assert.equal((bounded.match(/Front thigh, right side/g) ?? []).length, 5);
  assert.deepEqual(bounded.match(/\b\d+\/10\b/g), Array.from({ length: 10 }, (_, index) => `${index + 1}/10`));
}

try {
  await scenario('empty-201');
  await run(async (origin) => {
    await post(origin, request(), { status: 503, code: 'BOOKING_UNAVAILABLE' });
    assert.deepEqual(await history(), []);
  }, { BOOKING_ORIGIN: '' });

  await run(check3DRecord);
  await run(checkServiceSets);
  await scenario('empty-201');
  await run(async (origin, logs) => {
    await post(origin, request(), { status: 403, code: 'INVALID_ORIGIN', headers: { Origin: 'https://elsewhere.fixture.test' } });
    await post(origin, request(), { status: 403, code: 'INVALID_ORIGIN', headers: { 'Sec-Fetch-Site': 'cross-site' } });
    await post(origin, request(), { status: 403, code: 'INVALID_ORIGIN', ip: '192.0.2.1, 127.0.0.1' });
    await post(origin, request(), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', headers: { 'Content-Type': 'text/plain' } });
    await post(origin, request(), { status: 413, code: 'PAYLOAD_TOO_LARGE', raw: 'x'.repeat(9000) });
    await post(origin, null, { status: 400, code: 'INVALID_BODY' });
    for (const email of ['', undefined, 'invalid-email', null, 'a'.repeat(255)]) {
      const input = request();
      input.contact.email = email;
      const result = await post(origin, input, { status: 400, code: 'INVALID_FIELDS' });
      assert.deepEqual(result.error.fields, ['email']);
    }
    for (const phone of ['', '0501234567', '+971', '+44 20', '123+442079460958', '+971+442079460958']) {
      const input = request();
      input.contact.phone = phone;
      const result = await post(origin, input, { status: 400, code: 'INVALID_FIELDS' });
      assert.deepEqual(result.error.fields, ['phone']);
    }
    const invalid = await post(origin, request({ consent: false, datetime: '2026-02-31T10:00:00+04:00', age: 121, condition: 'x'.repeat(1001) }), {
      status: 400, code: 'INVALID_FIELDS',
    });
    assert.deepEqual(invalid.error.fields, ['datetime', 'consent', 'age', 'condition']);
    assert.deepEqual(await history(), []);

    const successful = request();
    const created = await post(origin, successful, { status: 201 });
    assert.deepEqual(created.data, confirmed);
    assert.deepEqual(await history(), ['GET book_services', 'GET book_times', checkCall, createCall, 'GET book_record']);
    assert.deepEqual((await post(origin, successful, { status: 201 })).data, confirmed);
    await post(origin, { ...successful, locale: 'ru' }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal((await history()).filter((call) => call === createCall).length, 1);

    for (const [fixture, phone] of [['phone-uae', '+971 50 123-45-67'], ['phone-uk', '+44 20 7946-0958']]) {
      await scenario(fixture);
      const input = request();
      input.contact.phone = phone;
      assert.deepEqual((await post(origin, input, { status: 201 })).data, confirmed);
      assert.equal((await history()).filter((call) => call === createCall).length, 1);
    }

    await scenario('empty-201');
    const details = request({ age: 33, condition: 'fixture-private-note ' + '😀x'.repeat(325) });
    const saved = await post(origin, details, { status: 201 });
    assert.deepEqual(saved.data, confirmed);
    const comment = JSON.parse(await fs.readFile(comments, 'utf8'));
    assert.ok(comment.length <= 1000);
    assert.ok(comment.isWellFormed());
    assert.ok(comment.startsWith('[Сайт/форма] Age: 33\nCondition: fixture-private-note '));
    assert.ok(comment.endsWith('…'));
    const afterComment = ['GET book_services', 'GET book_times', checkCall, createCall, 'GET book_record'];
    assert.deepEqual(await history(), afterComment);
    assert.deepEqual((await post(origin, details, { status: 201 })).data, saved.data);
    await post(origin, { ...details, age: 34 }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    assert.deepEqual(await history(), afterComment);

    await scenario('checked-json');
    assert.deepEqual((await post(origin, request({ locale: 'ru', staffId: 91601 }), { status: 201 })).data, confirmed);
    assert.ok((await history()).includes('GET book_staff'));

    await scenario('no-details');
    const optional = await post(origin, request({ serviceId: 91201 }), { status: 201 });
    assert.deepEqual(optional.data, { status: 'created', recordId: 12345, serviceId: 91201, datetime });

    await scenario('package-confirmed');
    const packageRequest = request({ serviceId: 13982379, staffId: 91601 });
    const bookingPackage = await post(origin, packageRequest, { status: 201 });
    assert.deepEqual(bookingPackage.data, {
      ...confirmed, serviceId: 13982379,
      parts: [
        { recordId: 12345, title: 'Sports massage', datetime: `${date}T00:20:00.123+04:00`, durationSeconds: 2700, staff: confirmed.staff },
        { recordId: 12346, title: 'Infrared capsule', datetime: `${date}T01:05:00.123+04:00`, durationSeconds: 2700, staff: { id: 91602, name: 'Capsule operator' } },
      ],
    });
    assert.deepEqual((await post(origin, packageRequest, { status: 201 })).data, bookingPackage.data);
    assert.equal((await history()).filter((call) => call === createCall).length, 1);
    assert.equal((await history()).filter((call) => call === 'GET book_record').length, 2);

    await scenario('package-grouped');
    const grouped = await post(origin, request({ serviceId: 13982379 }), { status: 201 });
    assert.deepEqual(grouped.data, { ...confirmed, serviceId: 13982379 });

    await scenario('package-classic');
    const anyStaff = request({ serviceId: 13982380, locale: 'ru' });
    const assigned = await post(origin, anyStaff, { status: 201 });
    assert.deepEqual(assigned.data.staff, confirmed.staff);
    assert.equal(assigned.data.datetime, datetime);
    assert.deepEqual(assigned.data.parts.map(({ title }) => title), ['Classic massage', 'Infrared capsule']);
    assert.deepEqual((await post(origin, anyStaff, { status: 201 })).data, assigned.data);
    assert.deepEqual(await history(), [
      'GET book_services', 'GET book_times', checkCall, 'GET book_staff', 'GET book_times', checkCall,
      'GET book_times', checkCall, createCall, 'GET book_record', 'GET book_record',
    ]);

    await scenario('package-classic');
    const landingPackage = await post(origin, request({ source: 'lp', serviceId: 13982380, locale: 'ru' }), { status: 201 });
    assert.deepEqual(landingPackage.data, assigned.data);
    assert.match(JSON.parse(await fs.readFile(comments, 'utf8')), /^\[Сайт\/LP\]/);

    await scenario('package-classic');
    await post(origin, request({ serviceId: 13982380, locale: 'ru', staffId: 91603 }), { status: 503, code: 'BOOKING_UNAVAILABLE' });
    assert.deepEqual(await history(), ['GET book_services', 'GET book_times', checkCall]);

    await scenario('package-any-no-slot');
    await post(origin, request({ serviceId: 13982380, locale: 'ru' }), { status: 409, code: 'SLOT_TAKEN' });
    assert.deepEqual(await history(), ['GET book_services', 'GET book_times', checkCall, 'GET book_times', 'GET book_times']);

    for (const [mode, lookups] of [
      ['package-partial', 1], ['package-duplicate', 0], ['package-unreadable', 2], ['package-deleted', 2],
      ['package-wrong-start', 2], ['package-invalid-id', 0], ['unexpected-multiple', 0],
    ]) {
      await scenario(mode);
      const input = request({ serviceId: mode === 'unexpected-multiple' ? 13982355 : 13982380 });
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal((await post(origin, input, { status: 202 })).data.status, 'unknown');
      }
      assert.equal((await history()).filter((call) => call === createCall).length, 1);
      assert.equal((await history()).filter((call) => call === 'GET book_record').length, lookups);
    }

    for (const locale of ['en', 'ru']) {
      await scenario('empty-201');
      const result = await post(origin, request({ serviceId: 13983057, locale }), { status: 422, code: 'PREPAYMENT_REQUIRED' });
      assert.match(result.error.message, locale === 'en' ? /prepayment/i : /предоплата/i);
      assert.deepEqual(await history(), ['GET book_services']);
    }
    await post(origin, request({ serviceId: 91202 }), { status: 503, code: 'BOOKING_UNAVAILABLE' });
    await post(origin, request({ serviceId: 99999 }), { status: 404, code: 'SERVICE_NOT_FOUND' });
    await post(origin, request({ staffId: 91609 }), { status: 404, code: 'STAFF_NOT_FOUND' });
    await post(origin, request({ datetime: new Date(datetime).toISOString() }), { status: 409, code: 'SLOT_TAKEN' });
    assert.ok(!(await history()).includes(checkCall));

    for (const [mode, status, code, retryAfter, sent] of [
      ['empty-time', 409, 'SLOT_TAKEN', undefined, false],
      ['check-conflict', 409, 'SLOT_TAKEN', undefined, false],
      ['check-staff', 404, 'STAFF_NOT_FOUND', undefined, false],
      ['check-bad', 503, 'BOOKING_UNAVAILABLE', undefined, false],
      ['check-429', 429, 'UPSTREAM_RATE_LIMITED', '17', false],
      ['record-429', 429, 'UPSTREAM_RATE_LIMITED', 'Tue, 01 Jan 2030 00:00:00 GMT', true],
      ['record-sms', 422, 'SMS_REQUIRED', undefined, true],
    ]) {
      await scenario(mode);
      await post(origin, request(), { status, code, retryAfter });
      assert.equal((await history()).includes(createCall), sent);
    }
    assert.match(logs(), /stage: 'book_services',[\s\S]*?reason: 'unknown_prepayment'/);
    assert.match(logs(), /stage: 'book_check',[\s\S]*?httpStatus: 201,[\s\S]*?dataType: 'array'/);
    assert.match(logs(), /errorCodes: \[ '433' \]/);

    await scenario('competition');
    const [one, two] = await Promise.all([post(origin, request()), post(origin, request())]);
    assert.deepEqual([one.status, two.status].sort(), [201, 409]);
    assert.equal((one.error ?? two.error).code, 'SLOT_TAKEN');
    assert.equal((await history()).filter((call) => call === checkCall).length, 2);
    assert.equal((await history()).filter((call) => call === createCall).length, 2);

    await scenario('hold-record');
    const payload = request();
    const pending = post(origin, payload, { status: 201 });
    try {
      await waitForCall(createCall);
      const replay = await post(origin, payload, { status: 202, retryAfter: '2' });
      assert.equal(replay.data.status, 'processing');
      await post(origin, { ...payload, staffId: 91601 }, { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
      await fs.writeFile(release, '');
      assert.deepEqual((await pending).data, confirmed);
      assert.deepEqual((await post(origin, payload, { status: 201 })).data, confirmed);
      assert.equal((await history()).filter((call) => call === createCall).length, 1);
    } finally {
      await fs.writeFile(release, '');
      await pending;
    }

    await scenario('bad-receipt');
    const bad = request();
    assert.equal((await post(origin, bad, { status: 202 })).data.status, 'unknown');
    assert.equal((await post(origin, bad, { status: 202 })).data.status, 'unknown');
    assert.equal((await history()).filter((call) => call === createCall).length, 1);
    assert.ok(!(await history()).includes('GET book_record'));

    await scenario('record-timeout');
    const indeterminate = request();
    assert.equal((await post(origin, indeterminate, { status: 202 })).data.status, 'unknown');
    await fs.stat(marker);
    assert.equal((await history()).filter((call) => call === createCall).length, 1);
    const beforeReplay = await history();
    assert.equal((await post(origin, indeterminate, { status: 202 })).data.status, 'unknown');
    assert.deepEqual(await history(), beforeReplay, 'an uncertain outcome must not trigger another CRM call in this instance');

    await scenario('empty-201');
    const shared = request({ serviceId: 13983057 }).contact;
    for (let i = 0; i < 5; i++) await post(origin, request({ serviceId: 13983057, contact: shared }), { status: 422 });
    const phoneLimit = await post(origin, request({ serviceId: 13983057, contact: shared }), { status: 429, code: 'RATE_LIMITED' });
    assert.ok(phoneLimit.error);
    for (let i = 0; i < 5; i++) await post(origin, request({ serviceId: 13983057 }), { status: 422, ip: '198.51.100.8' });
    await post(origin, request(), { status: 429, code: 'RATE_LIMITED', ip: '::ffff:198.51.100.8' });
    assert.equal((await history()).length, 10);
  });

  console.log('Booking record: single services, service sets, composite confirmations, conflicts, limits and same-instance retries OK');
} finally {
  for (const file of [journal, marker, release, comments, selectionFile, scenarioFile]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
