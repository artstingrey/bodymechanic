import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Loaded only by the catalog test child process, before Next installs its fetch wrapper.
process.on('unhandledRejection', () => console.error('[catalog-unhandled-rejection]'));
const cacheDir = path.resolve('.next/cache/fetch-cache');
const writeFile = fs.writeFile;
fs.writeFile = async (file, ...args) => {
  await writeFile(file, ...args);
  if (typeof file === 'string' && path.dirname(path.resolve(file)) === cacheDir) {
    console.info('[catalog-cache-write]', path.basename(file));
  }
};

const fetchOriginal = globalThis.fetch;

async function availabilityFixture(url, resource, staffPath, date, language, signal) {
  const serviceId = url.searchParams.get('service_ids[]');
  const staffId = staffPath ?? url.searchParams.get('staff_id');
  const query = new URLSearchParams({ 'service_ids[]': serviceId });
  if (resource === 'book_dates') query.set('staff_id', staffId);
  assert.equal(url.search, `?${query}`);
  assert.match(staffId, /^(0|91601|91602|91605)$/);
  assert.ok(['13982355', '91201', '91204'].includes(serviceId));
  console.info('[availability-fixture]', resource, language, serviceId, staffId, date ?? '-');

  const scenario = readFileSync(process.env.AVAILABILITY_TEST_SCENARIO, 'utf8');
  if (scenario === 'timeout') await delay(60_000, undefined, { signal });
  if (scenario === '429') {
    const retryAfter = resource === 'book_dates' ? new Date('2030-01-01T00:00:00Z').toUTCString() : '0';
    return new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } });
  }
  if (scenario === '503') {
    return new Response('fixture raw upstream detail', { status: 503, headers: { 'Retry-After': '30' } });
  }

  const start = '2026-11-30';
  const end = '2026-12-01';
  const options = {
    '13982355:0': [start, end],
    '13982355:91601': [start],
    '13982355:91602': [end],
    '91201:0': [end],
    '91201:91605': [end],
    '91204:0': [],
  };
  const dates = options[`${serviceId}:${staffId}`];
  assert.ok(dates);
  if (resource === 'book_dates') {
    const booking_dates = scenario === 'invalid' ? ['2026-11-31'] : scenario === 'empty' ? [] : dates;
    return Response.json({ success: true, data: { booking_dates, working_dates: [start, end, '2026-12-02'] } });
  }

  assert.ok([start, end].includes(date));
  const time = staffId === '91605' ? '13:15' : '09:30';
  const datetime = date === end && staffId !== '91605' ? '2026-11-30T23:20:00.123+03:00' : `${date}T${time}:00+04:00`;
  const slots = scenario === 'invalid' ? [{ datetime: `${date}T09:30:00` }]
    : scenario === 'empty' || !dates.includes(date) ? [] : [{ time, datetime, staff_id: 'fixture raw upstream detail' }];
  return Response.json({ success: true, data: slots });
}

async function serviceStaffFixture(serviceId, language, signal) {
  const scenarioFile = process.env.SERVICE_STAFF_TEST_SCENARIO;
  if (!scenarioFile) return Response.json({ success: true, data: [] });
  const scenario = readFileSync(scenarioFile, 'utf8');
  console.info('[service-staff-fixture]', scenario, language, serviceId);
  if (scenario === '500') return new Response('fixture raw upstream detail', { status: 500 });
  if (scenario === '429') return new Response(null, { status: 429, headers: { 'Retry-After': '2' } });
  if (scenario === 'slow') {
    while (!(await fs.stat(`${scenarioFile}.release`).catch(() => null))) await delay(30, undefined, { signal });
  } else assert.equal(scenario, 'success');

  const ru = language === 'ru-RU';
  const sports = [
    { id: 91601, name: 'Alex Example', bookable: false, position: { title: ru ? 'Должность RU' : 'Position EN' },
      avatar_big: 'https://images.example.test/portrait.webp', user: { detail: 'fixture raw upstream detail' } },
    { id: 91602, name: 'Sam Example', specialization: ru ? 'Специализация RU' : 'Specialization EN',
      avatar: 'https://images.example.test/broken.webp' },
    { id: 91603, name: 'Hidden Example', hidden: 1 },
    { id: 91604, name: 'Former Example', fired: 1 },
  ];
  const lists = {
    13982355: sports,
    91201: [{ id: 91605, name: 'Taylor Example' }],
    91204: [],
  };
  assert.ok(Object.hasOwn(lists, serviceId));
  return Response.json({ success: true, data: lists[serviceId] });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== 'api.alteg.io') return fetchOriginal(input, init);

  assert.equal(init?.method ?? (input instanceof Request ? input.method : 'GET'), 'GET');
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const [, api, version, resource, location, staffPath, date, ...extra] = url.pathname.split('/');
  const business = resource === 'locations' && staffPath === 'services';
  assert.equal(headers.get('authorization'), business ? 'Bearer fixture-partner-token, User fixture-business-token' : 'Bearer fixture-partner-token');
  assert.equal(headers.get('accept'), 'application/vnd.api.v2+json');
  assert.equal(headers.get('content-type'), 'application/json');
  const language = headers.get('accept-language');
  assert.ok(language === 'ru-RU' || language === 'en-US');
  assert.equal(init?.redirect ?? input.redirect, 'error');
  const signal = init?.signal ?? input.signal;
  if (business) {
    assert.equal(url.href, `https://api.alteg.io/api/v1/locations/${process.env.ALTEGIO_LOCATION_ID}/services`);
    assert.equal(init?.cache ?? input.cache, 'no-store');
    const scenario = readFileSync(process.env.CATALOG_TEST_SCENARIO, 'utf8');
    console.info('[business-services-fixture]', scenario);
    if (scenario === 'business-forbidden') return new Response(null, { status: 403 });
    assert.equal(scenario, 'success');
    return Response.json({ success: true, data: [
      { id: 42, duration: 1200, title: 'Private fixture title', price_min: 500, technical_break_duration: 600 },
      { id: 43, duration: 0 },
      { id: 44, duration: 1200, title: 'Unpublished fixture service' },
    ] });
  }
  if (resource === 'book_dates' || resource === 'book_times') {
    assert.equal(url.origin, 'https://api.alteg.io');
    assert.equal(api, 'api');
    assert.equal(version, 'v1');
    assert.equal(location, process.env.ALTEGIO_LOCATION_ID);
    assert.equal(extra.length, 0);
    assert.equal(Boolean(staffPath && date), resource === 'book_times');
    if (resource === 'book_dates') assert.equal(staffPath, undefined);
    assert.equal(init?.cache ?? input.cache, 'no-store');
    return availabilityFixture(url, resource, staffPath, date, language, signal);
  }

  const staff = resource === 'book_staff';
  const serviceId = staff ? url.searchParams.get('service_ids[]') : null;
  if (serviceId !== null) assert.match(serviceId, /^[1-9]\d*$/);
  const query = staff ? (serviceId === null ? '' : `?service_ids%5B%5D=${serviceId}`) : '?without_seances=1';
  assert.equal(url.href, `https://api.alteg.io/api/v1/${staff ? 'book_staff' : 'book_services'}/${process.env.ALTEGIO_LOCATION_ID}${query}`);
  if (serviceId !== null) return serviceStaffFixture(serviceId, language, signal);
  const scenarioFile = staff ? process.env.STAFF_TEST_SCENARIO : process.env.CATALOG_TEST_SCENARIO;
  if (staff && !scenarioFile) return new Response(null, { status: 503 });
  const scenario = readFileSync(scenarioFile, 'utf8');
  console.info(staff ? '[staff-fixture]' : '[catalog-fixture]', scenario, language);

  // Let the 12 concurrent requests reach the cache before the upstream responds.
  if (['success', 'empty', '429', '500'].includes(scenario)) await delay(400);

  if (scenario === 'timeout') {
    assert.ok(signal);
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }
  if (scenario === 'network') throw new TypeError('fixture raw upstream detail');
  if (scenario === 'invalid-json') return new Response('fixture raw upstream detail');
  if (scenario === 'empty-body') return new Response(null);
  if (scenario === 'rejected') return Response.json({ success: false, meta: { message: 'fixture raw upstream detail' } });
  if (scenario === 'invalid-schema') return Response.json({ success: true, data: staff ? { staff: [] } : { services: null } });
  if (scenario === 'invalid-service') return Response.json({ success: true, data: { services: [{ id: 0, title: ' ' }] } });
  if (/^\d{3}$/.test(scenario)) {
    const body = scenario === '403' ? null : new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('fixture raw upstream detail'));
      },
      pull(controller) {
        controller.close();
      },
      cancel() {
        console.info('[catalog-body-cancel]', scenario);
        if (scenario === '500') throw new SyntaxError('fixture raw upstream detail');
      },
    });
    return new Response(body, { status: Number(scenario), headers: { 'Retry-After': '5' } });
  }
  if (scenario === 'empty') return Response.json({ success: true, data: staff ? [] : { services: [], categories: [] } });
  if (scenario === 'sitemap' || scenario === 'sitemap-updated') {
    const ru = language === 'ru-RU';
    const updated = scenario === 'sitemap-updated';
    if (staff) return Response.json({ success: true, data: [
      { id: updated ? 91215 : 91214, name: updated ? 'Jamie Example' : 'Taylor Example' },
      ...(!ru ? [{ id: 91216, name: 'Robin Example' }] : []),
      { id: 91220, name: 'Hidden Example', hidden: 1 },
      { id: 91221, name: 'Dismissed Example', fired: 1 },
    ] });
    const numeric = { id: updated ? 91202 : 91201, title: ru ? 'Массаж из каталога' : 'Catalog massage' };
    return Response.json({ success: true, data: { services: [
      { id: 13982355, title: ru ? 'Спортивный массаж' : 'Sports massage' },
      numeric,
      ...(!updated ? [numeric] : []),
      ...(ru ? [{ id: 91204, title: 'Только в русском каталоге' }] : []),
    ] } });
  }
  if (scenario === 'service-detail' || scenario === 'service-detail-renamed') {
    assert.equal(staff, false);
    const ru = language === 'ru-RU';
    const newTitle = ru ? 'Массаж с очень длинным названием для проверки переноса строк на узких экранах'
      : 'Massage with a very long service title for checking line breaks on narrow screens';
    return Response.json({ success: true, data: {
      category: [{ id: 20, title: ru ? 'Массаж из каталога' : 'Catalog massage' }],
      services: [
        { id: 13982355, title: ru ? 'Спортивный массаж из каталога' : 'Sports massage from CRM',
          category_id: 20, comment: ru ? 'Описание из каталога.' : 'Description from CRM.',
          price_min: 80, price_max: 160, image: 'https://images.example.test/broken.webp',
          discount: 'fixture raw upstream detail' },
        { id: 91201, title: scenario === 'service-detail-renamed' ? 'Renamed in CRM' : newTitle,
          category_id: 99, price_min: 0, price_max: 0, seance_length: 5400, image: 'https://images.example.test/live.webp' },
        { id: 91202, title: 'Lower bound massage', price_min: 55.5 },
        { id: 91203, title: 'Exact price massage', price_min: 125, price_max: 125 },
        { id: 91204, title: 'Unknown price massage', comment: '<p>fixture raw upstream detail</p>' },
        { id: 13982356, title: 'Классический массаж' },
        { id: 13982358, title: 'Тайский массаж' },
        { id: 13982379, title: 'Спортивный массаж + ИНФРАКРАСНАЯ КАПСУЛА' },
        { id: 13982380, title: 'Классический массаж + ИНФРАКРАСНАЯ КАПСУЛА' },
        { id: 13982351, title: 'ICE BATH - после массажа' },
        { id: 13983057, title: 'ФУНКЦИОНАЛЬНЫЙ ТРЕНИНГ И МОБИЛЬНОСТЬ' },
      ],
    } });
  }
  if (scenario === 'home-translations') return Response.json({ success: true, data: { services: [
    { id: 13982356, title: 'Классический массаж студии', comment: 'Актуальное описание из каталога.' },
    { id: 13982355, title: 'Спортивный массаж' },
    { id: 91206, title: 'Новая услуга', comment: 'Описание новой услуги из каталога.' },
  ] } });
  if (['home-slow', 'catalog-list-slow', 'team-list-slow', 'lp-slow'].includes(scenario)) {
    const release = `${scenarioFile}.release`;
    while (!(await fs.stat(release).catch(() => null))) {
      const signal = init?.signal ?? input.signal;
      await delay(30, undefined, { signal });
    }
  }
  if (['lp-slow', 'lp-missing', 'lp-unlisted', 'lp-unpriced'].includes(scenario)) {
    assert.equal(staff, false);
    const services = [
      { id: 91201, title: language === 'ru-RU' ? 'Комбинированный массаж с инфракрасной капсулой'
        : 'Massage with an infrared capsule and stretching', price_min: 125.5, price_max: 249.5 },
      { id: 91202, title: 'Unconfirmed session' },
      { id: 13983057, title: 'Mobility CRM', price_min: 99 },
      { id: 13982353, title: 'Ice bath CRM', price_min: 0, price_max: 0 },
      { id: 13982355, title: 'Спортивный массаж из CRM', comment: 'Описание из CRM.',
        price_min: 80, price_max: 160, seance_length: 4500, image: 'https://images.example.test/live.webp' },
      { id: 13982363, title: 'Infrared CRM', image: 'https://api.alteg.io/api/v1/private' },
      { id: 13982356, title: 'Classic CRM', price_min: 125.5, price_max: 125.5,
        image: 'https://images.example.test/broken.webp' },
    ];
    const selected = services.filter(({ id }) => {
      if (scenario === 'lp-unlisted') return id === 91201 || id === 91202;
      if (scenario === 'lp-unpriced') return id === 13982363 || id === 91202;
      return scenario !== 'lp-missing' || id !== 13982363;
    });
    return Response.json({ success: true, data: { services: selected } });
  }
  if (scenario === 'catalog-list-slow') {
    assert.equal(staff, false);
    const ru = language === 'ru-RU';
    return Response.json({ success: true, data: {
      category: [
        { id: 30, title: ru ? 'Массаж' : 'Massage' },
        { id: 20, title: ru ? 'Пустая категория' : 'Empty category' },
        { id: 10, title: ru ? 'Восстановление' : 'Recovery' },
      ],
      services: [
        { id: 93004, title: ru ? 'Первый массаж' : 'First massage', category_id: 30 },
        { id: 93003, title: ru ? 'Без категории' : 'Uncategorized' },
        { id: 93002, title: ru ? 'Второй массаж' : 'Second massage', category_id: 30 },
        { id: 93001, title: ru ? 'Исчезнувшая категория' : 'Missing category', category_id: 99 },
        { id: 93005, title: ru ? 'Тренировка' : 'Mobility session', category_id: 10 },
      ],
    } });
  }
  if (staff) {
    const profiles = [
      { id: 91216, name: ' Александра с очень длинным именем для проверки переноса строк ', bookable: false,
        specialization: language === 'ru-RU' ? ' Специализация RU ' : ' Specialization EN ',
        position: { title: ' Job title ' }, avatar: 'https://images.example.test/small.webp',
        avatar_big: 'https://images.example.test/portrait.webp', hidden: 0, fired: 0,
        user: { detail: 'fixture raw upstream detail' }, information: '<p>fixture raw upstream detail</p>',
        api_id: 'fixture raw upstream detail', user_id: 123, seances: [{ time: 'fixture raw upstream detail' }] },
      { id: 91214, name: 'Taylor Example', position: { title: ' Therapist ' },
        avatar_big: 'https://app.alteg.io/images/no-master.png', avatar: 'https://images.example.test/broken.webp' },
      { id: 91212, name: 'Sam Example', specialization: scenario === 'team-list-slow'
        ? (language === 'ru-RU' ? 'Восстановительный массаж' : 'Recovery massage') : ' ', position: [],
        avatar_big: 'https://user:password@images.example.test/portrait.webp', avatar: '/relative.webp' },
      { id: 91211, name: 'Robin Example', position: {}, avatar: 'https://app.alteg.io/images/no-master.png' },
      { id: 91213, name: 'Casey Example', avatar: 'https://images.example.test/no-master.png' },
      { id: 91215, name: 'Jamie Example', avatar: 'https://api.alteg.io/api/v1/private' },
      { id: 91220, name: 'Hidden Example', hidden: 1 },
      { id: 91221, name: 'Dismissed Example', fired: 1 },
    ];
    const invalid = {
      'invalid-member': null,
      'invalid-id': { id: 0, name: 'Example' },
      'unsafe-id': { id: Number.MAX_SAFE_INTEGER + 1, name: 'Example' },
      'string-id': { id: '42', name: 'Example' },
      'blank-name': { id: 42, name: '  ' },
      'invalid-name': { id: 42, name: false },
      'duplicate-id': profiles[0],
    };
    if (Object.hasOwn(invalid, scenario)) return Response.json({ success: true, data: [profiles[0], invalid[scenario]] });
    assert.ok(['success', 'home-slow', 'home-single', 'team-list-slow'].includes(scenario), scenario);
    return Response.json({ success: true, data: scenario === 'home-single' ? profiles.slice(0, 1) : profiles });
  }
  if (scenario === 'home' || scenario === 'home-slow' || scenario === 'home-single') {
    const services = [
      { id: 91201, title: 'Терапевтический массаж с очень длинным названием для проверки переноса строк',
        price_min: 120, price_max: 120, seance_length: 6000, image: 'https://images.example.test/live.webp',
        comment: language === 'ru-RU' ? ' Массаж для восстановления после нагрузки. ' : ' Massage for post-exercise recovery. ' },
      { id: 91202, title: language === 'ru-RU' ? 'Массаж с диапазоном цен' : 'Range massage',
        price_min: 80, price_max: 160, image: 'https://images.example.test/broken.webp', seance_length: null },
      { id: 91203, title: 'Minimum massage', price_min: 55.5, comment: '  ' },
      { id: 91204, title: 'Zero price massage', price_min: 0, price_max: 0 },
      { id: 91205, title: 'Unknown price massage', comment: '<p>fixture raw upstream detail</p>', image: 'https://api.alteg.io/api/v1/private' },
    ];
    return Response.json({ success: true, data: { services: scenario === 'home-single' ? services.slice(0, 1) : services } });
  }
  assert.ok(['success', 'business-forbidden'].includes(scenario), scenario);
  return Response.json({
    success: true,
    data: {
      category: [{ id: 20, title: ' Massage ' }],
      services: [
        { id: 42, title: ' Massage ', category_id: 20, price_min: 0, price_max: 55, discount: 20,
          seance_length: 5400, active: 0, image: 'https://images.example.test/service.webp', comment: ' Public service description. ' },
        { id: 43, title: 'Other', image: 'javascript:alert(1)', comment: '<p>fixture raw upstream detail</p>', seance_length: null },
      ],
    },
  });
};
