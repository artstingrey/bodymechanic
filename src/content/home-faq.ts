import type { getTranslations } from 'next-intl/server';

// Hidden questions are kept in the locale files for later use.
const visibleQuestions = ['choose', 'duration', 'prepare', 'contraindications'] as const;

export function visibleHomeFaq(t: Awaited<ReturnType<typeof getTranslations>>) {
  return visibleQuestions
    .filter((key) => t.has(`home.faq.${key}.q`) && t.has(`home.faq.${key}.a`))
    .map((key) => ({ key, q: t(`home.faq.${key}.q`), a: t(`home.faq.${key}.a`) }));
}
