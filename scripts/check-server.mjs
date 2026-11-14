import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function withProductionServer(check, { env = {}, preload, cwd = process.cwd() } = {}) {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    ...(preload ? ['--import', preload] : []),
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd, env: { ...process.env, NODE_ENV: 'production', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) break;
      const response = await fetch(`${origin}/robots.txt`).catch(() => null);
      if (response?.ok) return await check(origin, () => logs);
      await delay(200);
    }
    throw new Error(`Production server did not start.\n${logs}`);
  } finally {
    child.kill();
    await exited;
  }
}

export async function checkServer(origin) {
  async function get(path, status, pattern) {
    const response = await fetch(origin + path, { redirect: 'manual' });
    assert.equal(response.status, status, path);
    const body = await response.text();
    if (pattern) assert.match(body, pattern, path);
    return { body, headers: response.headers };
  }

  await get('/', 200, /bm\.locale/);
  await get('/robots.txt', 200, /Disallow: \//);
  await get('/sitemap.xml', 200, /<urlset/);
  const catalog = await get('/api/catalog/services?locale=unknown', 400, /INVALID_QUERY/);
  assert.equal(catalog.headers.get('cache-control'), 'no-store');
  await get('/de/', 404, /<h1/);
  await get('/en/no-such-page/', 404, /<h1/);
  const fontLinks = (html) => [...html.matchAll(/<link(?=[^>]*rel="preload")(?=[^>]*href="\/fonts\/v1\/([^"]+)")[^>]*>/g)];
  for (const locale of ['en', 'ru']) {
    const { body, headers } = await get(`/${locale}/`, 200, new RegExp(`<html lang="${locale}"`));
    assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.deepEqual(fontLinks(body).map((link) => link[1]), ['Manrope.woff2']);
    await get(`/${locale}/booking/?step=4`, 200, /data-step=/);
    for (const variant of ['a', 'b']) {
      const lp = await get(`/${locale}/lp/${variant}/`, 200, /data-lp-form=/);
      const links = fontLinks(lp.body);
      assert.deepEqual(links.map((link) => link[1]).sort(),
        [400, 600, 700, 800].map((weight) => `Manrope-${weight}.woff2`));
      assert.ok(links.every((link) => link[0].includes('fetchPriority="low"')));
    }
    for (const path of ['account/', 'account/record/', 'account/record/777/abc123/']) {
      const account = await get(`/${locale}/${path}`, 200, /<meta name="referrer" content="no-referrer"/);
      assert.equal(account.headers.get('referrer-policy'), 'no-referrer');
      assert.match(account.headers.get('cache-control') ?? '', /\bno-store\b/);
      if (path.includes('abc123')) {
        const tags = account.body.match(/<(?:meta|link)\b[^>]*>/g) ?? [];
        assert.ok(tags.every((tag) => !tag.includes('abc123')));
      }
    }
  }
  for (const path of ['Manrope', 'Manrope-400', 'Manrope-600', 'Manrope-700', 'Manrope-800']) {
    const font = await fetch(`${origin}/fonts/v1/${path}.woff2`);
    assert.equal(font.status, 200);
    assert.match(font.headers.get('content-type') ?? '', /font\/woff2/);
    assert.match(font.headers.get('cache-control') ?? '', /immutable/);
    await font.arrayBuffer();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await withProductionServer(checkServer);
  console.log('Production routes, private headers and font preloads: OK');
}
