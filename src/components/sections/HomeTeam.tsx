import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogStaff } from '@/server/catalog/staff';
import { ButtonLink } from '@/components/ui/Button';
import { Carousel } from '@/components/ui/Carousel';
import { StaffCard } from '@/components/ui/Cards';
import { HomeCatalogResult } from './HomeCatalogResult';
import { HomeTeamPhoto } from './HomeTeamPhoto';

async function HomeTeamCards({ locale, t }: { locale: CatalogLocale; t: Awaited<ReturnType<typeof getTranslations>> }) {
  await connection();
  const catalog = await getCatalogStaff(locale).catch(() => null);
  const staff = catalog?.data.staff;

  return (
    <HomeCatalogResult headingId="team-title" slides={staff?.map(({ id }) => id).join(',') ?? ''} failed={!catalog}
      error={t('home.team.errorLoad')} retry={t('home.team.retry')} loading={t('home.team.loading')}>
      {staff?.length ? (
        <Carousel label={t('home.team.title')} t={{
          label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'),
          goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string,
        }}>
          <div className="team-intro">
            <p>{t('home.team.intro')}</p>
            <ButtonLink href="#" variant="secondary" size="sm" prefetch={false} scroll={false}>
              {t('home.team.cta')}
            </ButtonLink>
          </div>
          {staff.map(({ id, name, imageUrl }) => (
            <StaffCard key={id} name={name} href="#"
              photo={<HomeTeamPhoto key={imageUrl ?? 'placeholder'} src={imageUrl} alt={name} unavailable={t('home.team.photoUnavailable')} />} />
          ))}
        </Carousel>
      ) : staff ? <p className="lead" role="status">{t('home.team.empty')}</p> : null}
    </HomeCatalogResult>
  );
}

export async function HomeTeam({ locale }: { locale: CatalogLocale }) {
  const t = await getTranslations({ locale });
  return (
    <section className="section section--surface home-sec" aria-labelledby="team-title">
      <div className="container">
        <div className="sec-head">
          <h2 id="team-title" className="h2" data-split="" tabIndex={-1}>{t('home.team.title')}</h2>
          <ButtonLink href="#" variant="text" prefetch={false} scroll={false}>{t('nav.main.team')}</ButtonLink>
        </div>
        <Suspense fallback={<div className="home-catalog-state" role="status">{t('home.team.loading')}</div>}>
          <HomeTeamCards locale={locale} t={t} />
        </Suspense>
      </div>
    </section>
  );
}
