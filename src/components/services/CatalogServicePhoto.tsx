import type { getTranslations } from 'next-intl/server';
import { servicePhotos } from '@/content/home-services';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';

export function CatalogServicePhoto({ serviceId, title, sizes, t, detail }: {
  serviceId: number;
  title: string;
  sizes: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  detail?: boolean;
}) {
  const photo = servicePhotos.get(serviceId);
  const basePath = photo && `/photos/website-services/${photo}`;
  return (
    <HomeServicePhoto key={photo} basePath={basePath} alt={title} sizes={sizes} detail={detail}
      unavailable={t('home.services.photoUnavailable')} />
  );
}
