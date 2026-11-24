# Контракт с бэкендом

Актуальный серверный контракт реализован в Next.js через Route Handlers и server-only сервисы. [План внедрения](ALTEGIO-IMPLEMENTATION-PLAN.md)

- `POST /api/booking/record` принимает `serviceIds: number[]` или совместимый `serviceId: number`. Для массива результат `201` включает `serviceIds`, `services: [{ id, title }]`, номер записи, исходное время и доступные `staff`, `durationSeconds` и `parts`. Запрос с одиночным `serviceId` сохраняет прежний ответ. [Контракт](../src/lib/contracts/booking-record.ts)
- `POST /api/booking/record/status` принимает `{ idempotencyKey, recoveryKey, locale }` от того же origin. Клиент передаёт отдельный UUID `recoveryKey` при создании записи и сохраняет его до завершения попытки. Маршрут возвращает сохранённое подтверждение, сохранённую ошибку или `202` с `status: "processing" | "unknown"`. Заголовок `X-Booking-Outcome: stored` обозначает результат чтения хранилища. Отсутствующая и истёкшая попытки или несовпадение ключа восстановления дают `unknown`. Срок хранения до 24 часов в одном процессе. Проверка статуса не создаёт запись. [Запись и восстановление результата](tasks/19-altegio-multiple-services-booking.md#193-подтверждение-результат-и-сквозная-проверка)

## Исходное состояние прототипа

**Бэкенда нет. Базы данных нет.** В репозитории только фронтенд, который собирается в статические файлы (`next.config.ts`: `output: 'export'`). Запись на приём, личный кабинет и заявки с рекламных лендингов работают на заглушках, которые выполняются в браузере посетителя.

Что это значит на живом сайте сегодня:

- запись на приём **нигде не создаётся**: шаг «Готово» показывает демо-номер 9001 (`src/lib/api/mock-data.ts`, `DEMO_RECORD`);
- заявка с лендинга **никуда не уходит**: ни в CRM, ни в Telegram, ни на почту (`src/lib/lp/bff-mock.ts`, первая строка описания: «Nothing leaves the browser»);
- вход в «Мои записи» **не проверяет ни телефон, ни код**: любой номер и любой непустой код открывают три демо-записи (`src/components/account/Account.tsx`, функции `send` и `login`);
- расписание, специалисты и цены — демо-данные из `src/lib/api/mock-catalog.json`.

Посетитель об этом предупреждён: на каждой странице сайта есть полоса «Демо» (`src/app/[locale]/layout.tsx`, `prototype.demoNotice`), под формой лендинга — строка `lp.form.demoNotice` («Заявка не уйдёт в студию: это демо»).

Этот документ описывает, по какому контракту фронтенд ждёт бэкенд, что заглушка только изображает и что нужно построить, чтобы сайт начал принимать записи и заявки. В коде и в ТЗ серверная часть называется BFF (Backend for Frontend), будущая работа — «этап 2» (stage 2).

Спецификация, из которой взят контракт: техническое задание заказчика, версия 1.1 от 24.09.2026, разделы 07–09. Файла задания в репозитории нет: ТЗ передаётся заказчиком отдельно. Что из него сделано — в `docs/spec/README.md`.

## 1. Как заглушка встроена

| Что | Где | Комментарий |
|---|---|---|
| Типы контракта | `src/lib/api/types.ts` | Компоненты знают только эти типы |
| Функции записи и кабинета | `src/lib/api/index.ts` | Сигнатуры повторяют маршруты `/api/booking/*` и `/api/account/*` |
| Ошибки | `src/lib/api/errors.ts` | `ApiError` с полем `kind` |
| Демо-данные | `src/lib/api/mock-data.ts`, `mock-catalog.json` | Услуги, специалисты, статьи, правила «зона → услуга» |
| Режимы заглушки | `src/lib/api/mock-flags.ts` | `?mock=…`, только для автотестов, см. раздел 8 |
| Крючок автотестов | `src/lib/dev/test-hook.ts` | Единственный вход тестов в заглушки, см. раздел 8 |
| Заявка с лендинга | `src/lib/lp/lead.ts` | Собирает тело `POST /api/lp/lead` |
| «Сервер» лендинга | `src/lib/lp/bff-mock.ts` | Повторяет правила сервера, ничего не отправляет |
| Комментарий к записи | `src/lib/altegio/formatComment.ts` | Чистая функция; на этапе 2 должна выполняться на сервере |

Замысел подключения записан в начале `src/lib/api/index.ts`: тела функций заменяются на `fetch('/api/booking/…')`, компоненты не меняются. Для лендинга строка замены лежит в `postLead` (`src/lib/lp/lead.ts`): `fetch('/api/lp/lead', { method: 'POST', body: JSON.stringify(req), keepalive: true })`.

### Где вызываются функции

Это важно для архитектуры этапа 2: часть функций вызывается **при сборке**, и их результат попадает в статический HTML.

| Когда | Функции | Кто вызывает |
|---|---|---|
| При сборке (серверные компоненты) | `getServices`, `getCategories`, `getStaff`, `getArticles`, `serviceSlugs`, `staffSlugs`, `articleSlugs` | страницы `src/app/[locale]/**/page.tsx`, `src/app/sitemap.ts`, `src/components/seo/PageLd.tsx` |
| В браузере | `getStaff`, `getDates`, `getTimes`, `postCode`, `postCheck`, `postRecord`, `recommendServices` | `src/components/booking/useBookingFlow.ts` |
| В браузере | `getDates`, `getTimes`, `postRecord` | `src/components/booking/QuickForm.tsx` (форма «Начните с себя» на главной) |
| В браузере | `getDates`, `getTimes` | `src/components/team/NearestSlots.tsx` |
| В браузере | `postCode`, `getAccountRecords`, `cancelRecord`, `rescheduleRecord`, `getDates`, `getTimes` | `src/components/account/Account.tsx` |
| В браузере | `postLead` → `receiveLead` | `src/components/lp/LeadForm.tsx` |

Следствие: каталог услуг, цены, список специалистов и статьи сейчас «запечены» в HTML на момент сборки. Когда они начнут приходить из Altegio и CMS, нужно выбрать один из путей: пересборка по вебхуку, отказ от статического экспорта в пользу серверного рендера или загрузка каталога в браузере. В коде это решение не принято.

## 2. Типы

Файл `src/lib/api/types.ts`. Типы `BodyMarker`, `BookingDraft`, `Contact` совпадают с «Внутренними типами» ТЗ §08.

```ts
type Locale = 'ru' | 'en';
type ZoneId = string; // ключ зоны, у парных зон с суффиксом стороны: knee_l, chest

interface BodyMarker {
  id: string;
  zoneId: ZoneId;
  position: [number, number, number];
  note?: string;
  intensity?: number; // 1–10
}

interface BookingDraft {
  model: 'male' | 'female';
  markers: BodyMarker[];
  generalNote?: string;
  serviceIds: number[];
  staffId: number;      // 0 = любой специалист
  datetime?: string;    // ISO, +04:00
  utm?: Record<string, string>;
  locale: Locale;
}

interface Contact {
  fullname: string;
  phone: string;        // E.164
  email?: string;
  age?: number;
}

interface Service {
  id: number; title: string; categoryId: number; categoryTitle: string;
  priceMin: number | null; priceMax: number | null;
  priceOnRequest: boolean;      // true → «Цена — по запросу»
  durationMin: number | null;
  description: string;          // только прототип (этап 2: CMS)
  slug: string;                 // только прототип: адрес /services/[slug]
  hasCms: boolean;              // только прототип
}

interface Staff {
  id: number; name: string; position: string;
  avatarUrl: string | null; rating: number | null;
  nearestSlot: string | null;   // ISO
  slug: string;                 // только прототип: /team/[slug]
  placeholder: boolean;         // только прототип: демо-карточка без реального человека
}

interface Slot { datetime: string; time: string } // ISO с +04:00, "HH:mm"

type CheckResult  = { ok: true } | { error: 'slot_taken' };
type RecordResult = { status: 'created'; recordId: number; hash: string } | { status: 'queued' };

interface AccountRecord {
  id: number; hash: string; datetime: string;
  serviceTitle: string; staffName: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed';
  zones: ZoneId[];
  serviceId?: number; staffId?: number; durationMin?: number | null;
}

interface JournalArticle { slug: string; title: string; category: string; excerpt: string }
type ZoneServiceRules = Record<string, number[]>; // зона без суффикса стороны → id услуг
```

Поля с пометкой «только прототип» в таблице маршрутов ТЗ §08 отсутствуют: их добавил фронтенд, чтобы строить страницы услуг и специалистов без CMS. На этапе 2 их источник нужно определить (CMS или Altegio).

Тело запроса на создание записи (`src/lib/api/index.ts`):

```ts
interface RecordRequest {
  draft: BookingDraft;
  contact: Contact;
  code?: string;            // SMS-код, только если включён флаг NEXT_PUBLIC_BOOKING_SMS_REQUIRED
  captchaToken: string;
  idempotencyKey: string;   // UUID, создаётся в браузере один раз на форму
  source: '3d' | 'form';    // сценарий с 3D-моделью или форма на главной
}
```

Поле `source` в таблице ТЗ не названо: фронтенд добавил его, чтобы сервер выбирал префикс комментария `[Сайт/3D]` или `[Сайт/форма]`.

## 3. Запись на приём: функции и маршруты

Все функции лежат в `src/lib/api/index.ts`. Колонка «Маршрут» — то, что функция заменяет на этапе 2 (комментарии над функциями и ТЗ §08).

| Функция | Маршрут | Вход | Выход | Ошибки | Что делает заглушка |
|---|---|---|---|---|---|
| `getServices(locale)` | `GET /api/booking/services?locale=` | язык | `Service[]` | нет | Отдаёт 10 услуг из `mock-catalog.json`, id с 101 |
| `getCategories(locale)` | отдельного маршрута нет | язык | `{ id, slug, title }[]` | нет | 2 категории: «Массаж», «Реабилитация» |
| `getStaff(locale, serviceId?)` | `GET /api/booking/staff?serviceId=` | язык, услуга | `Staff[]` | `network`, `server` (только в режимах заглушки) | 4 карточки «Специалист студии N» (id 201–204), `nearestSlot` выдуман: завтра + N дней |
| `calendarDays(today?)` | нет (вспомогательная) | дата | 30 дат от сегодня (Дубай) | нет | — |
| `getDates(serviceId, staffId)` | `GET /api/booking/dates?serviceId=&staffId=` | услуга, специалист | `string[]` (`YYYY-MM-DD`) | `network`, `server` | 30 дней, пятницы закрыты и ещё один день в неделю; режим `nodates` → пусто |
| `getTimes(serviceId, staffId, date)` | `GET /api/booking/times?serviceId=&staffId=&date=` | услуга, специалист, дата | `Slot[]` | `network`, `server` | Сетка 10:00–20:00 через 30 минут, часть слотов убрана по формуле |
| `postCode(phone)` | `POST /api/booking/code` | телефон | `{ sent: true }` | нет | Всегда `{ sent: true }`, SMS не отправляется |
| `postCheck(draft)` | `POST /api/booking/check` | `BookingDraft` | `CheckResult` | `network`, `server` | Слот 13:30 всегда «занят»; режим `slot_taken` → первый запрос «занят» |
| `postRecord(req)` | `POST /api/booking/record` | `RecordRequest` | `RecordResult` | `captcha` (нет токена), `network`, `server` | Всегда `{ status: 'created', recordId: 9001, hash: 'demo-hash' }`; режим `queued` → `{ status: 'queued' }` |
| `recommendServices(zoneIds, rules?)` | нет (расчёт в браузере) | зоны | id услуг по убыванию совпадений | нет | Правила `ZONE_RULES` — демо (`mock-data.ts`) |
| `getZoneRules()` | не определён (ТЗ 6.6: правила из CMS) | — | `ZoneServiceRules` | нет | Демо-таблица |
| `getArticles(locale)` | не определён (ТЗ §15: CMS) | язык | `JournalArticle[]` | нет | 3 «Демо-статьи» |

Подробности, которые бэкенду нужно повторить или заменить:

- **Часовой пояс.** Все даты и время — Дубай, `+04:00` (`DUBAI_OFFSET` в `index.ts`, `timeZone: 'Asia/Dubai'` в `src/i18n/request.ts`).
- **Идемпотентность записи.** Ключ создаётся в браузере (`crypto.randomUUID()`, `useBookingFlow.ts` и `QuickForm.tsx`). Заглушка хранит ответы в `Map` в памяти вкладки и на повтор с тем же ключом отдаёт первый ответ. По ТЗ §07 сервер хранит ключ 24 часа.
- **Проверка слота перед записью.** `useBookingFlow.confirm` сначала вызывает `postCheck`, при `slot_taken` возвращает посетителя на шаг 4 и перезапрашивает время. Занятый слот заглушка запоминает в `sessionStorage['bm.takenSlots']`.
- **Капча.** На шаге 6 через 600 мс появляется токен вида `demo-…` (`useBookingFlow.ts`). Форма на главной шлёт строку `demo-quick-form` (`QuickForm.tsx`). Виджета Turnstile на сайте нет; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` читается в `src/lib/config.ts`, но нигде не используется.
- **SMS на шаге 6.** Включается флагом сборки `NEXT_PUBLIC_BOOKING_SMS_REQUIRED=true` (`src/lib/config.ts`). По умолчанию выключено, на живом сайте выключено. При включении `confirm` сначала вызывает `postCode`, затем передаёт `code` в `postRecord`. Заглушка код не проверяет.
- **Статус `queued`.** По ТЗ §07 сервер отвечает так, если Altegio не ответил за 10 секунд или вернул 5xx: заявка уходит в резервную очередь и в Telegram. Фронтенд показывает отдельный экран и не считает такую заявку записью (событие `booking_success` не отправляется).
- **Комментарий к записи.** В нём заметки посетителя о самочувствии, поэтому в браузере посетителя он не собирается и нигде не хранится. `postRecord` строит его через `formatComment` только в автотесте и отдаёт в приёмник теста (раздел 8). На этапе 2 комментарий строит сервер. Формат: префикс источника, пол и возраст, зоны с интенсивностью и заметками, общее состояние, строка UTM; не длиннее 1000 символов, укорачивается только свободный текст посетителя (`src/lib/altegio/formatComment.ts`, шаблон и примеры в `comment-data.json`).

Пример комментария (режим `both`, из `comment-data.json`):

```
[Сайт/3D] Пол / Gender: М / M · Возраст / Age: 34
Зоны / Areas: 1) Поясничный отдел / Lower back — 6/10 — «тянет после бега»; 2) Задняя поверхность бедра, левая сторона / Back of thigh, left side — 4/10
Состояние / Condition: готовлюсь к полумарафону, боль после длинных пробежек
UTM: google / cpc / sports_massage
```

Соответствие полей записи полям Altegio (ТЗ §08, таблица «Передача данных в запись»): имя, телефон, email → `fullname`, `phone`, `email`; услуги → `appointments[0].services`; специалист → `appointments[0].staff_id` (0 — любой); дата и время → `appointments[0].datetime`. Проверить по действующей документации Altegio: в этом репозитории запросов к Altegio нет.

## 4. Личный кабинет: функции и маршруты

| Функция | Маршрут | Вход | Выход | Ошибки | Что делает заглушка |
|---|---|---|---|---|---|
| — (функции нет) | `POST /api/account/login` | `{ phone, code }` | httpOnly cookie сессии (ТЗ §08) | — | **Не реализовано.** Компонент после ввода любого кода сразу вызывает `getAccountRecords` |
| `postCode(phone)` | `POST /api/booking/code` | телефон | `{ sent: true }` | нет | Общая с записью. Лимит «3 кода за 10 минут» считает сам браузер в `sessionStorage['bm.smsSent']` (`Account.tsx`) |
| `getAccountRecords(locale)` | `GET /api/account/records` | язык | `{ upcoming: AccountRecord[]; past: AccountRecord[] }` | `network`, `server` | Три записи: 9001 через 3 дня, 9002 через ~12 часов (перенос и отмена уже недоступны), 9000 в прошлом |
| `cancelRecord(record)` | `DELETE /api/account/records/:id` | запись | `{ cancelled: true }` | `tooLate`, `network`, `server` | Запоминает отмену в `sessionStorage['bm.accountMock']` |
| `rescheduleRecord(record, datetime)` | `PATCH /api/account/records/:id` | запись, новое время | `AccountRecord` | `tooLate`, `network`, `server` | Запоминает новое время там же |
| `tooLate(datetime)`, `MIN_NOTICE_HOURS` | нет (расчёт в браузере) | время записи | boolean | — | Порог 24 часа зашит константой; по ТЗ §09 срок берётся из настроек Altegio |

Что отсутствует и должно появиться:

- **Сессия.** Функции `postLogin` во фронтенде нет. По ТЗ §09 вход — телефон и SMS-код, сессия — httpOnly cookie на 30 дней, токен пользователя Altegio хранится на сервере. Сейчас «вход» — состояние React-компонента: после перезагрузки страницы форма входа показывается снова.
- **Запись по ссылке.** Адрес `/{locale}/account/record/{id}/{hash}/`. Страница читает `id` и `hash` из адреса (`RecordFromUrl` в `Account.tsx`) и ищет запись в ответе `getAccountRecords`. В статическом экспорте существует только страница демо-записи `9001/demo-hash`; остальные адреса обслуживает правило rewrite на Render (см. `CONFIG-DEPLOY.md`). Проверки, что `hash` подходит к записи, на сервере нет, потому что сервера нет.
- **Ответ `too_late`.** Сервер по ТЗ отвечает `{ error: "too_late" }`; фронтенд ждёт `ApiError('tooLate')`.

## 5. Заявка с лендинга

Форма: `src/components/lp/LeadForm.tsx`. Тело запроса собирает `buildRequest` в `src/lib/lp/lead.ts`.

```ts
// POST /api/lp/lead
interface LeadRequest {
  eventId: string;              // UUID v4 = ключ идемпотентности = event_id события Meta (Pixel + CAPI)
  lang: string;                 // 'ru' | 'en'
  version: 'A' | 'B';           // /lp/a или /lp/b
  name: string;
  phone: string;                // E.164
  interests: string[];          // id отмеченных чипов из src/lib/lp/config.json
  consent: { privacy: true; details: boolean; analytics: boolean; marketing: boolean };
  offerId: string;              // config.json → offer.id
  attribution: {
    utm: { source, medium, campaign, content, term }; // string | null
    firstTouchAt: string | null;                       // ISO, +04:00
    clickIds: { gclid, gbraid, wbraid, fbclid };       // string | null
    fbp: string | null;                                // cookie _fbp, если есть
    fbc: string | null;                                // cookie _fbc или fb.1.<ms>.<fbclid>
  };
  page: { url: string; referrer: string };             // url без utm_term и utm_content
}

interface LeadResult { status: 'ok' | 'queued'; eventId: string }
```

Откуда значения:

- `consent.privacy` всегда `true`: согласием считается сама отправка формы (текст под кнопкой, `lp.consent.submit`);
- `consent.details` — отдельная галочка, обязательна, только если отмечен хотя бы один чип;
- `consent.analytics` и `consent.marketing` — выбор из баннера cookie (`localStorage['bm.consent']`);
- `attribution` — из `sessionStorage['bm_attr']` (`src/lib/lp/attr.ts`): UTM первого визита, идентификаторы клика по последнему клику.

Правила, которые `receiveLead` (`src/lib/lp/bff-mock.ts`) повторяет за будущим сервером:

| Правило | Как в заглушке | Что ждёт фронтенд от сервера |
|---|---|---|
| Только известные поля | Функция `known` пересобирает запрос из перечисленных полей, остальное отбрасывает | То же: неизвестные поля не сохранять |
| Проверка полей | `eventId` — UUID v4; `lang` — `ru` или `en`; `version` — `A` или `B`; `name` непустое, до 100 символов, без управляющих символов; `phone` — `^\+[1-9]\d{7,14}$`; `interests` — только известные id чипов; чипы без `consent.details` — ошибка; `offerId` равен офферу из настроек; `page.url` — адрес лендинга этого же сайта (`http` или `https`, путь `/{ru\|en}/lp/{a\|b}/`), до 2048 символов | Ошибка → `ApiError('server')` (в комментарии кода: «400 at stage 2»). Оффер сервер берёт из своих настроек, а не из запроса; источник страницы сверяет со своим адресом сайта |
| Метки и идентификаторы кликов | UTM — строка до 100 символов без управляющих символов; идентификаторы кликов — `^[\w.-]{1,500}$` (тот же шаблон `CLICK_ID` в `src/lib/lp/attr.ts`); `fbp` и `fbc` — `fb.<n>.<мс>.<значение>`. Значение, не прошедшее проверку, становится `null` | Так же: плохая метка не должна отклонять заявку |
| Нейтральные метки | `utm.content` и `utm.term` проходят, только если соответствуют `^[a-z]{2}_[a-z0-9]{1,8}$`, иначе `null` | То же на сервере, значение не логировать |
| Экранирование | В шаблоне сообщения администраторам экранируется каждое значение, включая проверенные (`esc` в `telegramMessage`) | То же; правила для выгрузок — в `SECURITY.md` |
| Идемпотентность | Повтор с тем же `eventId` в течение 24 часов возвращает первый ответ (память вкладки и `sessionStorage['bm.lp.sent']`) | Хранить ключ 24 часа |
| Ограничение частоты | Не больше 5 заявок за 10 минут → `ApiError('rateLimit')` («429 at stage 2») | Настоящий лимит по IP и номеру |
| Резервная очередь | Режим `?mock=queued` → `status: 'queued'` | Тот же статус, если система записи не ответила |

Два замечания проверки безопасности для сервера, которых в заглушке нет:

- тело запроса, которое не является объектом JSON (строка, массив, `null`), должно давать ответ 400, а не 500: заглушка получает объект от собственного кода и этот случай не проверяет;
- на сайте UTM-метки записи перед вставкой в комментарий не очищаются от переводов строк (`src/lib/analytics/utm.ts` обрезает только длину). Сервер, который строит комментарий, должен убирать управляющие символы из каждого значения, иначе меткой можно дописать в комментарий свои строки.

После ответа `ok` или `queued` форма заменяется на «спасибо» и только тогда отправляет событие `lp_lead` в `dataLayer` (`trackLead`). При ошибке — событие `lp_form_error` с типом `server`.

Откуда берутся UTM (`captureAttribution` в `src/lib/lp/attr.ts`): внутри сессии вкладки побеждает первый визит; в новой вкладке с метками в адресе — метки этого визита; в новой вкладке без меток — UTM из cookie `bm_utm`, если она есть (пишется и читается только с согласием «Аналитика» или «Маркетинг»), время первого визита в этом случае `null`. Идентификаторы кликов в cookie не хранятся.

Что заглушка **собирает только в автотесте и никуда не отправляет** (в браузере посетителя эти объекты не создаются, в `window` и в консоль ничего не попадает; тест получает их через приёмник, раздел 8):

1. **Сообщение в Telegram для администраторов** (`telegramMessage`): версия лендинга, язык, время в Дубае, имя, телефон со ссылкой `wa.me`, оффер, UTM, идентификаторы клика, путь страницы, согласия, статус очереди, первые 8 символов `eventId`. Отмеченные чипы в сообщение не попадают: если посетитель отметил хотя бы один, вместо перечня идут строки «Есть отметки: да» и подсказка (`config.json` → `notifications.telegram.includeMarks = false`; включать только после ответа юристов, см. `KNOWN-ISSUES.md`, раздел 4). Тексты этих двух строк (`marksLineRu`, `marksHintRu` в `src/lib/lp/config.json`) и сам шаблон сообщения сейчас входят в код страницы: это содержимое заглушки сервера. Вместе с заглушкой шаблон переезжает на сервер, и в клиентском коде этих строк остаться не должно.
2. **Событие Meta Conversions API** (`capiEvent`) — только при `consent.marketing`: `event_name: 'Lead'`, `event_id = eventId`, `event_source_url` — адрес без параметров, `user_data`: `ph` и `fn` как SHA-256, `client_user_agent`, `fbc`, `fbp`; `custom_data` — только `lp_version`. Поле `client_ip_address` в заглушке `null`: его должен подставить сервер.
3. **Запись для выгрузки конверсий Google Ads** (`adsRecord`) — только при `consent.marketing`: `order_id = eventId`, время, `gclid` (если есть), из пары `wbraid` / `gbraid` только один (`googleClickIdsToSend` в `attr.ts`), SHA-256 телефона, отметка согласия `ad_user_data` и `ad_personalization` = `GRANTED`.
4. **Комментарий для Altegio** с префиксом `[Сайт/LP]` и UTM первого визита (`formatComment({ source: 'lp', utm })`).

Токены Telegram, Meta и Google должны жить только в переменных окружения сервера и никогда не в `NEXT_PUBLIC_*` (комментарий в `bff-mock.ts`, правило ТЗ: «Секреты только на сервере»).

## 6. Ошибки

`src/lib/api/errors.ts`:

```ts
type ApiErrorKind = 'network' | 'server' | 'tooLate' | 'rateLimit' | 'captcha';
class ApiError extends Error { kind: ApiErrorKind }
const errorKind = (e: unknown) => (e instanceof ApiError ? e.kind : 'network');
```

Любое исключение, которое не является `ApiError`, интерфейс считает ошибкой сети. Тексты ошибок берутся из словарей: `booking.error.*`, `account.*`, `lp.error.*`. У каждого шага с данными есть состояния «загрузка», «ошибка» с кнопкой «Повторить» и «пусто» (`useAsync` в `useBookingFlow.ts`).

Когда тела функций станут настоящими запросами, код HTTP нужно будет переводить в `kind`. В коде это не написано; предложение по соответствию (не существующая реализация):

| Ответ сервера | `kind` |
|---|---|
| нет сети, таймаут | `network` |
| 5xx, 400 | `server` |
| 429 | `rateLimit` |
| отказ проверки капчи | `captcha` |
| `{ error: "too_late" }` | `tooLate` |
| `{ error: "slot_taken" }` | не ошибка: значение `CheckResult` |

## 7. Что заглушка только изображает

| Что видит посетитель | Что происходит на самом деле |
|---|---|
| Свободные даты и время | Формула в `getDates` и `getTimes`, к расписанию студии отношения не имеет |
| «Запись оформлена», номер 9001 | Запись не создана нигде |
| «Заявка принята» (`queued`) | Очереди нет |
| «Мы отправили код на номер…» | SMS не отправляется, код не проверяется |
| Проверка «я не робот» на шаге 6 | Таймер 600 мс и строка `demo-…` |
| Вход в «Мои записи» | Проверки нет, показываются три демо-записи |
| Отмена и перенос записи | Изменение в `sessionStorage` этой вкладки |
| Запись по ссылке из письма | Писем нет; открывается только демо-запись 9001 |
| «Спасибо» после формы лендинга | Заявка осталась в памяти вкладки |
| Уведомление администратору | Не отправляется; текст собирается только в автотесте |
| Событие для Meta Conversions API, выгрузка в Google Ads | Запросов нет; объекты собираются только в автотесте |
| Специалисты, рейтинги, ближайшее время | Демо-карточки без реальных людей |
| Файл `.ics`, ссылка Google Calendar, печать заявки на шаге 7 | Работают по-настоящему, но описывают несуществующую запись (`src/lib/booking/calendar.ts`) |

## 8. Режимы заглушки и крючок автотестов

Автотесты идут против той же сборки, что выложена на живой сайт, поэтому «тестового режима» у сборки нет. Вместо него один крючок, `src/lib/dev/test-hook.ts`:

- тест до загрузки скриптов страницы кладёт объект `window.__bmTest` (Playwright `page.addInitScript`, функция `testHook` в `e2e/helpers.ts`);
- приложение читает его **один раз**, при загрузке модуля; объект, появившийся в `window` позже (тег из GTM, расширение, консоль), не читается;
- поля объекта: `mock: true` — разрешить `?mock=<режим>`; `gtmId` — идентификатор тестового контейнера GTM, когда в сборке он не задан; `sink(channel, data)` — приёмник того, что собрали заглушки. Каналы: `lp-request` (тело заявки лендинга), `lp-bff` (сообщение администраторам, событие Meta, запись Google Ads, комментарий), `booking-comment` (комментарий записи).

Без крючка, то есть у любого посетителя: `?mock=` не читается и не запоминается, заглушки ничего не собирают для проверки, в `window` и в консоль ничего не пишется.

Режимы — файл `src/lib/api/mock-flags.ts`. При разрешённом крючке режим включается параметром `?mock=<режим>` в адресе любой страницы и хранится в `sessionStorage['bm.mock']` до `?mock=off` или закрытия вкладки. На сайте параметр запоминает компонент `src/components/dev/MockFlags.tsx` (подключён в раскладке сайта), на лендинге его читает сама заглушка при отправке формы.

| Режим | Что делает |
|---|---|
| `queued` | `postRecord` и `receiveLead` отвечают `queued` |
| `slot_taken` | Первая проверка слота отвечает «занят» для любого времени (один раз на вкладку) |
| `offline` | Первый вызов каждой функции падает с ошибкой сети, повтор проходит |
| `server` | То же с ошибкой сервера |
| `nodates` | `getDates` возвращает пустой список |
| `off` | Сбрасывает режим |

Без режима: слот 13:30 всегда «занят», остальное проходит.

**Работает ли на живом сайте: нет.** Код заглушки входит в сборку, но без крючка автотеста параметр `?mock=` ничего не делает: ссылкой нельзя заставить форму в чужой вкладке показать ошибку или «заявка принята» (проверяют `e2e/seo.spec.ts` и `e2e/lp-tracking.spec.ts`). До RC-9 режимы включались у любого посетителя. После подключения настоящего бэкенда файлы `mock-flags.ts`, `test-hook.ts`, компонент `MockFlags` и вызовы `failOnce` / `mockMode` нужно убрать из сборки вместе с заглушками.

## 9. Что построить, чтобы сайт начал принимать записи и заявки

Ниже предложение, выведенное из типов фронтенда и ТЗ. Это **не существующая схема**: ни одной из этих таблиц, очередей и интеграций в репозитории нет.

### 9.1. Где будет жить сервер

Статический экспорт не умеет выполнять серверный код. Два пути:

1. **Отдельный сервис** с маршрутами `/api/*` рядом со статическим сайтом. Фронтенд остаётся как есть; нужен общий домен или настройка CORS и cookie для сессии кабинета.
2. **Серверный режим Next.js**: убрать `output: 'export'` из `next.config.ts`, добавить Route Handlers в `src/app/api/`, перевести сервис Render со статического сайта на веб-сервис. Тогда правила rewrite и заголовки переезжают из панели Render в код, скрипты `fix-export-segments` и `lp-postexport` нужно перепроверить.

ТЗ §08 описывает второй путь («BFF (Next.js)»), но в коде выбор не сделан.

### 9.2. Маршруты

| Маршрут | Назначение | Источник |
|---|---|---|
| `GET /api/booking/services?locale=` | Каталог услуг | ТЗ §08 |
| `GET /api/booking/staff?serviceId=` | Специалисты | ТЗ §08 |
| `GET /api/booking/dates?serviceId=&staffId=` | Свободные даты на 30 дней | ТЗ §08 |
| `GET /api/booking/times?serviceId=&staffId=&date=` | Свободное время | ТЗ §08 |
| `POST /api/booking/code` | SMS-код, не больше 3 на номер за 10 минут | ТЗ §08 |
| `POST /api/booking/check` | Проверка слота перед записью | ТЗ §08 |
| `POST /api/booking/record` | Создание записи, идемпотентность 24 часа, резервная очередь | ТЗ §07–08 |
| `POST /api/account/login` | Вход по телефону и коду, cookie сессии | ТЗ §08; во фронтенде функции нет |
| `GET /api/account/records` | Записи клиента | ТЗ §08 |
| `PATCH /api/account/records/:id` | Перенос | ТЗ §08 |
| `DELETE /api/account/records/:id` | Отмена | ТЗ §08 |
| `POST /api/altegio/webhook` | Сброс кешей по событиям Altegio | ТЗ §08; фронтенда не касается |
| `POST /api/lp/lead` | Заявка с лендинга | `src/lib/lp/lead.ts` |
| способ не определён | Запись по ссылке `id` + `hash` без входа | ТЗ §09 |
| способ не определён | Статьи журнала, правила «зона → услуга», тексты страниц | ТЗ §15 (CMS) |

### 9.3. Сущности и поля (предложение)

| Сущность | Поля, выведенные из типов | Зачем |
|---|---|---|
| Заявка с лендинга | `eventId`, `createdAt`, `lang`, `version`, `name`, `phone`, `interests[]`, `consent{privacy, details, analytics, marketing}`, `offerId`, `utm{source, medium, campaign, content, term}`, `firstTouchAt`, `clickIds{gclid, gbraid, wbraid, fbclid}`, `fbp`, `fbc`, `pageUrl`, `referrer`, `status(ok / queued)` | `LeadRequest`, `LeadResult` |
| Запрос на запись | `idempotencyKey`, `createdAt`, `source(3d / form)`, `locale`, `serviceIds[]`, `staffId`, `datetime`, `model`, `generalNote`, `utm`, `status(created / queued)`, `altegioRecordId`, `altegioHash` | `RecordRequest`, `RecordResult` |
| Маркер зоны | `requestId`, `zoneId`, `intensity(1–10)`, `note`, `position[x, y, z]` | `BodyMarker` |
| Контакт | `fullname`, `phone`, `email`, `age` | `Contact` |
| Согласия | кто, когда, на что (обработка данных, сведения о самочувствии, аналитика, маркетинг), версия текста | Галочки шага 5 (`consent`, `health`), `LeadRequest.consent` |
| Ключи идемпотентности | ключ, первый ответ, срок 24 часа | ТЗ §07, `bff-mock.ts` |
| Коды SMS и сессии | телефон, код, срок, число попыток; сессия на 30 дней | ТЗ §08–09 |
| Резервная очередь | заявка целиком, причина, статус обработки | ТЗ §07 |

Как хранить (требования из `SECURITY.md`, раздел для сервера): ключ ссылки на запись (`hash`) — только в виде хеша, со сроком действия и отзывом после отмены записи (пункт 5); маркеры зон, заметки, возраст и контакты — минимум данных, шифрование при хранении, ограниченный доступ и срок хранения (пункт 7).

Нужна ли своя база для записей, решает архитектура: по ТЗ §08 единственный источник данных о записях — Altegio, сайту достаточно кеша и хранилища для ключей, кодов, сессий и очереди (в ТЗ назван Redis). Заявкам с лендинга своё хранилище нужно: в Altegio они записями не становятся, пока администратор не подтвердил время.

### 9.4. Интеграции

| Что | Для чего | Что уже есть во фронтенде |
|---|---|---|
| Altegio | Услуги, цены, специалисты, расписание, записи | Типы и текст комментария (`formatComment`) |
| SMS-провайдер | Коды входа и подтверждения | Экраны ввода кода, таймер повтора |
| Cloudflare Turnstile | Защита форм от ботов | Место под виджет на шаге 6, поле `captchaToken`; на лендинге капчи в запросе нет |
| Telegram | Уведомление администраторам, резервная очередь | Шаблон сообщения в `bff-mock.ts` |
| Meta Conversions API | Серверное событие `Lead` с тем же `event_id`, что у Pixel | Состав события в `bff-mock.ts` |
| Google Ads (выгрузка конверсий) | Конверсия «LP Lead» по идентификатору клика | Состав записи в `bff-mock.ts`. По сведениям команды на ноябрь 2026 года для новых подключений выгрузка идёт через Data Manager API, а не через `UploadClickConversions`; сверить с действующей документацией Google |
| CMS | Тексты услуг, статьи, правила зон, документы | Нет; места помечены `TODO(content)` |

### 9.5. Персональные данные и сведения о самочувствии

Отмеченные зоны, интенсивность, заметки, поле «состояние» и чипы лендинга — сведения о самочувствии. Правила, которые уже соблюдает фронтенд и которые сервер не должен нарушить:

- **В рекламные системы и аналитику не уходит**: зоны, заметки, текст жалоб, чипы, название и slug услуги, имя, телефон в открытом виде. В `dataLayer` идут только числовые `service_id` и `staff_id` (`src/lib/analytics/track.ts`), на лендинге — только `lp_version`, `lang`, `placement`, `offer_id`, `event_id`, `error_type` (`src/lib/lp/track.ts`).
- **В Meta и Google уходит только с согласием «Маркетинг»**: хеши телефона и имени, идентификаторы клика. Без согласия идентификаторы остаются в заявке и никуда не передаются.
- **`event_source_url` без параметров адреса**; `utm_term` и `utm_content` принимаются только как нейтральные идентификаторы.
- **Сведения о самочувствии хранить отдельно от маркетинговых полей** и не включать в выгрузки. Сейчас их единственный получатель по замыслу — комментарий записи в Altegio.
- **Чипы лендинга не отправлять в Telegram**, пока юристы клиента не ответили (`notifications.telegram.includeMarks`).
- **Сроки хранения, право на удаление, локализация данных (ОАЭ)** в коде не решены. Тексты политики конфиденциальности и условий — `TODO(content)` (`docs.todo.privacy`, `docs.todo.terms`).

Сейчас до отправки формы данные лежат в `sessionStorage` браузера в открытом виде: черновик зон и заметок (`bm.bookingDraft`), контакты шага 5 (`bm.bookingSteps`). После успешной записи оба ключа очищаются; незавершённый черновик и подтверждение (`bm.bookingResult`) удаляются при первом чтении позже чем через сутки после последнего изменения (`src/lib/booking/draft-ttl.ts`). До этого момента они физически остаются в хранилище вкладки. Полный список ключей — в `ARCHITECTURE.md`.

Адреса с личными данными не видны счётчикам:

- на страницах кабинета `/{locale}/account/…` контейнер GTM не загружается и события не пишутся; переход между кабинетом и остальным сайтом в любую сторону идёт полной загрузкой страницы, так что адрес кабинета никогда не оказывается в одном документе с контейнером; страницы кабинета отдают `<meta name="referrer" content="no-referrer">` (`src/lib/analytics/private.ts`, `src/components/layout/PrivateBoundary.tsx`, `privateMetadata` в `src/lib/seo.ts`). Серверу остаётся: заголовки `Referrer-Policy: no-referrer` и `Cache-Control: no-store` для `/account/*`, требования к `hash` — в `SECURITY.md`;
- ссылки «WhatsApp» и «Google Календарь» на шаге 7 и в кабинете несут услугу, дату, номер записи и зоны в тексте. В разметке у них адрес сервиса без данных, полный адрес собирается в момент нажатия (`src/components/ui/PrefilledLink.tsx`).

### 9.6. Что изменить во фронтенде при подключении

- заменить тела функций в `src/lib/api/index.ts` и `postLead` в `src/lib/lp/lead.ts` на запросы;
- добавить `postLogin` и хранение сессии; перестать считать лимит SMS в браузере;
- поставить виджет Turnstile вместо демо-токена и проверять токен на сервере для трёх действий: создание записи (шаг 6 и форма на главной), заявка с лендинга, отправка SMS (`SECURITY.md`, раздел для сервера, пункт 2). В теле заявки лендинга (`LeadRequest`) и в запросе кода (`postCode`) поля для токена сейчас нет: его нужно добавить в контракт и в формы;
- убрать из сборки `mock-flags.ts`, `MockFlags`, `bff-mock.ts`, `mock-data.ts` и крючок `test-hook.ts`; тесты, которым нужен ответ сервера, перевести на перехват запросов (`page.route`);
- решить, как вернуть события кабинета (`account_login`, `booking_cancel`, `booking_reschedule`), если они нужны маркетингу: сейчас на страницах кабинета аналитики нет совсем;
- убрать полосу «Демо» и строку `lp.form.demoNotice`, когда данные станут настоящими;
- переписать тесты, которые опираются на заглушку: `e2e/flows.spec.ts`, `e2e/states.spec.ts`, `e2e/lp-tracking.spec.ts`, `e2e/seo.spec.ts`.
