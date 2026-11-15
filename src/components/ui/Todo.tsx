import type { ElementType } from 'react';

/**
 * Editorial notes stay in the dictionaries. Render the text once the TODO marker is gone.
 */
const PREFIX = /^\s*TODO\(content\):\s*/;

export const isTodo = (s: unknown): s is string => typeof s === 'string' && PREFIX.test(s);

/** «TODO(content): номер WhatsApp» → «Номер WhatsApp» (also for meta descriptions and alt texts). */
export function stripTodo(s: string): string {
  if (!PREFIX.test(s)) return s;
  const rest = s.replace(PREFIX, '');
  return rest.charAt(0).toLocaleUpperCase() + rest.slice(1);
}

export function Todo({ as: Tag = 'span', children }: { as?: ElementType; children: string }) {
  return isTodo(children) ? null : <Tag>{children}</Tag>;
}
