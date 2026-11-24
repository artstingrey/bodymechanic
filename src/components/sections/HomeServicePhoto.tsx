'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { PhotoPlaceholder } from '@/components/ui/Cards';

const CAROUSEL_SIZES = '(min-width: 1440px) 420px, (min-width: 1024px) 30vw, (min-width: 768px) 336px, min(76vw - 24px, 296px)';
const DETAIL_SIZES = '(min-width: 1024px) min(36vw, 612px), (min-width: 600px) min(94vw, 48svh), 90vw';

export function HomeServicePhoto({ src, alt, unavailable, detail = false, sizes }: {
  src?: string; alt: string; unavailable: string; detail?: boolean; sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  const checkImage = useCallback((frame: HTMLDivElement | null) => {
    const image = frame?.querySelector('img');
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  if (!src || failed) {
    return <PhotoPlaceholder className="home-service-image" caption={unavailable} />;
  }

  return (
    <div className="home-service-image" ref={checkImage}>
      <Image src={src} alt={alt} width={1600} height={2000} sizes={sizes ?? (detail ? DETAIL_SIZES : CAROUSEL_SIZES)}
        loading={detail ? 'eager' : 'lazy'}
        fetchPriority={detail ? 'high' : undefined} decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}
