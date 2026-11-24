import type { getTranslations } from 'next-intl/server';
import { catalogServicePhoto } from '@/content/home-services';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';
import type { CatalogService } from '@/lib/contracts/catalog';

export function CatalogServicePhoto({ service, title, t, detail, discounted }: {
  service: CatalogService;
  title: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  detail?: boolean;
  discounted?: boolean;
}) {
  const photo = catalogServicePhoto(service, discounted);
  return (
    <HomeServicePhoto key={photo?.src} src={photo?.src} square={photo?.square} alt={title} detail={detail}
      unavailable={t('home.services.photoUnavailable')} />
  );
}
