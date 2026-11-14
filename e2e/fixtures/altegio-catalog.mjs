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
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== 'api.alteg.io') return fetchOriginal(input, init);

  const staff = url.pathname.startsWith('/api/v1/book_staff/');
  const resource = staff ? 'book_staff' : 'book_services';
  const query = staff ? '' : '?without_seances=1';
  assert.equal(url.href, `https://api.alteg.io/api/v1/${resource}/${process.env.ALTEGIO_LOCATION_ID}${query}`);
  assert.equal(init?.method ?? (input instanceof Request ? input.method : 'GET'), 'GET');
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  assert.equal(headers.get('authorization'), 'Bearer fixture-partner-token');
  assert.equal(headers.get('accept'), 'application/vnd.api.v2+json');
  assert.equal(headers.get('content-type'), 'application/json');
  const language = headers.get('accept-language');
  assert.ok(language === 'ru-RU' || language === 'en-US');
  assert.equal(init?.redirect ?? input.redirect, 'error');
  const scenarioFile = staff ? process.env.STAFF_TEST_SCENARIO : process.env.CATALOG_TEST_SCENARIO;
  if (staff && !scenarioFile) return new Response(null, { status: 503 });
  const scenario = readFileSync(scenarioFile, 'utf8');
  console.info(staff ? '[staff-fixture]' : '[catalog-fixture]', scenario, language);

  // Let the 12 concurrent requests reach the cache before the upstream responds.
  if (['success', 'empty', '429', '500'].includes(scenario)) await delay(400);

  if (scenario === 'timeout') {
    const signal = init?.signal ?? input.signal;
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
  if (scenario === 'home-translations') return Response.json({ success: true, data: { services: [
    { id: 13982356, title: 'Классический массаж студии', comment: 'Актуальное описание из каталога.' },
    { id: 13982355, title: 'Спортивный массаж' },
    { id: 91206, title: 'Новая услуга', comment: 'Описание новой услуги из каталога.' },
  ] } });
  if (scenario === 'home-slow') {
    const release = `${scenarioFile}.release`;
    while (!(await fs.stat(release).catch(() => null))) {
      const signal = init?.signal ?? input.signal;
      await delay(30, undefined, { signal });
    }
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
      { id: 91212, name: 'Sam Example', specialization: ' ', position: [],
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
    assert.ok(['success', 'home-slow', 'home-single'].includes(scenario), scenario);
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
  assert.equal(scenario, 'success');
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
