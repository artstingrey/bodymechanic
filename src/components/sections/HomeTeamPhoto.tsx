'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { PhotoPlaceholder } from '@/components/ui/Cards';
import { ALTEGIO_PORTRAIT_BASE } from '@/lib/staff-photo';

export function HomeTeamPhoto({ src, alt, unavailable }: { src: string | null; alt: string; unavailable: string }) {
  const [failed, setFailed] = useState(false);
  const checkImage = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  return (
    <div className="home-team-photo" data-reveal="clip">
      {src && !failed ? (
        <Image ref={checkImage} src={src} alt={alt} width={400} height={460} loading="lazy" decoding="async"
          sizes="(min-width: 1440px) 420px, (min-width: 1024px) 33vw, min(92vw, 420px)"
          unoptimized={!src.startsWith(ALTEGIO_PORTRAIT_BASE) || /[?#]/.test(src)}
          referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : <PhotoPlaceholder caption={unavailable} />}
    </div>
  );
}
