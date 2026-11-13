import type { ElementType } from 'react';
import { useTranslations } from 'next-intl';

/**
 * TODO(content) placeholders. The deck keeps the «TODO(content): …» marker; the page never shows it.
 * Lead's EMPTY-STATE POLICY (R-FINAL-2 design audit F05–F08, F20, 2026-11-07): editor notes («what goes here») are never printed
 * on the public site. In their place the site's «Демо» badge (default), or nothing (`hidden`: where the block already shows its
 * own placeholder or the note only described the block). The note itself stays in data-todo for QA
 * (`document.querySelectorAll('[data-todo]')`); the client's TODO register lives in the guide.
 * A string without the marker (a real but provisional text, e.g. the reschedule notice) is printed as plain text.
 */
const PREFIX = /^\s*TODO\(content\):\s*/;

export const isTodo = (s: unknown): s is string => typeof s === 'string' && PREFIX.test(s);

/** «TODO(content): номер WhatsApp» → «Номер WhatsApp» (also for meta descriptions and alt texts). */
export function stripTodo(s: string): string {
  if (!PREFIX.test(s)) return s;
  const rest = s.replace(PREFIX, '');
  return rest.charAt(0).toLocaleUpperCase() + rest.slice(1);
}

export function Todo({ as: Tag = 'span', children, className, hidden = false }: { as?: ElementType; children: string; className?: string; hidden?: boolean }) {
  const t = useTranslations('prototype');
  if (!isTodo(children)) return <Tag className={className}>{children}</Tag>;
  const cls = className ? `todo ${className}` : 'todo';
  if (hidden) return <Tag className={cls} data-todo={stripTodo(children)} hidden />;
  return <Tag className={cls} data-todo={stripTodo(children)}><span className="badge">{t('demoBadge')}</span></Tag>;
}
