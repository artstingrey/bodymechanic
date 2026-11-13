import type { ReactNode } from 'react';

/** Badge: «Демо», «Черновик» (neutral), «Подобрано по вашим зонам» (accent = «Рекомендуем», lead decision), «2D-режим» (dark). */
export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'dark'; children: ReactNode; className?: string }) {
  return <span className={['badge', tone !== 'neutral' && `badge--${tone}`, className].filter(Boolean).join(' ')}>{children}</span>;
}
