import Image from 'next/image';
import type { getTranslations } from 'next-intl/server';
import { Carousel } from '@/components/ui/Carousel';
import '@/styles/studio-gallery.css';

const interior = [
  { file: 'DSC02752.webp', alt: 'home.space.alt.massageRoom', height: 1069 },
  { file: 'DSC02936.webp', alt: 'home.space.alt.reception', height: 1068 },
  { file: 'DSC02952.webp', alt: 'home.space.alt.tea', height: 2395 },
  { file: 'DSC02797_HDR.webp', alt: 'home.space.alt.equipmentRoom', height: 1069 },
  { file: 'DSC02767.webp', alt: 'home.space.alt.equipmentDetail', height: 2395 },
  { file: 'DSC02871_HDR.webp', alt: 'home.space.alt.hallway', height: 1069 },
  { file: 'DSC02818.webp', alt: 'home.space.alt.trainingEquipment', height: 1069 },
  { file: 'DSC02817_HDR.webp', alt: 'home.space.alt.trainingEntrance', height: 1069 },
  { file: 'DSC02923.webp', alt: 'home.space.alt.doorPanel', height: 2396 },
  { file: 'DSC02904.webp', alt: 'home.space.alt.changingArea', height: 1069 },
  { file: 'DSC02907_resized.webp', alt: 'home.space.alt.sink', height: 2395 },
  { file: 'DSC02916.webp', alt: 'home.space.alt.shower', height: 1069 },
  { file: 'DSC02943.webp', alt: 'home.space.alt.waitingArea', height: 1069 },
] as const;

const specialists = [
  { file: 'arina.webp', alt: 'lp.studio.alt.arina', height: 2396 },
  { file: 'maksim.webp', alt: 'lp.studio.alt.maksim', height: 2396 },
] as const;

export function StudioGallery({ title, t, landing = false }: {
  title: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  landing?: boolean;
}) {
  const folder = landing ? '/interier-lp' : '/interier';
  const photos = landing ? [...specialists, ...interior] : interior;

  return (
    <div className="studio-gallery">
      <Carousel label={title} t={{
        label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
        goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
      }}>
        {photos.map(({ file, alt, height }) => (
          <Image key={file} src={`${folder}/${file}`} alt={t(alt)} width={1600} height={height} draggable={false} />
        ))}
      </Carousel>
    </div>
  );
}
