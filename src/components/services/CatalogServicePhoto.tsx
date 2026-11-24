import type { getTranslations } from 'next-intl/server';
import { catalogServicePhoto } from '@/content/home-services';
import { HomeServicePhoto } from '@/components/sections/HomeServicePhoto';

export function CatalogServicePhoto({ serviceId, title, t, detail, sizes }: {
  serviceId: number;
  title: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  detail?: boolean;
  sizes?: string;
}) {
  const src = catalogServicePhoto(serviceId);
  return (
    <HomeServicePhoto key={src} src={src} alt={title} detail={detail} sizes={sizes}
      unavailable={t('home.services.photoUnavailable')} />
  );
}
