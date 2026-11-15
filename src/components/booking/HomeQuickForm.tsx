import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { homeServiceTitle, type HomeServiceTranslations } from '@/content/home-services';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogServices } from '@/server/catalog/services';
import { QuickForm } from './QuickForm';
import { QuickBookingFields } from './QuickBookingFields';

async function ServiceOptions({ locale }: { locale: CatalogLocale }) {
  await connection();
  const catalog = await getCatalogServices(locale).catch(() => null);
  const t = await getTranslations({ locale });
  const translations = t.raw('home.services.cards') as HomeServiceTranslations;
  const services = catalog?.data.services.map((service) => ({
    id: service.id, title: homeServiceTitle(locale, service, translations),
  })) ?? null;
  return <QuickBookingFields locale={locale} services={services} />;
}

export function HomeQuickForm({ locale }: { locale: CatalogLocale }) {
  return (
    <QuickForm>
      <Suspense fallback={<QuickBookingFields locale={locale} services={null} loading />}>
        <ServiceOptions locale={locale} />
      </Suspense>
    </QuickForm>
  );
}
