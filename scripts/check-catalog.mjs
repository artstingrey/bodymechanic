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
  assert.equal(response.headers.get('location'), null, query);
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

function checkBodyCancellation(logs, expected) {
  const cancelled = [...logs().matchAll(/\[catalog-body-cancel\] (\d{3})/g)].map((match) => match[1]);
  assert.deepEqual(cancelled, expected);
  assert.doesNotMatch(logs(), /\[catalog-unhandled-rejection\]/);
  assert.ok(privateValues.every((value) => !logs().includes(value)), 'logs contain private data');
}

async function burst(logs, label, [calls, writes, errors], run) {
  const offset = logs().length;
  await Promise.all(Array.from({ length: 12 }, (_, i) => run(i % 2 === 0 ? 'ru' : 'en')));
  // A stale hit returns before the fixture finishes its background request.
  await delay(550);
  const log = logs().slice(offset);
  const keys = [...log.matchAll(/\[catalog-cache-write\] (\S+)/g)].map((match) => match[1]);
  const actual = {
    calls: countCalls(() => log),
    writes: keys.length,
    errors: (log.match(/\[altegio\]|\[catalog\] Unexpected error/g) ?? []).length,
    nextRevalidationErrors: (log.match(/revalidating cache with key/g) ?? []).length,
  };
  console.log(`${label} (12 parallel): ${JSON.stringify(actual)}`);
  assert.deepEqual(actual, { calls, writes, errors, nextRevalidationErrors: 0 }, label);
  return keys;
}

function checkData(origin, data) {
  return async (locale) => {
    const { json } = await request(origin, `?locale=${locale}`, 200);
    assert.deepEqual(json, { data, meta: { source: 'altegio', locale } });
  };
}

function checkRateLimited(origin, min, max) {
  return async (locale) => {
    const headers = await checkError(origin, 503, 'UPSTREAM_RATE_LIMITED', `?locale=${locale}`);
    const retryAfter = headers.get('retry-after');
    assert.match(retryAfter ?? '', /^\d+$/);
    const seconds = Number(retryAfter);
    assert.ok(seconds >= min && seconds <= max, `Retry-After ${seconds}, expected ${min}–${max}`);
  };
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
const createdEntries = new Set();
const fixtureEnv = () => ({
  ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
  ALTEGIO_PARTNER_TOKEN: token,
  ALTEGIO_CURRENCY: 'AED',
  CATALOG_TEST_SCENARIO: scenarioFile,
});
const env = fixtureEnv();
let entryPath;
const firstData = {
  services: [
    { id: 42, title: 'Massage', description: null, categoryId: 20, priceMin: 0, priceMax: 55,
      currency: 'AED', durationMin: 90, imageUrl: 'https://images.example.test/service.webp' },
    { id: 43, title: 'Other', description: null, categoryId: null, priceMin: null, priceMax: null,
      currency: 'AED', durationMin: null, imageUrl: null },
  ],
  categories: [{ id: 20, title: 'Massage' }],
};
const emptyData = { services: [], categories: [] };

async function readCreatedEntry() {
  const files = (await newEntries()).map((file) => path.join(cacheDir, file)).filter((file) => !createdEntries.has(file));
  assert.equal(files.length, 1);
  const [file] = files;
  createdEntries.add(file);
  return file;
}

// Restart to discard Next's in-memory cache and read the aged on-disk entry.
async function ageEntry() {
  const stale = new Date(Date.now() - 14_401_000);
  await fs.utimes(entryPath, stale, stale);
}

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
      ['500', 503, 'CATALOG_UNAVAILABLE'],
      ['network', 503, 'CATALOG_UNAVAILABLE'], ['rejected', 502, 'UPSTREAM_INVALID_RESPONSE'],
      ['empty-body', 502, 'UPSTREAM_INVALID_RESPONSE'], ['invalid-json', 502, 'UPSTREAM_INVALID_RESPONSE'],
      ['invalid-schema', 502, 'UPSTREAM_INVALID_RESPONSE'], ['invalid-service', 502, 'UPSTREAM_INVALID_RESPONSE'],
      ['timeout', 504, 'UPSTREAM_TIMEOUT'],
    ];
    for (const [scenario, status, code] of errors) {
      await setScenario(scenario);
      await checkError(origin, status, code);
    }
    assert.equal(countCalls(logs), errors.length);
    // 403 has no body. The 500 stream rejects cancellation, but still maps to CATALOG_UNAVAILABLE.
    checkBodyCancellation(logs, ['401', '500']);
    assert.deepEqual(await newEntries(), [], 'failed responses must not enter the cache');

    await setScenario('success');
    const keys = await burst(logs, 'Cold cache', [1, 1, 0], checkData(origin, firstData));
    await setScenario('500');
    await burst(logs, 'Fresh cache', [0, 0, 0], checkData(origin, firstData));
    assert.deepEqual((await request(origin, '', 200)).json, { data: firstData, meta: { source: 'altegio', locale: 'en' } });
    entryPath = await readCreatedEntry();
    assert.deepEqual(keys, [path.basename(entryPath)]);
    const entry = JSON.parse(await fs.readFile(entryPath, 'utf8'));
    assert.equal(entry.revalidate, 14_400);
    assert.deepEqual(JSON.parse(entry.data.body), firstData);
    assert.ok(privateValues.every((value) => !logs().includes(value)), 'logs contain private data');
  }, { env, preload });

  await ageEntry();
  await withProductionServer(async (origin, logs) => {
    await burst(logs, 'Stale cache, upstream 500', [1, 0, 1], checkData(origin, firstData));
    await setScenario('empty');
    const keys = await burst(logs, 'Stale cache, successful refresh', [1, 1, 0], checkData(origin, firstData));
    assert.deepEqual(keys, [path.basename(entryPath)]);
    await checkData(origin, emptyData)('en');
    assert.equal(countCalls(logs), 2);
    assert.ok(privateValues.every((value) => !logs().includes(value)), 'logs contain private data');
  }, { env, preload });

  await ageEntry();
  const lastSuccess = (await fs.stat(entryPath)).mtimeMs;
  await setScenario('429');
  await withProductionServer(async (origin, logs) => {
    await burst(logs, 'Stale cache, upstream 429', [1, 0, 1], checkData(origin, emptyData));
    await setScenario('success');
    await burst(logs, 'Stale cache, during Retry-After', [0, 0, 0], checkData(origin, emptyData));
    assert.equal((await fs.stat(entryPath)).mtimeMs, lastSuccess);
    await delay(5000);
    const keys = await burst(logs, 'Stale cache, after Retry-After', [1, 1, 0], checkData(origin, emptyData));
    assert.deepEqual(keys, [path.basename(entryPath)]);
    await checkData(origin, firstData)('ru');
    assert.equal(countCalls(logs), 2);
  }, { env, preload });

  await setScenario('429');
  await withProductionServer(async (origin, logs) => {
    await burst(logs, 'Cold cache, upstream 429', [1, 0, 1], checkRateLimited(origin, 5, 5));
    checkBodyCancellation(logs, ['429']);
    assert.ok((await newEntries()).every((file) => createdEntries.has(path.join(cacheDir, file))));
    await setScenario('empty');
    await delay(1100);
    await burst(logs, 'Cold cache, during Retry-After', [0, 0, 0], checkRateLimited(origin, 1, 4));
    await delay(5000);
    const keys = await burst(logs, 'Cold cache, after Retry-After', [1, 1, 0], checkData(origin, emptyData));
    assert.deepEqual(keys, [path.basename(await readCreatedEntry())]);
  }, { env: fixtureEnv(), preload });

  const chunks = path.resolve('.next/static');
  for (const file of await fs.readdir(chunks, { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const js = await fs.readFile(path.join(chunks, file), 'utf8');
    assert.ok([...privateValues, 'ALTEGIO_PARTNER_TOKEN', 'api.alteg.io'].every((value) => !js.includes(value)),
      `client bundle contains server integration data: ${file}`);
  }
  console.log('Catalog DTO, HTTP failures, response body cancellation, public output and four-hour production cache: OK');
} finally {
  for (const file of createdEntries) await fs.unlink(file);
  await fs.unlink(scenarioFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  await fs.rmdir(scenarioDir);
}
