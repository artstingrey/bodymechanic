import Image from 'next/image';
import type { getTranslations } from 'next-intl/server';
import { Carousel } from '@/components/ui/Carousel';
import '@/styles/studio-gallery.css';

const interior = [
  { file: 'DSC02752.jpg', alt: 'home.space.alt.massageRoom', height: 1069 },
  { file: 'DSC02936.jpg', alt: 'home.space.alt.reception', height: 1068 },
  { file: 'DSC02952.jpg', alt: 'home.space.alt.tea', height: 2395 },
  { file: 'DSC02797_HDR.jpg', alt: 'home.space.alt.equipmentRoom', height: 1069 },
  { file: 'DSC02767.jpg', alt: 'home.space.alt.equipmentDetail', height: 2395 },
  { file: 'DSC02871_HDR.jpg', alt: 'home.space.alt.hallway', height: 1069 },
  { file: 'DSC02818.jpg', alt: 'home.space.alt.trainingEquipment', height: 1069 },
  { file: 'DSC02817_HDR.jpg', alt: 'home.space.alt.trainingEntrance', height: 1069 },
  { file: 'DSC02923.jpg', alt: 'home.space.alt.doorPanel', height: 2396 },
  { file: 'DSC02904.jpg', alt: 'home.space.alt.changingArea', height: 1069 },
  { file: 'DSC02907_resized.jpg', alt: 'home.space.alt.sink', height: 2395 },
  { file: 'DSC02916.jpg', alt: 'home.space.alt.shower', height: 1069 },
  { file: 'DSC02943.jpg', alt: 'home.space.alt.waitingArea', height: 1069 },
] as const;

export function StudioGallery({ title, t }: {
  title: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div className="studio-gallery">
      <Carousel label={title} t={{
        label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
        goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
      }}>
        {interior.map(({ file, alt, height }) => {
          const aspect = 1600 / height;
          const sizes = `clamp(${Math.ceil(178 * aspect)}px, calc(54vw * ${aspect.toFixed(3)}), ${Math.ceil(360 * aspect)}px)`;
          return <Image key={file} src={`/interier/${file}`} alt={t(alt)} width={1600} height={height} sizes={sizes} draggable={false} />;
        })}
      </Carousel>
    </div>
  );
}
