import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';

export type HomeServiceTranslations = Record<string, { title: string; description: string } | undefined>;

export function homeServiceTitle(locale: CatalogLocale, service: Pick<CatalogService, 'id' | 'title'>, translations: HomeServiceTranslations) {
  return (locale === 'ru' && service.title) || translations[service.id]?.title || service.title;
}

export function homeServiceDescription(locale: CatalogLocale, service: CatalogService, translations: HomeServiceTranslations) {
  const editorial = translations[service.id]?.description;
  return locale === 'en' ? editorial ?? service.description : service.description ?? editorial;
}
