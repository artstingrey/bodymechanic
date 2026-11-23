import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';

export type HomeServiceTranslations = Record<string, { title: string; description: string } | undefined>;

export function homeServiceTitle(locale: CatalogLocale, service: Pick<CatalogService, 'id' | 'title'>, translations: HomeServiceTranslations) {
  return (locale === 'ru' && service.title) || translations[service.id]?.title || service.title;
}

export function homeServiceDescription(locale: CatalogLocale, service: CatalogService, translations: HomeServiceTranslations) {
  const editorial = translations[service.id]?.description;
  return locale === 'en' ? editorial ?? service.description : service.description ?? editorial;
}

const websiteServicePhoto = (filename: string) => `/website-services/${encodeURIComponent(filename)}.webp`;

// Map Altegio service IDs to the supplied WebP files.
export const servicePhotos: ReadonlyMap<number, string> = new Map([
  [13688504, websiteServicePhoto('Home-service')],
  [13706788, websiteServicePhoto('classic-massage')],
  [13982351, websiteServicePhoto('ice-bath')],
  [13982353, websiteServicePhoto('ice-bath')],
  [13982355, websiteServicePhoto('sports-massage')],
  [13982356, websiteServicePhoto('classic-massage')],
  [13982358, websiteServicePhoto('thai-massage')],
  [13982363, websiteServicePhoto('infrared')],
  [13982369, websiteServicePhoto('infrared-2')],
  [13982379, websiteServicePhoto('sports-massage+capsule')],
  [13982380, websiteServicePhoto('classic-massage+capsule')],
  [13982382, websiteServicePhoto('thai-massage+capsule')],
  [13983057, websiteServicePhoto('Functional-Training-&-Mobility')],
  [13983060, websiteServicePhoto('Deep-Bodywork+infrared-capsule')],
  [13983065, websiteServicePhoto('Sports-Conditioning-&-Mobility')],
  [13983067, websiteServicePhoto('Muscle-&-Fascia-Work+Stretching')],
]);
