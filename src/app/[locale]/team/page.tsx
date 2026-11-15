import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { catalogStaffSlug } from '@/lib/catalog-staff-slug';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogStaff } from '@/server/catalog/staff';
import { PageLd } from '@/components/seo/PageLd';
import { HomeCatalogResult } from '@/components/sections/HomeCatalogResult';
import { HomeTeamPhoto } from '@/components/sections/HomeTeamPhoto';
import { PageHead } from '@/components/sections/PageHead';
import { StaffCard } from '@/components/ui/Cards';
import { Todo } from '@/components/ui/Todo';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'team', '/team');
}

async function TeamCatalog({ locale, t }: { locale: CatalogLocale; t: Awaited<ReturnType<typeof getTranslations>> }) {
  // Resolve the catalog at request time so builds don't require CRM access.
  await connection();
  const catalog = await getCatalogStaff(locale).catch(() => null);
  const staff = catalog?.data.staff;

  return (
    <HomeCatalogResult headingId="team-title" slides={staff?.map(({ id }) => id).join(',') ?? ''} failed={!catalog}
      error={t('home.team.errorLoad')} retry={t('home.team.retry')} loading={t('home.team.loading')}>
      {staff?.length ? (
        <ul className="card-grid card-grid--4 team-grid">
          {staff.map(({ id, name, position, specialization, imageUrl }) => (
            <li key={id}>
              <StaffCard name={name} note={position ?? specialization} href={`/team/${catalogStaffSlug(id)}`}
                photo={<HomeTeamPhoto key={imageUrl} src={imageUrl} alt={name} unavailable={t('home.team.photoUnavailable')} />} />
            </li>
          ))}
        </ul>
      ) : staff ? <p className="lead" role="status">{t('home.team.empty')}</p> : null}
    </HomeCatalogResult>
  );
}

export default async function TeamPage() {
  const locale = await pageLocale();
  const t = await getTranslations({ locale });
  return (
    <div className="container page">
      <PageLd kind="team" />
      <PageHead up titleId="team-title" title={t('team.title')} lead={t('team.lead')} />
      <Suspense fallback={<div className="home-catalog-state" role="status">{t('home.team.loading')}</div>}>
        <TeamCatalog locale={locale} t={t} />
      </Suspense>
      <Todo as="p">{t('team.todo.bio')}</Todo>
    </div>
  );
}
