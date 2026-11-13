import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getCategories, getServices } from '@/lib/api';
import { ServiceList } from '@/components/services/ServiceList';
import { PageHead } from '@/components/sections/PageHead';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'services', '/services');
}

/** /services — all services from Altegio with category filter (?category=massage|rehab, README §13), price and duration. */
export default async function ServicesPage() {
  const locale = await pageLocale();
  const t = await getTranslations();
  const [services, categories] = [await getServices(locale), getCategories(locale)];
  return (
    <ScopeMessages messages={await pickMessages(['services', 'mock'])}>
    <div className="container page">
      <PageLd kind="services" />
      <PageHead up title={t('services.title')} lead={t('services.lead')} />
      <Suspense fallback={<ServiceList services={services} categories={categories} initial="all" />}>
        <ServiceList services={services} categories={categories} />
      </Suspense>
    </div>
    </ScopeMessages>
  );
}
