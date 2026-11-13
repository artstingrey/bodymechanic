import { readFile, writeFile } from "node:fs/promises";

const productionApi = "https://api.alteg.io/api/v1";
const bookingStateFile = new URL("./.env.booking-state.json", import.meta.url);

function testAppointment() {
  return {
    id: 1,
    services: [13982351], // Put one real service ID here, for example [123].
    staff_id: 3069594, // Replace with a real employee ID before checking or booking.
    datetime: "2026-11-20T14:30:00+04:00", // Copy datetime exactly as returned by book_times.
  };
}

function testBooking(appointment) {
  return {
    fullname: "ICE BATH - after a massage",
    phone: process.env.ALTEGIO_TEST_PHONE?.trim(),
    email: process.env.ALTEGIO_TEST_EMAIL?.trim(),
    comment: "TEST — The Body Mechanic API smoke check",
    notify_by_sms: 0,
    notify_by_email: 0,
    ...(process.env.ALTEGIO_TEST_SMS_CODE?.trim()
      ? { code: Number(process.env.ALTEGIO_TEST_SMS_CODE) }
      : {}),
    appointments: [appointment],
  };
}

function problem(status, message) {
  return { source: "local", status, body: { message } };
}

function positiveId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

async function request(method, path, payload) {
  const partnerToken = process.env.ALTEGIO_PARTNER_TOKEN?.trim();
  if (!partnerToken)
    return problem(
      400,
      "Заполните ALTEGIO_PARTNER_TOKEN в локальном окружении.",
    );

  try {
    const response = await fetch(`${productionApi}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.api.v2+json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${partnerToken}`,
      },
      body: payload && JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const content = await response.text();
    let body = null;
    if (content) {
      try {
        body = JSON.parse(content);
      } catch {
        body = content;
      }
    }
    return { source: "Altegio", status: response.status, body };
  } catch {
    return problem(
      502,
      "Не удалось получить ответ Altegio. Проверьте сеть. Для создания записи сначала проверьте журнал Altegio.",
    );
  }
}

function redact(result, ...extraSecrets) {
  const secrets = [
    process.env.ALTEGIO_PARTNER_TOKEN?.trim(),
    process.env.ALTEGIO_TEST_SMS_CODE?.trim(),
    process.env.ALTEGIO_TEST_EMAIL?.trim(),
    ...extraSecrets,
  ].filter(Boolean);
  return JSON.parse(
    JSON.stringify(result, (key, value) => {
      if (/^(record_hash|authorization|partner_token|user_token)$/i.test(key)) {
        return "[скрыто]";
      }
      if (key === "code" && secrets.includes(String(value))) return "[скрыто]";
      return typeof value === "string"
        ? secrets.reduce(
            (text, secret) => text.replaceAll(secret, "[скрыто]"),
            value,
          )
        : value;
    }),
  );
}

function validAppointment(appointment) {
  return (
    appointment.services.length === 1 &&
    appointment.services.every(positiveId) &&
    positiveId(appointment.staff_id) &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(appointment.datetime) &&
    Date.parse(appointment.datetime) > Date.now()
  );
}

async function createBooking(locationId, appointment) {
  if (!process.env.ALTEGIO_PARTNER_TOKEN?.trim()) {
    return problem(
      400,
      "Заполните ALTEGIO_PARTNER_TOKEN в локальном окружении.",
    );
  }
  const payload = testBooking(appointment);
  if (!/^\+[1-9]\d{6,14}$/.test(payload.phone ?? "")) {
    return problem(
      400,
      "Укажите согласованный тестовый номер в международном формате в ALTEGIO_TEST_PHONE.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email ?? "")) {
    return problem(400, "Укажите тестовый email в ALTEGIO_TEST_EMAIL.");
  }
  if (
    "code" in payload &&
    !/^\d+$/.test(process.env.ALTEGIO_TEST_SMS_CODE.trim())
  ) {
    return problem(400, "Укажите числовой код SMS в ALTEGIO_TEST_SMS_CODE.");
  }

  try {
    await writeFile(bookingStateFile, "{}\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") {
      return problem(
        409,
        "Попытка создания уже была. Проверьте результат или журнал Altegio перед повтором.",
      );
    }
    return problem(
      500,
      "Не удалось сохранить состояние попытки. Запрос на создание не отправлен.",
    );
  }

  const result = await request("POST", `/book_record/${locationId}`, payload);
  const record = result.body?.data?.[0];
  if (
    result.status !== 201 ||
    result.body?.success !== true ||
    result.body.data?.length !== 1 ||
    !positiveId(record?.record_id) ||
    typeof record?.record_hash !== "string" ||
    !record.record_hash
  ) {
    return {
      ...redact(result, record?.record_hash),
      created: false,
      message:
        "Создание не подтверждено. Перед повторной попыткой проверьте журнал Altegio.",
    };
  }

  try {
    await writeFile(
      bookingStateFile,
      JSON.stringify({
        locationId,
        appointment,
        recordId: record.record_id,
        hash: record.record_hash,
      }),
      { mode: 0o600 },
    );
  } catch {
    return {
      ...redact(result, record.record_hash),
      created: true,
      message:
        "Запись создана. Не удалось сохранить данные для проверки. Найдите запись в журнале Altegio по record_id.",
    };
  }
  return { ...redact(result, record.record_hash), created: true };
}

async function verifyBooking(locationId) {
  let state;
  try {
    state = JSON.parse(await readFile(bookingStateFile, "utf8"));
  } catch {
    return problem(
      409,
      "Нет сохранённых данных записи. Если POST уже отправлялся, сначала проверьте журнал Altegio.",
    );
  }
  if (
    state?.locationId !== locationId ||
    !positiveId(state.recordId) ||
    !state.hash
  ) {
    return problem(
      409,
      "Нет подтверждённого ID и hash для этого филиала. Проверьте журнал Altegio.",
    );
  }
  const result = await request(
    "GET",
    `/book_record/${locationId}/${state.recordId}/${encodeURIComponent(state.hash)}`,
  );
  if (result.status !== 200) return redact(result, state.hash);

  const record = result.body?.data ?? result.body;
  const verified =
    Number(record?.id) === state.recordId &&
    Number(record?.staff?.id) === state.appointment.staff_id &&
    Array.isArray(record?.services) &&
    state.appointment.services.every((id) =>
      record.services.some((service) => Number(service.id) === id),
    ) &&
    Date.parse(record?.datetime) === Date.parse(state.appointment.datetime) &&
    record?.deleted === false;
  return { ...redact(result, state.hash), verified };
}

export const actions = {
  services: "GET",
  staff: "GET",
  dates: "GET",
  times: "GET",
  check: "POST",
  book: "POST",
  verify: "GET",
};

export async function runAction(action) {
  const locationId = Number(process.env.ALTEGIO_LOCATION_ID);
  if (!positiveId(locationId))
    return problem(400, "Заполните ALTEGIO_LOCATION_ID в локальном окружении.");

  const appointment = testAppointment();
  const query = new URLSearchParams();
  for (const id of appointment.services) query.append("service_ids[]", id);
  const date = process.env.ALTEGIO_TEST_DATE?.trim();

  switch (action) {
    case "services":
      return redact(
        await request("GET", `/book_services/${locationId}?without_seances=1`),
      );
    case "staff":
      return redact(await request("GET", `/book_staff/${locationId}?${query}`));
    case "dates":
      query.set("staff_id", appointment.staff_id);
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) query.set("date", date);
      return redact(await request("GET", `/book_dates/${locationId}?${query}`));
    case "times":
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return problem(
          400,
          "Укажите дату из booking_dates в ALTEGIO_TEST_DATE в формате ГГГГ-ММ-ДД.",
        );
      }
      return redact(
        await request(
          "GET",
          `/book_times/${locationId}/${appointment.staff_id}/${date}?${query}`,
        ),
      );
    case "check":
    case "book":
      if (!validAppointment(appointment)) {
        return problem(
          400,
          "Заполните testAppointment() в api.mjs: ID одной услуги, ID сотрудника и будущий datetime из book_times.",
        );
      }
      return action === "check"
        ? redact(
            await request("POST", `/book_check/${locationId}`, {
              appointments: [appointment],
            }),
          )
        : createBooking(locationId, appointment);
    case "verify":
      return verifyBooking(locationId);
    default:
      return problem(404, "Неизвестное действие.");
  }
}
