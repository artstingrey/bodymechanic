import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';

export type HomeServiceTranslations = Record<string, { title: string; description: string } | undefined>;

export function homeServiceTitle(locale: CatalogLocale, service: Pick<CatalogService, 'id' | 'title'>, translations: HomeServiceTranslations) {
  return (locale === 'ru' && service.title) || translations[service.id]?.title || service.title;
}

export function homeServiceDescription(locale: CatalogLocale, service: CatalogService, translations: HomeServiceTranslations) {
  const editorial = translations[service.id]?.description;
  return locale === 'en' ? editorial ?? service.description : service.description ?? editorial;
}

const testPhoto = (name: string) => `/website-services/test/${encodeURIComponent(name)}.png`;

const servicePhotos = new Map([
  [13688504, testPhoto('Home-service')],
  [13706788, '/website-services/classic-massage.webp'],
  [13982351, testPhoto('ice-bath')],
  [13982353, testPhoto('Individual-Ice-Bath-session +infrared-capsule')],
  [13982355, testPhoto('sports-massage')],
  [13982356, testPhoto('classic-massage')],
  [13982358, testPhoto('thai-massage')],
  [13982363, testPhoto('infrared')],
  [13982369, testPhoto('infrared-2')],
  [13982379, testPhoto('sports-massage+capsule')],
  [13982380, testPhoto('classic-massage+capsule')],
  [13982382, testPhoto('thai-massage+capsule')],
  [13983057, testPhoto('Functional-Training-&-Mobility')],
  [13983060, testPhoto('Deep-Bodywork+infrared-capsule')],
  [13983065, testPhoto('Sports-Conditioning-&-Mobility')],
  [13983067, testPhoto('Muscle-&-Fascia-Work+Stretching')],
]);

export function catalogServicePhoto(serviceId: number) {
  return servicePhotos.get(serviceId);
}
