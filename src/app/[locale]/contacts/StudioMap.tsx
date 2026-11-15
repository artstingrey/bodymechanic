'use client';

import { useState } from 'react';

export function StudioMap({ src, title, openLabel, note }: {
  src: string;
  title: string;
  openLabel: string;
  note: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <figure className="map-facade" aria-label={title}>
      {open ? (
        <iframe
          src={src}
          title={title}
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <>
          <span className="space__tick" aria-hidden="true" />
          <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>{openLabel}</button>
          <figcaption className="cap">{note}</figcaption>
        </>
      )}
    </figure>
  );
}
