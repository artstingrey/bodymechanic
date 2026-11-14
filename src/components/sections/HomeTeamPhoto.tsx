'use client';

import { useCallback, useState } from 'react';
import { PhotoPlaceholder } from '@/components/ui/Cards';

export function HomeTeamPhoto({ src, alt, unavailable }: { src: string | null; alt: string; unavailable: string }) {
  const [failed, setFailed] = useState(false);
  const checkImage = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  return (
    <div className="home-team-photo" data-reveal="clip">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- public CRM portraits load directly without a server-side image proxy
        <img ref={checkImage} src={src} alt={alt} width={400} height={460} loading="lazy" decoding="async"
          referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : <PhotoPlaceholder caption={unavailable} />}
    </div>
  );
}
