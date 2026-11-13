import { actions, runAction } from './api.mjs';

const action = process.argv[2];
if (!Object.hasOwn(actions, action)) {
  console.error(`Доступные команды: ${Object.keys(actions).join(', ')}`);
  process.exitCode = 1;
} else {
  try {
    const result = await runAction(action);
    console.log(JSON.stringify(result, null, 2));
    if (result.status >= 300 || result.body?.success === false || result.verified === false || result.created === false) {
      process.exitCode = 1;
    }
  } catch {
    console.error('Локальная ошибка. Если запрос на создание уже отправлялся, проверьте журнал Altegio.');
    process.exitCode = 1;
  }
}
