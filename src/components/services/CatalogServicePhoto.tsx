import type { getTranslations } from 'next-intl/server';
import { catalogServicePhoto } from '@/content/home-services';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';

export function CatalogServicePhoto({ serviceId, title, t, detail }: {
  serviceId: number;
  title: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  detail?: boolean;
}) {
  const photo = catalogServicePhoto(serviceId);
  return (
    <HomeServicePhoto key={photo?.src} src={photo?.src} hasPrintedPrice={photo?.hasPrintedPrice} alt={title} detail={detail}
      unavailable={t('home.services.photoUnavailable')} />
  );
}
