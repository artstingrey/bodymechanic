'use client';

import { useCallback, useState } from 'react';
import { PhotoPlaceholder } from '@/components/ui/Cards';

export function HomeServicePhoto({ basePath, alt, sizes, unavailable, detail = false }: {
  basePath?: string; alt: string; sizes: string; unavailable: string; detail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const checkImage = useCallback((frame: HTMLDivElement | null) => {
    const image = frame?.querySelector('img');
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  if (!basePath || failed) {
    return <PhotoPlaceholder className="home-service-image" caption={unavailable} />;
  }

  const small = `${basePath}-640.webp`;
  return (
    <div className="home-service-image" ref={checkImage}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the local photos already have responsive WebP variants */}
      <img src={small} srcSet={`${small} 640w, ${basePath}-1280.webp 1280w`} sizes={sizes}
        alt={alt} width={640} height={800} loading={detail ? 'eager' : 'lazy'}
        fetchPriority={detail ? 'high' : undefined} decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}
