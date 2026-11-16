import { STUDIO_MAP } from '@/lib/config';

export function StudioMapFrame({ title, className }: { title: string; className: string }) {
  return (
    <figure className={className} aria-label={title}>
      <iframe
        src={STUDIO_MAP.embedUrl}
        title={title}
        allowFullScreen
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </figure>
  );
}
