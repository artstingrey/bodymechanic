import { Suspense } from 'react';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServices } from '@/server/catalog/services';
import { localBookingOrigin } from '@/server/booking/local-origin';
import { QuickForm } from './QuickForm';
import { QuickBookingFields } from './QuickBookingFields';

async function ServiceOptions({ locale }: { locale: CatalogLocale }) {
  await connection();
  const catalog = await getCatalogServices(locale, { withBusinessDuration: false }).catch(() => null);
  const t = await getTranslations({ locale });
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const services = catalog?.data.services.map((service) => ({
    ...service, title: homeServiceTitle(locale, service, translations),
  })) ?? null;
  return <QuickBookingFields locale={locale} services={services} />;
}

export async function HomeQuickForm({ locale }: { locale: CatalogLocale }) {
  await connection();
  const enabled = process.env.BOOKING_QUICK_FORM_ENABLED === 'true' ||
    Boolean(localBookingOrigin((await headers()).get('host')));
  return (
    <QuickForm locale={locale} enabled={enabled}>
      <Suspense fallback={<QuickBookingFields locale={locale} services={null} loading />}>
        <ServiceOptions locale={locale} />
      </Suspense>
    </QuickForm>
  );
}
