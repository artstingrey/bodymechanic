import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import assets from '@/lib/body3d/assets.json';
import '@/styles/nf.css';

/** 404 inside a locale (notFound() from a page): styled like the site, with links home / services / booking (PG-12). */
export default async function LocaleNotFound() {
  const t = await getTranslations();
  const p = assets.posters.male;
  return (
    <section className="container page nf">
      <div className="nf__text">
        <p className="nf__code tn" aria-hidden="true">{t('notFound.code')}</p>
        <h1 className="h1">{t('notFound.title')}</h1>
        <p className="lead">{t('notFound.text')}</p>
        <ul className="nf__links">
          {/* two actions, as the text says (design audit F22: a third «Записаться →» hung alone on ≤ 402 px); sections are in the menu */}
          <li><Link href="/" className="btn btn--primary">{t('notFound.home')}</Link></li>
          <li><Link href="/booking" className="btn btn--secondary">{t('notFound.book')}</Link></li>
        </ul>
      </div>
      {/* illustration: the front-view model with the crosshair aimed at empty space — «the zone you were looking for is not here» */}
      <figure className="nf__art">
        <picture>
          <source srcSet={p.avif} type="image/avif" />
          <source srcSet={p.webp} type="image/webp" />
          <img src={p.png} width={p.width} height={p.height} alt={t('notFound.illustrationAlt')} loading="lazy" decoding="async" />
        </picture>
      </figure>
    </section>
  );
}
