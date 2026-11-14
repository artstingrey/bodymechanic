import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Loaded only by the catalog test child process, before Next installs its fetch wrapper.
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

  assert.equal(url.href, `https://api.alteg.io/api/v1/book_services/${process.env.ALTEGIO_LOCATION_ID}?without_seances=1`);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  assert.equal(headers.get('authorization'), 'Bearer fixture-partner-token');
  assert.equal(headers.get('accept'), 'application/vnd.api.v2+json');
  assert.equal(init?.redirect ?? input.redirect, 'error');
  const scenario = readFileSync(process.env.CATALOG_TEST_SCENARIO, 'utf8');
  console.info('[catalog-fixture]', scenario);

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
  if (scenario === 'invalid-schema') return Response.json({ success: true, data: { services: null } });
  if (scenario === 'invalid-service') return Response.json({ success: true, data: { services: [{ id: 0, title: ' ' }] } });
  if (/^\d{3}$/.test(scenario)) {
    return new Response('fixture raw upstream detail', { status: Number(scenario), headers: { 'Retry-After': '5' } });
  }
  if (scenario === 'empty') return Response.json({ success: true, data: { services: [], categories: [] } });
  assert.equal(scenario, 'success');
  return Response.json({
    success: true,
    data: {
      category: [{ id: 20, title: ' Massage ' }],
      services: [
        { id: 42, title: ' Massage ', category_id: 20, price_min: 0, price_max: 55, discount: 20,
          seance_length: 5400, active: 0, image: 'https://images.example.test/service.webp', comment: 'fixture raw upstream detail' },
        { id: 43, title: 'Other', image: 'javascript:alert(1)' },
      ],
    },
  });
};
