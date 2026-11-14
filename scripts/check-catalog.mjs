import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withProductionServer } from './check-server.mjs';

const endpoint = '/api/catalog/services';
const missingEnv = { ALTEGIO_LOCATION_ID: '', ALTEGIO_PARTNER_TOKEN: '', ALTEGIO_CURRENCY: '' };
const token = 'fixture-partner-token';
const privateValues = [token, 'fixture raw upstream detail'];
const scenarioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-catalog-'));
const scenarioFile = path.join(scenarioDir, 'scenario');
const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;

async function request(origin, query, status) {
  const response = await fetch(origin + endpoint + query, { redirect: 'manual' });
  assert.equal(response.status, status, query);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.ok(privateValues.every((value) => !text.includes(value)), 'public JSON contains private data');
  return { json: JSON.parse(text), headers: response.headers };
}

async function checkError(origin, status, code, query = '') {
  const { json, headers } = await request(origin, query, status);
  assert.deepEqual(Object.keys(json), ['error']);
  assert.deepEqual(Object.keys(json.error).sort(), ['code', 'message']);
  assert.equal(json.error.code, code);
  return headers;
}

const setScenario = (value) => fs.writeFile(scenarioFile, value);
const countCalls = (logs) => (logs().match(/\[catalog-fixture\]/g) ?? []).length;
async function waitForCalls(logs, expected) {
  for (let attempt = 0; attempt < 100 && countCalls(logs) < expected; attempt++) await delay(50);
  assert.equal(countCalls(logs), expected);
}

const cacheDir = path.resolve('.next/cache/fetch-cache');
async function cacheEntries() {
  return new Set(await fs.readdir(cacheDir).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  }));
}
const initialEntries = await cacheEntries();
const newEntries = async () => [...await cacheEntries()].filter((file) => !initialEntries.has(file));
const fixtureEnv = () => ({
  ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
  ALTEGIO_PARTNER_TOKEN: token,
  ALTEGIO_CURRENCY: 'AED',
  CATALOG_TEST_SCENARIO: scenarioFile,
});
const env = fixtureEnv();
let entryPath;
let first;

try {
  await withProductionServer(async (origin) => {
    await checkError(origin, 503, 'CATALOG_UNAVAILABLE');
  }, { env: missingEnv, preload });

  await withProductionServer(async (origin, logs) => {
    for (const query of ['?locale=de', '?locale=', '?locale=ru&locale=en', '?locationId=5', '?locale=ru&path=other']) {
      await checkError(origin, 400, 'INVALID_QUERY', query);
    }
    assert.equal(countCalls(logs), 0);
    const errors = [
      ['401', 503, 'CATALOG_UNAVAILABLE'], ['403', 503, 'CATALOG_UNAVAILABLE'],
      ['429', 503, 'UPSTREAM_RATE_LIMITED'], ['500', 503, 'CATALOG_UNAVAILABLE'],
      ['network', 503, 'CATALOG_UNAVAILABLE'], ['rejected', 502, 'UPSTREAM_INVALID_RESPONSE'],
      ['empty-body', 502, 'UPSTREAM_INVALID_RESPONSE'], ['invalid-json', 502, 'UPSTREAM_INVALID_RESPONSE'],
      ['invalid-schema', 502, 'UPSTREAM_INVALID_RESPONSE'], ['invalid-service', 502, 'UPSTREAM_INVALID_RESPONSE'],
      ['timeout', 504, 'UPSTREAM_TIMEOUT'],
    ];
    for (const [scenario, status, code] of errors) {
      await setScenario(scenario);
      const headers = await checkError(origin, status, code);
      if (scenario === '429') assert.equal(headers.get('retry-after'), '120');
    }
    await waitForCalls(logs, errors.length);
    assert.deepEqual(await newEntries(), [], 'failed responses must not enter the cache');

    await setScenario('success');
    ({ json: first } = await request(origin, '', 200));
    assert.deepEqual(first, {
      data: {
        services: [
          { id: 42, title: 'Massage', description: null, categoryId: 20, priceMin: 0, priceMax: 55,
            currency: 'AED', durationMin: 90, imageUrl: 'https://images.example.test/service.webp' },
          { id: 43, title: 'Other', description: null, categoryId: null, priceMin: null, priceMax: null,
            currency: 'AED', durationMin: null, imageUrl: null },
        ],
        categories: [{ id: 20, title: 'Massage' }],
      },
      meta: { source: 'altegio', locale: 'en' },
    });
    await setScenario('500');
    const { json: russian } = await request(origin, '?locale=ru', 200);
    assert.deepEqual(russian, { ...first, meta: { source: 'altegio', locale: 'ru' } });
    await waitForCalls(logs, errors.length + 1);
    const entries = await newEntries();
    assert.equal(entries.length, 1);
    entryPath = path.join(cacheDir, entries[0]);
    const entry = JSON.parse(await fs.readFile(entryPath, 'utf8'));
    assert.equal(entry.revalidate, 14_400);
    assert.deepEqual(JSON.parse(entry.data.body), first.data);

  }, { env, preload });

  // Restart to discard Next's in-memory cache and read the aged on-disk entry.
  const stale = new Date(Date.now() - 14_401_000);
  await fs.utimes(entryPath, stale, stale);
  await withProductionServer(async (origin, logs) => {
    const { json: staleResponse } = await request(origin, '', 200);
    assert.deepEqual(staleResponse, first);
    await waitForCalls(logs, 1);
    await setScenario('empty');
    await request(origin, '', 200);
    await waitForCalls(logs, 2);
    const refreshed = { data: { services: [], categories: [] }, meta: first.meta };
    for (let attempt = 0; ; attempt++) {
      const cached = JSON.parse(await fs.readFile(entryPath, 'utf8').catch(() => '{}'));
      if (cached.data?.body === JSON.stringify(refreshed.data)) break;
      assert.ok(attempt < 100, 'catalog cache did not refresh');
      await delay(50);
    }
    assert.deepEqual((await request(origin, '', 200)).json, refreshed);
    assert.ok(privateValues.every((value) => !logs().includes(value)), 'logs contain private data');
  }, { env, preload });

  const chunks = path.resolve('.next/static');
  for (const file of await fs.readdir(chunks, { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const js = await fs.readFile(path.join(chunks, file), 'utf8');
    assert.ok([...privateValues, 'ALTEGIO_PARTNER_TOKEN', 'api.alteg.io'].every((value) => !js.includes(value)),
      `client bundle contains server integration data: ${file}`);
  }
  console.log('Catalog DTO, HTTP failures, public output and four-hour production cache: OK');
} finally {
  if (entryPath) await fs.unlink(entryPath);
  await fs.unlink(scenarioFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  await fs.rmdir(scenarioDir);
}
