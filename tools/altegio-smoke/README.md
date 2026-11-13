# Локальная проверка Altegio

Страница и API запускаются отдельным процессом Node.js 22. Все запросы к Altegio и тела POST находятся в [api.mjs](./api.mjs). Браузер обращается к локальному API и показывает HTTP-статус и тело ответа под каждой кнопкой.

## 1. Получить доступы

1. Войдите в Altegio, откройте Marketplace → Developer account → Account settings → Account details. Возьмите Partner Token. [Как получить API-ключи](https://developer.alteg.io/en/get-api-key#step-1-open-developer-account-and-get-a-partner-token)
2. Возьмите числовой ID тестового филиала у администратора. Если у вас есть ссылка на форму одного филиала, например `https://b123.alteg.io`, то `123` — ID формы. Запрос `GET /bookform/123` с Partner Token возвращает ID филиала в `data.company_id`. [Online Booking API](https://developer.alteg.io/en/public/openapi)
3. Для записи согласуйте тестовый филиал либо услугу, сотрудника, окно и номер телефона, которым вы управляете. Уточните, требуется ли SMS-подтверждение или предоплата. `notify_by_sms: 0` и `notify_by_email: 0` отключают напоминания. У филиала могут быть отдельные уведомления о создании записи.

## 2. Настроить и запустить

Из корня репозитория в PowerShell:

```powershell
Set-Location tools/altegio-smoke
Copy-Item config.env.example .env.local
git check-ignore -v -- .env.local
```

Откройте `.env.local` в редакторе. Для первого GET заполните `ALTEGIO_LOCATION_ID` и `ALTEGIO_PARTNER_TOKEN`. В поле токена вставьте только значение, без `Bearer`. `ALTEGIO_TEST_DATE`, `ALTEGIO_TEST_PHONE`, `ALTEGIO_TEST_EMAIL` и `ALTEGIO_TEST_SMS_CODE` заполните по мере прохождения шагов. Переменные, уже заданные в окружении процесса, имеют приоритет над файлом. Git игнорирует `.env.local` и файл состояния записи.

```powershell
node --env-file-if-exists=.env.local server.mjs
```

Откройте [http://127.0.0.1:4318](http://127.0.0.1:4318). После правок `.env.local` или `api.mjs` остановите сервер через Ctrl+C и запустите той же командой.

## 3. Получить услуги и выбрать окно

1. Нажмите **Получить услуги**. Успешный ответ Altegio — HTTP 200 с `success: true` и массивом `data.services`. Выберите ID реальной тестовой услуги и запишите его в `services: [ID]` в функции `testAppointment()` файла [api.mjs](./api.mjs). Перезапустите сервер.
2. Нажмите **Получить сотрудников**. Из `data` выберите ID сотрудника, доступного для записи, и задайте его в `staff_id` в той же функции. Перезапустите сервер.
3. Нажмите **Получить даты**. Возьмите дату из `data.booking_dates` и запишите её в `ALTEGIO_TEST_DATE` в формате `ГГГГ-ММ-ДД`. Перезапустите сервер.
4. Нажмите **Получить время**. Скопируйте `data[].datetime` выбранного слота в `testAppointment()` целиком, включая смещение часового пояса. Перезапустите сервер.
5. Нажмите **Проверить окно**. Ожидается HTTP 201. Этот запрос проверяет параметры. Само окно остаётся доступным для записи другим клиентам.

## 4. Создать и подтвердить одну запись

1. Задайте `ALTEGIO_TEST_PHONE` в международном формате с `+` и укажите доступный вам тестовый адрес в `ALTEGIO_TEST_EMAIL`. В запросе к этому филиалу Altegio потребовал поле `email`. При необходимости поправьте имя клиента и комментарий прямо в `testBooking()` в [api.mjs](./api.mjs). Если филиал требует подтверждение телефона, получите SMS на согласованный номер через поддерживаемый филиалом процесс (Online Booking документирует `POST /book_code/{location_id}`) и задайте код в `ALTEGIO_TEST_SMS_CODE`. При обязательной предоплате выберите согласованную услугу, доступную для такого теста.
2. Перезапустите сервер. Нажмите **Создать тестовую запись** один раз. Ожидается HTTP 201 с `success: true` и одним `data[0].record_id`. `record_hash` скрыт из вывода. ID и hash сохраняются в локальном игнорируемом файле `.env.booking-state.json` для следующего шага.
3. Сразу нажмите **Прочитать созданную запись**. Ожидается HTTP 200 и статус **Запись подтверждена**. Инструмент сравнит ID, сотрудника, услугу, время и проверит, что запись активна. Если чтение вернуло 401/403 или расхождение данных, проверьте запись по ID в журнале Altegio. Для HTTP 401/403 уточните у Altegio, требуется ли Booking User Token для чтения по hash. Это токен клиента онлайн-записи.
4. После проверки уберите тестовую запись из журнала средствами Altegio по согласованному со студией процессу.

Инструмент резервирует одну попытку в файле состояния перед POST. Повторные клики, запуск CLI параллельно со страницей и перезапуск процесса используют тот же файл. Если POST завершился таймаутом, ошибкой или неожиданным ответом, проверьте журнал Altegio. Для нового теста после проверки и очистки предыдущей записи удалите `.env.booking-state.json` в этой папке.

## Те же действия из терминала

Запускайте из `tools/altegio-smoke`. Команда `book` создаёт запись, `check` проверяет окно.

```powershell
node --env-file-if-exists=.env.local cli.mjs services
node --env-file-if-exists=.env.local cli.mjs staff
node --env-file-if-exists=.env.local cli.mjs dates
node --env-file-if-exists=.env.local cli.mjs times
node --env-file-if-exists=.env.local cli.mjs check
node --env-file-if-exists=.env.local cli.mjs book
node --env-file-if-exists=.env.local cli.mjs verify
```

## Методы Altegio

Production Online Booking API использует `https://api.alteg.io/api/v1`, `Accept: application/vnd.api.v2+json`, `Content-Type: application/json` и `Authorization: Bearer <partner_token>`. [Спецификация Online Booking API](https://developer.alteg.io/en/public/openapi)

| Кнопка | Запрос к Altegio | Что проверить |
| --- | --- | --- |
| Получить услуги | `GET /book_services/{location_id}?without_seances=1` | 200, `data.services` — каталог онлайн-записи без поиска свободных окон |
| Получить сотрудников | `GET /book_staff/{location_id}` с `service_ids[]`, если задан | 200, массив `data` |
| Получить даты | `GET /book_dates/{location_id}` с `staff_id`, `service_ids[]` и опциональным `date` для выбора месяца | 200, `data.booking_dates` |
| Получить время | `GET /book_times/{location_id}/{team_member_id}/{date}` с `service_ids[]` | 200, `data[].datetime` |
| Проверить окно | `POST /book_check/{location_id}` с одним элементом `appointments` | 201; описание допускает пустое тело, OpenAPI также показывает JSON |
| Создать запись | `POST /book_record/{location_id}` с `fullname`, `phone`, `email`, одним элементом `appointments` и `code`, если требуется | 201, `data[0].record_id` и `record_hash` |
| Прочитать запись | `GET /book_record/{location_id}/{record_id}/{record_hash}` | 200, объект записи |

При чтении по hash OpenAPI указывает схему `BearerPartner`, а описание заголовка приводит `Bearer partner_token, User user_token`. Инструмент пробует Partner Token с ID и hash. Работу этого варианта нужно подтвердить на филиале. Business User Token в этом инструменте не используется.

## После успешного теста

1. Зафиксировать обезличенные ответы реального филиала и согласовать публичный контракт с фронтендом.
2. Реализовать на отдельном API-сервере адаптер Altegio для услуг, команды, дат и времени. Согласовать обновление каталога в статических страницах сайта.
3. Реализовать проверку и создание записи с обработкой занятого слота, идемпотентностью и проверкой результата после таймаута. Подключить подтверждение телефона, если его требует сценарий филиала.
4. Реализовать сессии, доступ клиента к собственным записям и правила переноса и отмены. Затем подключить маршруты сайта и проверить сценарии на тестовом филиале. [Контракт бэкенда](../../docs/BACKEND-CONTRACT.md)
