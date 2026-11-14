'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { PhotoPlaceholder } from '@/components/ui/Cards';

export function HomeServicePhoto({ src, alt, illustration, caption, unavailable }: {
  src: string | null; alt: string; illustration?: ReactNode; caption: string; unavailable: string;
}) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const checkImage = useCallback((frame: HTMLDivElement | null) => {
    const image = frame?.querySelector('img');
    if (image?.complete && image.naturalWidth === 0) {
      if (src && !remoteFailed) setRemoteFailed(true);
      else setLocalFailed(true);
    }
  }, [src, remoteFailed]);

  if (src && !remoteFailed) {
    return <div className="home-service-image" ref={checkImage} onError={() => setRemoteFailed(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- public CRM media uses the original URL and the site disables optimization */}
      <img src={src} alt={alt} width={400} height={500} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    </div>;
  }

  if (illustration && !localFailed) {
    return <div key="illustration" className="home-service-image" ref={checkImage} onError={() => setLocalFailed(true)}>
      {illustration}
      <span className="home-service-image__caption">{caption}</span>
    </div>;
  }

  return <PhotoPlaceholder className="home-service-image" caption={unavailable} />;
}
