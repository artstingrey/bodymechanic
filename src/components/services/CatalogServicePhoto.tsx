import type { getTranslations } from 'next-intl/server';
import { homeServiceIllustrations } from '@/content/home-services';
import type { CatalogService } from '@/lib/contracts/catalog';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';
import { Photo, hasPhoto } from '@/components/ui/Photo';

export function CatalogServicePhoto({ service, title, sizes, t }: {
  service: CatalogService;
  title: string;
  sizes: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const illustration = homeServiceIllustrations.get(service.id);
  const localPhoto = illustration && hasPhoto('services', illustration)
    ? <Photo set="services" id={illustration} sizes={sizes} alt={title} />
    : undefined;
  const src = service.imageUrl && new URL(service.imageUrl).hostname.replace(/\.$/, '') !== 'api.alteg.io'
    ? service.imageUrl : null;

  return (
    <HomeServicePhoto key={`${src}:${illustration}`} src={src} alt={title} illustration={localPhoto}
      caption={t('placeholder.illustrativePhoto')} unavailable={t('home.services.photoUnavailable')} />
  );
}
