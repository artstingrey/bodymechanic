import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';

export type HomeServiceTranslations = Record<string, { title: string; description: string } | undefined>;

export function homeServiceTitle(locale: CatalogLocale, service: Pick<CatalogService, 'id' | 'title'>, translations: HomeServiceTranslations) {
  return (locale === 'ru' && service.title) || translations[service.id]?.title || service.title;
}

export function homeServiceDescription(locale: CatalogLocale, service: CatalogService, translations: HomeServiceTranslations) {
  const editorial = translations[service.id]?.description;
  return locale === 'en' ? editorial ?? service.description : service.description ?? editorial;
}

// Map Altegio service IDs to the local WebP versions of the supplied website photos.
export const servicePhotos: ReadonlyMap<number, string> = new Map([
  [13688504, 'mobile-massage'],
  [13706788, 'classic-massage'],
  [13982351, 'ice-bath'],
  [13982353, 'ice-bath'],
  [13982355, 'sports-massage'],
  [13982356, 'classic-massage'],
  [13982358, 'thai-massage'],
  [13982363, 'infrared-capsule'],
  [13982369, 'infrared-capsule-45'],
  [13982379, 'sports-massage-capsule'],
  [13982380, 'classic-massage-capsule'],
  [13982382, 'thai-massage-capsule'],
  [13983057, 'functional-training'],
  [13983060, 'deep-bodywork'],
  [13983065, 'sports-conditioning'],
  [13983067, 'muscle-fascia-stretching'],
]);
