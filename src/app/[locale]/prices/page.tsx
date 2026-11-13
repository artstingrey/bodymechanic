import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getCategories, getServices } from '@/lib/api';
import { serviceFacts } from '@/components/services/ServiceFacts';
import { PageHead } from '@/components/sections/PageHead';
import { Badge } from '@/components/ui/Badge';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'prices', '/prices');
}

/** /prices (ТЗ §10): price list by Altegio categories. Prototype prices = «Демо» (no invented numbers). */
export default async function PricesPage() {
  const locale = await pageLocale();
  const t = await getTranslations();
  const services = await getServices(locale);
  const facts = serviceFacts(t as unknown as Parameters<typeof serviceFacts>[0]);
  return (
    <div className="container page">
      <PageLd kind="prices" />
      <PageHead up title={t('prices.title')} lead={t('prices.lead')} />
      {getCategories(locale).map((c) => (
        <section key={c.id} className="page-sec">
          <h2 className="h3">{c.title}</h2>
          <div className="table-wrap">
            <table className="price-table">
              {/* price first, then duration — the order of the cards; no «—» stand-in for a missing duration (design audit F16) */}
              <thead><tr><th scope="col">{t('prices.col.service')}</th><th scope="col">{t('prices.col.price')}</th><th scope="col">{t('prices.col.duration')}</th></tr></thead>
              <tbody>{services.filter((s) => s.categoryId === c.id).map((s) => (
                <tr key={s.id}><th scope="row"><Link href={`/services/${s.slug}`}>{s.title}</Link></th><td className="tn price-table__price">{facts.price(s)} <Badge>{facts.demo}</Badge></td><td className="tn">{facts.durationList(s) ?? ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="page-cta">
        <p className="cap">{t('prices.note')}</p>
        <Link href="/booking" className="btn btn--primary btn-book">{t('prices.cta')}</Link>
      </div>
    </div>
  );
}
