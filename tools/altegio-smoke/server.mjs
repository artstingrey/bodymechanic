import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { actions, runAction } from './api.mjs';

const host = '127.0.0.1';
const port = Number(process.env.ALTEGIO_SMOKE_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('ALTEGIO_SMOKE_PORT должен быть числом от 1 до 65535.');
}
const address = `${host}:${port}`;
const page = await readFile(new URL('./index.html', import.meta.url));

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (request.headers.host !== address || (request.headers.origin && request.headers.origin !== `http://${address}`)) {
    return sendJson(response, 403, { message: 'Откройте страницу по локальному адресу из терминала.' });
  }

  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }

  const action = /^\/api\/([a-z]+)$/.exec(request.url)?.[1];
  if (!Object.hasOwn(actions, action)) return sendJson(response, 404, { message: 'Маршрут не найден.' });
  if (request.method !== actions[action]) {
    response.setHeader('Allow', actions[action]);
    return sendJson(response, 405, { message: 'Для этого маршрута требуется другой HTTP-метод.' });
  }
  if (request.method === 'POST' && request.headers['x-altegio-smoke'] !== '1') {
    return sendJson(response, 403, { message: 'Требуется заголовок X-Altegio-Smoke: 1.' });
  }

  try {
    const result = await runAction(action);
    // The local response has an envelope even when Altegio returns an empty body.
    return sendJson(response, result.status, result);
  } catch {
    return sendJson(response, 500, { message: 'Локальная ошибка. Если запрос на создание уже отправлялся, проверьте журнал Altegio.' });
  }
}).listen(port, host, () => {
  console.log(`Altegio smoke: http://${address}`);
});
