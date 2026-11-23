import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Carousel } from '@/components/ui/Carousel';
import type { CatalogLocale } from '@/lib/contracts/catalog';

const photos = [
  { file: 'DSC02752.webp', alt: 'massageRoom', height: 1069 },
  { file: 'DSC02936.webp', alt: 'reception', height: 1068 },
  { file: 'DSC02952.webp', alt: 'tea', height: 2395 },
  { file: 'DSC02797_HDR.webp', alt: 'equipmentRoom', height: 1069 },
  { file: 'DSC02767.webp', alt: 'equipmentDetail', height: 2395 },
  { file: 'DSC02871_HDR.webp', alt: 'hallway', height: 1069 },
  { file: 'DSC02818.webp', alt: 'trainingEquipment', height: 1069 },
  { file: 'DSC02817_HDR.webp', alt: 'trainingEntrance', height: 1069 },
  { file: 'DSC02923.webp', alt: 'doorPanel', height: 2396 },
  { file: 'DSC02904.webp', alt: 'changingArea', height: 1069 },
  { file: 'DSC02907_resized.webp', alt: 'sink', height: 2395 },
  { file: 'DSC02916.webp', alt: 'shower', height: 1069 },
  { file: 'DSC02943.webp', alt: 'waitingArea', height: 1069 },
] as const;

export async function HomeSpace({ locale }: { locale: CatalogLocale }) {
  const t = await getTranslations({ locale });

  return (
    <section className="section home-sec home-space" aria-labelledby="space-title">
      <div className="container">
        <div className="sec-head">
          <div>
            <h2 id="space-title" className="h2" data-split="">{t('home.space.title')}</h2>
            <p className="lead">{t('home.space.text')}</p>
          </div>
        </div>
        <Carousel label={t('home.space.title')} t={{
          label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
          goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
        }}>
          {photos.map(({ file, alt, height }) => (
            <Image key={file} src={`/interier/${file}`} alt={t(`home.space.alt.${alt}`)}
              width={1600} height={height} draggable={false} />
          ))}
        </Carousel>
      </div>
    </section>
  );
}
