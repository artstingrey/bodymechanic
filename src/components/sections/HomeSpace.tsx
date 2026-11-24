import { getTranslations } from 'next-intl/server';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { StudioGallery } from './StudioGallery';

export async function HomeSpace({ locale }: { locale: CatalogLocale }) {
  const t = await getTranslations({ locale });
  const title = t('home.space.title');

  return (
    <section className="section home-sec home-space" aria-labelledby="space-title">
      <div className="container">
        <div className="sec-head">
          <div>
            <h2 id="space-title" className="h2" data-split="">{title}</h2>
            <p className="lead">{t('home.space.text')}</p>
          </div>
        </div>
        <StudioGallery title={title} t={t} />
      </div>
    </section>
  );
}
