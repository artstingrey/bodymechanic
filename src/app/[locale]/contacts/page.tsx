import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { PageHead } from '@/components/sections/PageHead';
import { isTodo } from '@/components/ui/Todo';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'contacts', '/contacts');
}

const FIELDS = ['address', 'directions', 'parking', 'hours', 'whatsapp', 'phone', 'email'] as const;

/** /contacts (ТЗ §10): all values TODO(content). Map: a placeholder until the address is known, then the facade — the Google Maps
 * iframe loads only after a click (README §5, IN-07). */
export default async function ContactsPage() {
  const t = await getTranslations();
  const contacts = FIELDS.map((key) => [key, t(`contacts.value.${key}`)] as const).filter(([, value]) => !isTodo(value));
  return (
    <div className="container page">
      <PageLd kind="contacts" />
      <PageHead up title={t('contacts.title')} />
      <div className="contacts">
        {contacts.length === 0
          ? (t.has('contacts.pending') ? (
            <div className="contacts__list">
              <p className="pending">{t('contacts.pending')}</p>
            </div>
          ) : null)
          : <dl className="contacts__list">{contacts.map(([key, value]) => <div key={key}><dt>{t(`contacts.label.${key}`)}</dt><dd>{value}</dd></div>)}</dl>}
        {isTodo(t('contacts.value.address'))
          ? (
            // The branded map placeholder uses the same pending-address copy as the landing pages.
            <figure className="map-facade map-facade--pending">
              <span className="map-facade__pin" aria-hidden="true" />
              {t.has('lp.directions.pending') ? <figcaption className="map-facade__cap">{t('lp.directions.pending')}</figcaption> : null}
            </figure>
          )
          : (
            // with an address: the facade; its button swaps in the Google Maps iframe (README §5, IN-07). The click is wired with
            // the coordinates at launch — until then the button stays disabled.
            <figure className="map-facade" aria-label={t('contacts.mapLabel')}>
              <span className="space__tick" aria-hidden="true" />
              <button type="button" className="btn btn--secondary" disabled>{t('contacts.mapFacade.button')}</button>
              <figcaption className="cap">{t('contacts.mapFacade.note')}</figcaption>
            </figure>
          )}
      </div>
    </div>
  );
}
