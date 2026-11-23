'use client';

import { useCallback, useState } from 'react';
import { PhotoPlaceholder } from '@/components/ui/Cards';

export function HomeServicePhoto({ src, alt, unavailable, detail = false }: {
  src?: string; alt: string; unavailable: string; detail?: boolean;
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
      {/* eslint-disable-next-line @next/next/no-img-element -- serve the supplied WebP files directly */}
      <img src={src} alt={alt} width={1600} height={2000} loading={detail ? 'eager' : 'lazy'}
        fetchPriority={detail ? 'high' : undefined} decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}
