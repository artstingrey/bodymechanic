import type { CatalogLocale, CatalogService } from '@/lib/contracts/catalog';

export type HomeServiceTranslations = Record<string, { title: string; description: string } | undefined>;

export function homeServiceTitle(locale: CatalogLocale, service: Pick<CatalogService, 'id' | 'title'>, translations: HomeServiceTranslations) {
  return (locale === 'ru' && service.title) || translations[service.id]?.title || service.title;
}

export function homeServiceDescription(locale: CatalogLocale, service: CatalogService, translations: HomeServiceTranslations) {
  const editorial = translations[service.id]?.description;
  return locale === 'en' ? editorial ?? service.description : service.description ?? editorial;
}

const servicePhotoNames = new Map([
  [13688504, 'Home-service'],
  [13706788, 'classic-massage'],
  [13982351, 'ice-bath'],
  [13982353, 'ice-bath'],
  [13982355, 'sports-massage'],
  [13982356, 'classic-massage'],
  [13982358, 'thai-massage'],
  [13982363, 'infrared'],
  [13982369, 'infrared-2'],
  [13982379, 'sports-massage+capsule'],
  [13982380, 'classic-massage+capsule'],
  [13982382, 'thai-massage+capsule'],
  [13983057, 'Functional-Training-&-Mobility'],
  [13983060, 'Deep-Bodywork+infrared-capsule'],
  [13983065, 'Sports-Conditioning-&-Mobility'],
  [13983067, 'Muscle-&-Fascia-Work+Stretching'],
]);

// Prices printed on the PNGs in public/website-services/test, in AED.
const printedPrices = new Map([
  [13982355, 750],
  [13982356, 650],
  [13982358, 650],
  [13982379, 1000],
  [13982380, 900],
  [13982382, 900],
  [13983057, 450],
  [13983065, 450],
]);

export function catalogServicePhoto(service: Pick<CatalogService, 'id' | 'currency' | 'priceMin' | 'priceMax'>, discounted = false) {
  const name = servicePhotoNames.get(service.id);
  if (name === undefined) return undefined;
  const filename = encodeURIComponent(name);
  const printedPrice = printedPrices.get(service.id);
  const showPrintedPrice = !discounted && printedPrice !== undefined && service.currency === 'AED' &&
    service.priceMin === printedPrice && service.priceMax === printedPrice;
  return {
    src: showPrintedPrice ? `/website-services/test/${filename}.png` : `/website-services/${filename}.webp`,
    square: showPrintedPrice,
  };
}
