import type { getTranslations } from 'next-intl/server';
import { servicePhotos } from '@/content/home-services';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';

export function CatalogServicePhoto({ serviceId, title, t, detail }: {
  serviceId: number;
  title: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  detail?: boolean;
}) {
  const src = servicePhotos.get(serviceId);
  return (
    <HomeServicePhoto key={src} src={src} alt={title} detail={detail}
      unavailable={t('home.services.photoUnavailable')} />
  );
}
