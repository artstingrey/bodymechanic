import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';

export type HomeServiceTranslations = Record<string, { title: string; description: string } | undefined>;

export function homeServiceTitle(locale: CatalogLocale, service: Pick<CatalogService, 'id' | 'title'>, translations: HomeServiceTranslations) {
  return (locale === 'ru' && service.title) || translations[service.id]?.title || service.title;
}

export function homeServiceDescription(locale: CatalogLocale, service: CatalogService, translations: HomeServiceTranslations) {
  const editorial = translations[service.id]?.description;
  return locale === 'en' ? editorial ?? service.description : service.description ?? editorial;
}

const servicePhoto = (name: string) => `/website-services/${encodeURIComponent(name)}.png`;

const servicePhotos = new Map([
  [13688504, servicePhoto('Home-service')],
  [13706788, servicePhoto('classic-massage')],
  [13982351, servicePhoto('ice-bath')],
  [13982353, servicePhoto('Individual-Ice-Bath-session +infrared-capsule')],
  [13982355, servicePhoto('sports-massage')],
  [13982356, servicePhoto('classic-massage')],
  [13982358, servicePhoto('thai-massage')],
  [13982363, servicePhoto('infrared')],
  [13982369, servicePhoto('infrared-2')],
  [13982379, servicePhoto('sports-massage+capsule')],
  [13982380, servicePhoto('classic-massage+capsule')],
  [13982382, servicePhoto('thai-massage+capsule')],
  [13983057, servicePhoto('Functional-Training-&-Mobility')],
  [13983060, servicePhoto('Deep-Bodywork+infrared-capsule')],
  [13983065, servicePhoto('Sports-Conditioning-&-Mobility')],
  [13983067, servicePhoto('Muscle-&-Fascia-Work+Stretching')],
]);

export function catalogServicePhoto(serviceId: number) {
  return servicePhotos.get(serviceId);
}
