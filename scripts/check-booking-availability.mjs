import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withProductionServer } from './check-server.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bodymechanic-availability-'));
const catalogScenario = path.join(dir, 'catalog');
const staffScenario = path.join(dir, 'staff');
const availabilityScenario = path.join(dir, 'availability');
const setAvailability = (scenario) => fs.writeFile(availabilityScenario, scenario);
const cacheKeys = new Set();
const token = 'fixture-partner-token';
const start = '2026-11-30';
const end = '2026-12-01';
const anyDates = 'dates?serviceId=13982355&staffId=0&locale=ru';
const anyTimes = `times?serviceId=13982355&staffId=0&date=${end}&locale=ru`;
const preload = new URL('../e2e/fixtures/altegio-catalog.mjs', import.meta.url).href;

try {
  await fs.writeFile(catalogScenario, 'service-detail');
  await fs.writeFile(staffScenario, 'success');
  await setAvailability('success');

  await withProductionServer(async (origin, logs) => {
    async function read(url, status = 200, code, retryAfter = null) {
      const response = await fetch(`${origin}/api/booking/${url}`);
      assert.equal(response.status, status, url);
      assert.equal(response.headers.get('cache-control'), 'no-store', url);
      assert.equal(response.headers.get('retry-after'), retryAfter, url);
      const body = await response.text();
      assert.doesNotMatch(body, /fixture-partner-token|fixture raw upstream detail/);
      const json = JSON.parse(body);
      if (code) assert.equal(json.error.code, code, url);
      return json.data;
    }

    try {
      for (const url of [
        'staff', 'staff?serviceId=0', 'staff?serviceId=01', 'staff?serviceId=1e2',
        'staff?serviceId=9007199254740992', 'staff?serviceId=13982355&serviceId=13982355',
        'staff?serviceId=13982355&locale=en&locale=en', 'staff?serviceId=13982355&locale=de',
        'staff?serviceId=13982355&staffId=0', 'dates?serviceId=13982355',
        'dates?serviceId=13982355&staffId=-1', 'dates?serviceId=13982355&staffId=0&locationId=1',
        'dates?serviceId=13982355&staffId=0&staffId=0', 'times?serviceId=13982355&staffId=0',
        'times?serviceId=13982355&staffId=0&date=2026-02-29',
        'times?serviceId=13982355&staffId=0&date=2026-13-01',
        'times?serviceId=13982355&staffId=0&date=2026-12-01%2F..',
      ]) await read(url, 400, 'INVALID_QUERY');
      assert.doesNotMatch(logs(), /\[(catalog|service-staff|availability)-fixture\]/);

      await read('staff?serviceId=999999', 404, 'SERVICE_NOT_FOUND');
      await read('dates?serviceId=13982355&staffId=91605', 404, 'STAFF_NOT_FOUND');
      await read(`times?serviceId=91201&staffId=91601&date=${end}`, 404, 'STAFF_NOT_FOUND');
      await read('dates?serviceId=13982355&staffId=91603', 404, 'STAFF_NOT_FOUND');
      assert.doesNotMatch(logs(), /\[availability-fixture\]/);

      assert.deepEqual(await read('staff?serviceId=13982355&locale=ru'), {
        serviceId: 13982355, staff: [{ id: 91601, name: 'Alex Example' }, { id: 91602, name: 'Sam Example' }],
      });
      assert.deepEqual(await read('staff?serviceId=91201'), {
        serviceId: 91201, staff: [{ id: 91605, name: 'Taylor Example' }],
      });
      assert.deepEqual(await read('staff?serviceId=91204'), { serviceId: 91204, staff: [] });

      assert.deepEqual(await read(anyDates), { serviceId: 13982355, staffId: 0, dates: [start, end] });
      assert.deepEqual(await read('dates?serviceId=13982355&staffId=91601'), {
        serviceId: 13982355, staffId: 91601, dates: [start],
      });
      assert.deepEqual(await read('dates?serviceId=13982355&staffId=91602'), {
        serviceId: 13982355, staffId: 91602, dates: [end],
      });
      assert.deepEqual(await read('dates?serviceId=91201&staffId=0'), { serviceId: 91201, staffId: 0, dates: [end] });
      assert.deepEqual(await read(anyTimes), {
        serviceId: 13982355, staffId: 0, date: end,
        times: [{ datetime: '2026-11-30T23:20:00.123+03:00', time: '00:20' }],
      });
      assert.deepEqual(await read(`times?serviceId=91201&staffId=91605&date=${end}`), {
        serviceId: 91201, staffId: 91605, date: end,
        times: [{ datetime: `${end}T13:15:00+04:00`, time: '13:15' }],
      });
      assert.deepEqual(await read(`times?serviceId=13982355&staffId=91601&date=${end}`), {
        serviceId: 13982355, staffId: 91601, date: end, times: [],
      });

      // Switching the fixture between identical requests exposes stale availability.
      await setAvailability('empty');
      assert.deepEqual(await read(anyDates), { serviceId: 13982355, staffId: 0, dates: [] });
      assert.deepEqual(await read(anyTimes), { serviceId: 13982355, staffId: 0, date: end, times: [] });
      await setAvailability('429');
      await read(anyDates, 429, 'UPSTREAM_RATE_LIMITED', new Date('2030-01-01T00:00:00Z').toUTCString());
      await read(anyTimes, 429, 'UPSTREAM_RATE_LIMITED', '0');
      await setAvailability('503');
      await read(anyDates, 503, 'CATALOG_UNAVAILABLE', '30');
      await setAvailability('invalid');
      await read(anyDates, 502, 'UPSTREAM_INVALID_RESPONSE');
      await read(anyTimes, 502, 'UPSTREAM_INVALID_RESPONSE');
      await setAvailability('timeout');
      await read(anyTimes, 504, 'UPSTREAM_TIMEOUT');
      await setAvailability('success');
      assert.deepEqual((await read(anyDates)).dates, [start, end]);
      assert.equal((await read(anyTimes)).times[0].time, '00:20');
      assert.match(logs(), /\[availability-fixture\] book_dates ru-RU 13982355 0 -/);
      assert.match(logs(), /\[availability-fixture\] book_times en-US 91201 91605 2026-12-01/);
      assert.doesNotMatch(logs(), /fixture-partner-token|fixture raw upstream detail|\[catalog-unhandled-rejection\]/);
    } finally {
      for (const [, key] of logs().matchAll(/\[catalog-cache-write\] ([\w-]+)/g)) cacheKeys.add(key);
    }
  }, { preload, env: {
    ALTEGIO_LOCATION_ID: String(randomInt(1_000_000, 1_000_000_000)),
    ALTEGIO_PARTNER_TOKEN: token,
    ALTEGIO_CURRENCY: 'AED',
    TZ: 'America/Los_Angeles',
    CATALOG_TEST_SCENARIO: catalogScenario,
    SERVICE_STAFF_TEST_SCENARIO: staffScenario,
    AVAILABILITY_TEST_SCENARIO: availabilityScenario,
  } });
  console.log('Booking availability: validation, assignments, fresh dates and times, Dubai time, upstream errors and recovery OK');
} finally {
  for (const key of cacheKeys) await fs.rm(path.join('.next/cache/fetch-cache', key), { force: true });
  for (const file of [catalogScenario, staffScenario, availabilityScenario]) await fs.rm(file, { force: true });
  await fs.rmdir(dir);
}
