import { expect } from '@playwright/test';

export async function checkPhoneField(field, { copy, submit, invalid = copy.error.phoneInvalid }) {
  await expect(field).toHaveAttribute('type', 'tel');
  await expect(field).toHaveAttribute('inputmode', 'tel');
  await expect(field).toHaveAttribute('autocomplete', 'tel');
  await expect(field).toHaveAttribute('required', '');
  await expect(field).toHaveAttribute('placeholder', copy.field.phonePlaceholder);
  await expect(field).toHaveAccessibleDescription(copy.field.phoneHint);
  await expect(field).toHaveValue('');
  await field.focus();
  // Wait out a frame callback so the old deferred prefix would fail this assertion.
  await field.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(field).toHaveValue('');
  await field.blur();
  await expect(field).toHaveValue('');
  await expect(field).toHaveAccessibleDescription(copy.error.required);

  await field.fill('0501234567');
  await field.blur();
  await expect(field).toHaveAccessibleDescription(invalid);
  await field.fill('');
  await expect(field).toHaveAccessibleDescription(copy.error.required);

  await submit();
  await expect(field).toHaveAccessibleDescription(copy.error.required);
  for (const value of ['0501234567', '+971', '+44 20', '123+442079460958', '+971+442079460958']) {
    await field.fill(value);
    await submit();
    await expect(field).toHaveAccessibleDescription(invalid);
    await expect(field).toHaveValue(value);
  }

  const page = field.page();
  await page.context().grantPermissions(['clipboard-write'], { origin: new URL(page.url()).origin });
  for (const value of ['+971 50 123-45-67', '+44 20 7946-0958']) {
    await field.fill('');
    await field.pressSequentially(value);
    await field.blur();
    await expect(field).toHaveValue(value);

    await field.fill('');
    await page.evaluate((number) => navigator.clipboard.writeText(number), value);
    await field.press('ControlOrMeta+V');
    await expect(field).toHaveValue(value);
    await field.blur();
    await expect(field).toHaveValue(value);
  }

  const session = await page.context().newCDPSession(page);
  try {
    const selector = await field.evaluate((input) => `#${CSS.escape(input.id)}`);
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { node } = await session.send('DOM.describeNode', { nodeId });
    await field.fill('');
    await session.send('Autofill.trigger', { fieldId: node.backendNodeId, address: { fields: [
      { name: 'ADDRESS_HOME_COUNTRY', value: 'GB' },
      { name: 'PHONE_HOME_WHOLE_NUMBER', value: '+442079460958' },
    ] } });
    await expect(field).toHaveValue(/^\+44/);
    const autofilled = await field.inputValue();
    expect(autofilled.replace(/\D/g, '')).toBe('442079460958');
    await field.blur();
    await field.focus();
    await expect(field).toHaveValue(autofilled);
    await field.blur();
  } finally {
    await session.detach();
  }
}
