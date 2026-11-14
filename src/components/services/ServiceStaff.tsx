import { Suspense } from 'react';
import type { getTranslations } from 'next-intl/server';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServiceStaff } from '@/server/catalog/staff';
import { StaffCard } from '@/components/ui/Cards';
import { HomeCatalogResult } from '@/components/sections/HomeCatalogResult';
import { HomeTeamPhoto } from '@/components/sections/HomeTeamPhoto';

type Props = {
  locale: CatalogLocale;
  serviceId: number;
  headingId: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
};

async function ServiceStaffCards({ locale, serviceId, headingId, t }: Props) {
  const staff = await getCatalogServiceStaff(locale, serviceId).catch(() => null);
  return (
    <HomeCatalogResult headingId={headingId} slides={staff?.map(({ id }) => id).join(',') ?? ''} failed={staff === null}
      error={t('service.specialists.error')} retry={t('home.team.retry')} loading={t('service.specialists.loading')}>
      {staff?.length ? (
        <ul className="card-grid card-grid--4">
          {staff.map(({ id, name, position, specialization, imageUrl }) => (
            <li key={id}>
              <StaffCard name={name} note={position ?? specialization ?? undefined}
                photo={<HomeTeamPhoto key={imageUrl ?? 'placeholder'} src={imageUrl} alt={name} unavailable={t('home.team.photoUnavailable')} />} />
            </li>
          ))}
        </ul>
      ) : staff ? <p className="lead" role="status">{t('service.specialists.empty')}</p> : null}
    </HomeCatalogResult>
  );
}

export function ServiceStaff(props: Props) {
  return (
    <Suspense fallback={<div className="home-catalog-state" role="status">{props.t('service.specialists.loading')}</div>}>
      <ServiceStaffCards {...props} />
    </Suspense>
  );
}
