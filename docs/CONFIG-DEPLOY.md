# Настройка и выкладка

Текущая ветка запускается как Node.js-приложение Next.js. Ниже также сохранены сведения о действующем Render Static Site, проверенные 12.11.2026.

## Переменные окружения

### Переменные сборки сайта

Все переменные с префиксом `NEXT_PUBLIC_` подставляются в код **в момент сборки** (`src/lib/config.ts`). Изменили значение — нужна новая сборка и выкладка. Секретов среди них нет и быть не должно: всё, что начинается с `NEXT_PUBLIC_`, попадает в файлы, которые скачивает браузер.

| Переменная | На что влияет | Значение по умолчанию | Где читается |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Адрес сайта в canonical, hreflang, Open Graph, `sitemap.xml`, строке `Sitemap:` в `robots.txt` и в разметке JSON-LD. Косая черта в конце отбрасывается. | `https://bodymechanic.example` | `src/lib/site.ts` |
| `NEXT_PUBLIC_GTM_ID` | Идентификатор контейнера Google Tag Manager вида `GTM-XXXXXXX`. Контейнер грузится только после согласия посетителя на «Аналитику» или «Маркетинг». Значение другого вида игнорируется. **Задавать только на выпуске RC-10 или новее**: в RC-9 номер услуги попадал в адрес страницы записи, а пиксель Meta, тег Google и GA4 сами отправляют адрес страницы (`KNOWN-ISSUES.md`, раздел 5, пункт 20). | пусто: GTM не грузится, события остаются в `window.dataLayer` | `src/lib/config.ts`, `src/lib/analytics/gtm.ts` |
| `NEXT_PUBLIC_STUDIO_WHATSAPP` | Номер в ссылках демо-кабинета «Мои записи». Из значения берутся только цифры. | пусто: ссылка `https://wa.me/` без номера, WhatsApp предложит выбрать чат | `src/components/account/Account.tsx` |
| `NEXT_PUBLIC_STUDIO_ADDRESS` | Переопределяет адрес в футере, контактах, подтверждении записи, календаре и JSON-LD. При переезде обновите также обе ссылки на точку в Google Maps. | Адрес HDS Tower из задания этапа 10 | `src/lib/config.ts` |
| `NEXT_PUBLIC_STUDIO_PHONE` | Телефон студии в JSON-LD, формат `+971…`. | пусто: поле не попадает | там же |
| `NEXT_PUBLIC_STUDIO_HOURS` | Часы работы в JSON-LD в формате schema.org, несколько значений через `;`. Пример: `Mo-Sa 09:00-21:00`. | пусто: поле не попадает | там же |
| `NEXT_PUBLIC_BOOKING_SMS_REQUIRED` | Значение `true` включает на шаге 6 записи ввод кода из SMS. Сам код сейчас не отправляется: сервера нет. | выключено | `src/lib/config.ts`, `src/components/booking/useBookingFlow.ts`, `src/components/booking/steps/StepReview.tsx` |
| `TURNSTILE_SITE_KEY` | Публичный Site Key Cloudflare Turnstile для всех форм записи. Next.js подставляет его в клиентский код при сборке. | пусто | `next.config.ts`, `src/lib/config.ts` |
| `RENDER` | Признак сборки на Render. Если он есть, а `NEXT_PUBLIC_SITE_URL` не задан, сборка останавливается с ошибкой. | — | `next.config.ts` |
| `NODE_VERSION` | Версия Node.js для сборки на Render. | — | настройка Render, в коде не читается |

Рекламные лендинги и шаги записи используют номер студии из `WHATSAPP_URL` в `src/lib/config.ts`.

Файлы `.env*` в git не попадают (`.gitignore`). В репозитории таких файлов нет.

`NODE_ENV` задавать не нужно: её выставляет сама сборка Next (`production` при `npm run build`). Читает её `next.config.ts` — для предупреждения о незаданном адресе сайта; `scripts/clean-build.mjs` передаёт её сборке явно.

**Ловушка при смене хостинга.** Защита от забытого `NEXT_PUBLIC_SITE_URL` срабатывает только там, где задана переменная `RENDER`. На другом хостинге или при локальной сборке без этой переменной сборка пройдёт, а в canonical, hreflang и `sitemap.xml` окажется адрес-заглушка `https://bodymechanic.example`. Сборка печатает об этом предупреждение `! NEXT_PUBLIC_SITE_URL is not set…` (`next.config.ts`), но не останавливается: локальная сборка и проверки идут без переменной.

### Что задано на живом сайте

Список переменных в панели Render со стороны кода не виден. Ниже то, что следует из файлов живого сайта (12.11.2026) и журнала его сборки.

| Переменная | На живом сайте | Как проверено |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://bodymechanic-site.onrender.com` | canonical живых страниц |
| `NODE_VERSION` | задана, сборка идёт на Node.js 22.23.4 | журнал сборки Render |
| `NEXT_PUBLIC_GTM_ID` | не задана | в скриптах живого сайта нет идентификатора вида `GTM-…` |
| `NEXT_PUBLIC_STUDIO_WHATSAPP` | не задана | ссылки ведут на `wa.me/` без номера |
| `NEXT_PUBLIC_STUDIO_ADDRESS`, `_PHONE`, `_HOURS` | не заданы | в разметке JSON-LD живого сайта этих полей нет |
| `NEXT_PUBLIC_BOOKING_SMS_REQUIRED` | не задана | набор файлов скриптов страницы записи совпадает с локальной сборкой без переменной |

### Серверные переменные Altegio

| Переменная | Значение |
|---|---|
| `ALTEGIO_LOCATION_ID` | Положительный целочисленный ID филиала |
| `ALTEGIO_PARTNER_TOKEN` | Partner Token без префикса `Bearer` |
| `ALTEGIO_BUSINESS_TOKEN` | Business User Token без префикса `User` с доступом к услугам филиала. Включает базовую длительность из карточки услуги |
| `ALTEGIO_CURRENCY` | Необязательный трёхбуквенный код ISO 4217 в верхнем регистре. Заполняйте после подтверждения валюты филиала. При отсутствии значения API возвращает `null` |

Для локального запуска создайте игнорируемый `.env.local` в корне по [образцу](../.env.example). В PowerShell используйте `Copy-Item .env.example .env.local` при отсутствии файла, затем заполните его локально. Перезапустите `npm run dev` или `npm run start`. На хостинге задайте значения в окружении процесса. Публичный префикс `NEXT_PUBLIC_` для этих переменных не используется.

Сборка и демостраницы работают без Altegio. При обращении к API без корректной конфигурации каталог возвращает `503 CATALOG_UNAVAILABLE`.

Список онлайн-услуг берётся из `book_services`. При заданном `ALTEGIO_BUSINESS_TOKEN` каталог дополняет его по ID базовой длительностью `duration` из `GET /api/v1/locations/{location_id}/services`, переводя секунды в минуты. Read-only сверка филиала подтвердила `duration` для всех онлайн-услуг по этому адресу. Последние успешные длительности кешируются на сервере для обеих локалей. При отсутствии значения сохраняется доступная длительность из `book_services`.

В `next dev` на `localhost` и loopback-адресах отправка QuickForm доступна без отдельной настройки. POST проверяет источник и локальный адрес запроса. Чтобы в разработке оставить режим просмотра, задайте `BOOKING_QUICK_FORM_ENABLED=false`.

При production-запуске отправка QuickForm включается в окружении сервера через `BOOKING_QUICK_FORM_ENABLED=true`. Без этого значения форма показывает доступность, кнопка записи отключена. Для POST нужны `BOOKING_ORIGIN` и проверенный источник IP по [настройкам части 5.3](ALTEGIO-IMPLEMENTATION-PLAN.md#часть-53-серверное-создание-записи). Публичное включение формы согласуется отдельно.

Оба лендинга используют тот же `POST /api/booking/record`. Для публичной записи с лендинга нужны настройки Altegio, `BOOKING_ORIGIN`, доверенный заголовок `BOOKING_CLIENT_IP_HEADER` и настройки Turnstile.

### Cloudflare Turnstile

Виджет **Bodymechanic Booking Form** настроен для `thebodymechanic.io` в режиме Managed с выключенным Pre-clearance. Публичный `TURNSTILE_SITE_KEY` нужен во время сборки, а `TURNSTILE_SECRET_KEY` задаётся в окружении сервера. При изменении публичного ключа нужна новая сборка. Без публичного ключа формы показывают недоступность проверки, а без серверного секрета API отклоняет новые попытки. Сборка, просмотр страниц и публичные запросы доступности работают без этих переменных.

Siteverify принимает токен только при успешном ответе для `hostname: thebodymechanic.io` и `action: booking`. Политика в конфигурации проекта разрешает загрузку скрипта и iframe. Для политики с ограничением источников добавьте `https://challenges.cloudflare.com` в `script-src` и `frame-src`. Порядок изолированной проверки описан в [TESTING.md](TESTING.md#проверка-turnstile).

### Запись на production в Vercel

На `localhost` в `next dev` маршрут выводит origin из локального запроса и проверяет loopback-адрес. На Vercel используются явные настройки production.

В проекте с доменом `thebodymechanic.io` откройте **Settings → Environment Variables**, выберите **Production** и задайте серверные переменные.

| Переменная | Значение |
|---|---|
| `BOOKING_ORIGIN` | `https://thebodymechanic.io` без завершающего слеша |
| `BOOKING_CLIENT_IP_HEADER` | `x-vercel-forwarded-for` |
| `TURNSTILE_SECRET_KEY` | Серверный секрет виджета Turnstile |

После сохранения выполните **Redeploy** для production-деплоя. Переменные применяются к новым деплоям. [Переменные Vercel](https://vercel.com/docs/environment-variables) · [Заголовки запросов Vercel](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for)

Для проверки отправьте `{}` как JSON в `POST /api/booking/record` с `Origin: https://thebodymechanic.io`. Ответ `400 INVALID_FIELDS` подтверждает, что запрос дошёл до проверки полей. Такой запрос не создаёт запись. Ответ `503 BOOKING_UNAVAILABLE` на этот запрос означает, что `BOOKING_ORIGIN` отсутствует в активном деплое. При `403 INVALID_ORIGIN` проверьте точное совпадение origin и заголовок IP.

### Переменные тестов и локальных скриптов

На собранный сайт они не влияют.

| Переменная | На что влияет | По умолчанию | Где читается |
|---|---|---|---|
| `GATE_PORT` | Порт локального сервера для тестов. | `4300 + хеш пути папки % 600` | `scripts/gate-port.cjs` |
| `PORT` | Порт для `npm run start` и `npm run serve`, если порт не передан аргументом. | 3000 | Next.js |
| `GATE_BASE_URL` | Адрес уже выложенного сайта: тесты идут против него, локальный сервер не поднимается. | не задан: тесты запускают локальный production-сервер | `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/keep-failures.ts` |
| `GATE_SHOTS` | Значение `0` отключает снимки страниц в тесте `pages.spec.ts`. | снимки делаются | `e2e/pages.spec.ts` |
| `GATE_MATRIX` | Включает расширенный набор устройств. Его выставляет `npm run test:matrix`. | выключен | `playwright.config.ts`, `scripts/test-matrix.mjs` |
| `GATE_DECK_DRIFT` | Значение `allow` превращает расхождение текстов с внешним набором `../copy` из ошибки в предупреждение. Нужна только там, где папка `../copy` есть. | расхождение считается ошибкой | `scripts/check-i18n.mjs`, `scripts/clean-build.mjs` |
| `CI` | Число параллельных потоков Playwright: 2 вместо 4. | 4 потока | `playwright.config.ts` |

## Хостинг

### Будущий Node Web Service

- Node.js 22. Сборка через `npm ci && npm run build`, запуск через `npm run start`. Render передаёт `PORT`.
- Задайте `NEXT_PUBLIC_SITE_URL` при сборке и переменные Altegio в серверном окружении.
- Маршруты кабинета и 404 обслуживает Next.js. Заголовки защиты, `X-Robots-Tag`, кеш моделей и приватные заголовки кабинета задаются в `next.config.ts`. HTTPS и HSTS настраиваются на хостинге.
- Next.js Proxy добавляет завершающий слеш известным страницам RU/EN через HTTP 308. Корневой адрес сохраняет выбор языка. Каталоги доступны напрямую по `/api/catalog/services?locale=ru` и `/api/catalog/staff?locale=ru`.
- Успешный каталог хранится в Next Data Cache на экземпляре сервиса. При нескольких экземплярах отдельно настройте общее хранилище кеша, если нужна синхронизация между ними.

### Действующий Render Static Site

Сейчас сайт выложен на Render как статический сайт (static site), сервис `bodymechanic-site`. Первые четыре строки таблицы получены через API Render 12.11.2026:

| Настройка | Значение |
|---|---|
| Команда сборки | `npm ci && npm run build` |
| Папка для публикации | `out` |
| Ветка | `main` |
| Автовыкладка | включена, по каждому коммиту в `main`; предпросмотр запросов на слияние выключен |
| Переменные | `NODE_VERSION=22`, `NEXT_PUBLIC_SITE_URL=https://<адрес сайта>`; остальные из таблицы выше по необходимости |

### Подмены адресов (Rewrite)

Нужны две подмены, действие именно *Rewrite*, а не переадресация:

| Откуда | Куда |
|---|---|
| `/ru/account/record/*` | `/ru/account/record/index.html` |
| `/en/account/record/*` | `/en/account/record/index.html` |

Зачем: ссылка на запись из письма или WhatsApp имеет вид `/{locale}/account/record/{id}/{hash}/`. В сборке есть только общая страница, она сама читает `id` и `hash` из адреса (`src/app/[locale]/account/record/page.tsx`, `src/components/account/Account.tsx`).

### Чего ставить нельзя

- **Переадресацию для `/`.** Язык выбирает скрипт в браузере: сохранённый выбор, затем язык браузера, иначе английский (`src/app/(root)/page.tsx`). Переадресация на хостинге обошла бы эту логику.
- **Общую подмену `/*` → `/404.html`.** Она отдаёт статус 200. Для несуществующих адресов хостинг должен отдавать `out/404.html` со статусом 404.

### Заголовки кеширования

| Путь | Заголовок |
|---|---|
| `/_next/static/*` | `Cache-Control: public, max-age=31536000, immutable` |
| `/models/*` | `Cache-Control: public, max-age=31536000, immutable` |

В именах этих файлов стоит хеш содержимого, поэтому их можно кешировать на год. HTML так кешировать нельзя.

### Заголовки защиты

Задаются в панели Render (Headers), в репозитории их нет. До 12.11.2026 на живом сайте из защитных заголовков были только `Strict-Transport-Security` и `X-Content-Type-Options: nosniff`. Набор, согласованный при проверке безопасности (находка В-1 в `SECURITY.md`), для всех путей:

| Заголовок | Значение |
|---|---|
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `accelerometer=(), gyroscope=(), magnetometer=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), midi=(), display-capture=(), xr-spatial-tracking=(), browsing-topics=()` |

Дополнение для страниц кабинета. В согласованный набор оно не входило и следует из требований к серверу (`SECURITY.md`, раздел для сервера, пункт 11): для `/ru/account/*` и `/en/account/*` — `Referrer-Policy: no-referrer` и `Cache-Control: no-store`. Адрес записи `/account/record/{id}/{hash}/` открывает её без входа, поэтому он не должен ни уходить как источник перехода, ни оставаться в кешах. В коде страницы кабинета уже отдают `<meta name="referrer" content="no-referrer">`; заголовки — требование к хостингу и к будущему серверу.

Этот набор стоит на живом сайте с 12.11.2026, 12:21 по Дубаю; находка В-1 этим закрыта. Это четыре правила для пути `/*` в настройках сервиса Render (Dashboard → сервис → Headers; там же их смотрят и меняют). Проверено запросами 12.11.2026: в 12:23 шесть адресов (`/ru/`, `/en/booking/`, `/ru/lp/a/`, `/ru/account/`, страница записи в кабинете, `/robots.txt`), в 12:29 при повторной проверке безопасности — 23 адреса из 23. Дополнения для кабинета на хостинге нет: страницы кабинета приходят с общими `Referrer-Policy: strict-origin-when-cross-origin` и `Cache-Control: public, max-age=0, s-maxage=300`. Проверить самостоятельно: `curl -sI https://<сайт>/ru/` и `curl -sI https://<сайт>/ru/account/`. Полной политики `Content-Security-Policy` с ограничением источников скриптов нет: статический экспорт Next вставляет в страницы встроенные скрипты. Стартовый вариант и порядок включения — в `SECURITY.md` (находка Ж-7); сделать до подключения GTM.

Ещё два наблюдения по живому сайту, которые правятся заголовками: `/site.webmanifest` отдаётся с типом `binary/octet-stream` (нужен `Content-Type: application/manifest+json`), а каждый ответ несёт `X-Robots-Tag: noindex, nofollow` (см. «Открытие для поисковых систем»).

### Что сверено с живым сайтом 12.11.2026

Запросы к `https://bodymechanic-site.onrender.com` показали:

- `/robots.txt` отвечает `Disallow: /` и строкой `Sitemap:` с адресом сайта;
- `/en/` содержит canonical на тот же домен и `noindex, nofollow`; упоминания `googletagmanager` в HTML нет;
- `/en/services` без косой черты в конце открывается со статусом 200;
- `/ru/account/record/1234/abcd/` отвечает 200 и отдаёт русскую страницу «Мои записи», то есть подмена работает;
- `/en/no-such-page/` отвечает 404;
- `/sitemap.xml` содержит 52 адреса;
- файлы из `/models/` и `/_next/static/` приходят с `Cache-Control: public, max-age=31536000, immutable`;
- HTML, `robots.txt` и `sitemap.xml` приходят с `Cache-Control: public, max-age=0, s-maxage=300`. В проекте этот заголовок не задаётся;
- текстовые ответы сжимаются brotli; файлы моделей `.glb` приходят без сжатия;
- каждый ответ несёт `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` и `X-Robots-Tag: noindex, nofollow`, а с 12.11.2026 — и четыре заголовка из раздела «Заголовки защиты».

## Выкладка

Автоматической проверки перед выкладкой в репозитории нет: файлов CI в нём нет, только сборка на хостинге. Порядок перед вливанием в `main`:

```
npm run lint
npm run typecheck
npm run build
npm run gate
npm run gate:clean
npm run test:matrix
```

Что делает каждая команда, написано в `TESTING.md`. Перед выкладкой серверной ветки настройте Web Service и согласуйте переключение с действующего Static Site.

## Переезд на свой домен

1. **Задать `NEXT_PUBLIC_SITE_URL`** равным новому адресу, например `https://example.ae`, и пересобрать сайт. От этой переменной зависят canonical, hreflang, адреса картинок Open Graph, `sitemap.xml`, строка `Sitemap:` в `robots.txt` и JSON-LD (`src/lib/site.ts`, `src/lib/seo.ts`, `src/lib/jsonld.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/(lp)/[locale]/lp/[variant]/page.tsx`). Других мест с адресом сайта в коде нет.
2. **Подключить домен на хостинге** и включить HTTPS. На HTTPS cookie с UTM-метками получает признак `Secure` (`src/lib/analytics/utm.ts`).
3. **Проверить правила сервиса:** обработку прямых ссылок и 404, заголовки защиты и кеширования.
4. **Проверить после выкладки** то же, что перечислено в разделе «Что сверено с живым сайтом», уже на новом домене. Тесты можно направить на выложенный сайт: `GATE_BASE_URL=https://example.ae npx playwright test`. Перед этим нужно собрать тот же коммит локально: список страниц тесты берут из локального манифеста `.next/prerender-manifest.json` (`playwright.config.ts`, `e2e/helpers.ts`).
5. **Учесть, что данные браузера привязаны к домену.** Выбор по cookie (`localStorage['bm.consent']`) и запомненный язык на новом домене начнутся с нуля: посетители снова увидят баннер.
6. **Старый адрес `…onrender.com`.** Пока он открыт, на нём доступна та же сборка. После пересборки canonical на его страницах будет указывать на новый домен. Нужна ли переадресация со старого адреса, решается на хостинге.
7. **Настройки вне кода:** домен в контейнере GTM, GA4 и рекламных кабинетах. В репозитории их нет.

Файлы `public/site.webmanifest` и `public/site.ru.webmanifest` содержат относительные адреса (`/en`, `/ru`), менять их при переезде не нужно.

## Открытие для поисковых систем

Сейчас сайт закрыт от индексации в трёх местах кода и заголовком ответа. Чтобы открыть, нужно поменять все четыре и пересобрать:

| Место | Что сейчас | Что сделать |
|---|---|---|
| `src/app/robots.ts` | `disallow: '/'` | заменить на `allow: '/'`; строку `sitemap` оставить |
| `src/lib/seo.ts`, функция `pageMetadata` | `robots: { index: false, follow: false }` для каждой страницы сайта | убрать или разрешить индексацию |
| `src/app/[locale]/layout.tsx`, функция `generateMetadata` | `robots: { index: false, follow: false }` по умолчанию | убрать или разрешить индексацию |
| Заголовок ответа `X-Robots-Tag: noindex, nofollow` | задаётся в `next.config.ts` для Node-сервиса и отдельным правилом на действующем Static Site | обновить настройки целевого сервиса и проверить ответ: `curl -sI https://<сайт>/ru/` |

Что остаётся закрытым намеренно:

- страница выбора языка `/` (`src/app/(root)/layout.tsx`);
- страница 404 (`src/app/global-not-found.tsx`);
- рекламные лендинги: `noindex` стоит в раскладке и в самой странице, в `sitemap.xml` их нет (`src/app/(lp)/[locale]/layout.tsx`, `src/app/(lp)/[locale]/lp/[variant]/page.tsx`).

Функция `pageMetadata` общая для всех страниц сайта, включая запись. Страницы кабинета собирают метаданные через `privateMetadata` (та же функция плюс запрет передавать адрес как источник перехода): их стоит оставить закрытыми, для этого `noindex` нужно будет задать в ней отдельно.

### Тесты, которые сейчас требуют закрытого сайта

После открытия они упадут, их нужно поправить вместе с кодом:

| Файл | Что проверяет |
|---|---|
| `e2e/helpers.ts`, функция `domChecks` | на каждой странице есть `noindex` и `nofollow`; через неё проверку получают `pages.spec.ts`, `flows.spec.ts`, `layout-smoke.spec.ts` |
| `e2e/flows.spec.ts` | `robots.txt` содержит `Disallow: /` |
| `e2e/seo.spec.ts` | `robots.txt` содержит `Disallow: /` |

Проверки `noindex` у страницы `/`, у страницы 404 (обе в `e2e/flows.spec.ts`) и у лендингов (`e2e/lp.spec.ts`) должны остаться.

### Что проверить до открытия

Это следует из кода, а не из правил поисковых систем:

- После открытия индексации поисковики могут обнаружить демонстрационные страницы по публичным ссылкам. [Состав серверной карты сайта](ANALYTICS-SEO.md#robotstxt-и-sitemapxml)
- **Плашка «Демо»** показывается на каждой странице сайта (`src/app/[locale]/layout.tsx`).
- **Телефон и часы работы в JSON-LD** появятся, когда заданы `NEXT_PUBLIC_STUDIO_PHONE` и `NEXT_PUBLIC_STUDIO_HOURS`. Адрес HDS Tower задан в конфигурации студии.
- **`NEXT_PUBLIC_SITE_URL`** должен быть настоящим доменом.
- **Запись и заявки** работают на заглушках (см. `BACKEND-CONTRACT.md`). Посетитель из поиска сможет «записаться», но запись никуда не попадёт.
- **Описание страницы записи** обещает «Запись сразу попадает в расписание студии» (`meta.booking.description`).

## Не подтверждено

1. **Правила подмены адресов в панели Render** (Redirects / Rewrites) не просматривались. В документе они приведены по прежнему `README.md`; поведение живого сайта с ними согласуется. Правила заголовков 12.11.2026 просмотрены и дополнены через API Render: их девять — четыре защитных из раздела «Заголовки защиты» и пять прежних (`X-Robots-Tag` и кеширование).
2. **Список переменных в панели Render.** Что задано, выведено из файлов живого сайта и журнала сборки (раздел «Что задано на живом сайте»).
3. **Откуда берётся `RENDER`.** Код рассчитывает, что площадка сама задаёт эту переменную при сборке. По коду это проверить нельзя.
