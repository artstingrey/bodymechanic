import { useEffect, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';

export function BodyViewerFullscreen({ viewer }: { viewer: RefObject<HTMLElement | null> }) {
  const t = useTranslations('body3d.viewer.fullscreen');
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = t(active ? 'exit' : 'enter');

  useEffect(() => {
    function syncFullscreen() {
      setActive(document.fullscreenElement === viewer.current);
      setFailed(false);
    }

    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [viewer]);

  async function toggleFullscreen() {
    const element = viewer.current;
    if (!element) return;

    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="body-viewer__fullscreen">
      <button type="button" className="body-viewer__fullscreen-toggle" aria-label={label}
        title={label} onClick={toggleFullscreen}>
        <Icon name={active ? 'minimize' : 'maximize'} />
      </button>
      {failed && <p className="body-viewer__fullscreen-error" role="alert">{t('unavailable')}</p>}
    </div>
  );
}
