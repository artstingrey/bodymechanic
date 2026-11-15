import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { PageHead } from '@/components/sections/PageHead';
import { isTodo } from '@/components/ui/Todo';
import { STUDIO, STUDIO_MAP } from '@/lib/config';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'contacts', '/contacts');
}

const FIELDS = ['directions', 'parking', 'hours', 'whatsapp', 'phone', 'email'] as const;

export default async function ContactsPage() {
  const t = await getTranslations();
  const mapTitle = t('contacts.mapLabel');
  const contacts = FIELDS.map((key) => [key, t(`contacts.value.${key}`)] as const).filter(([, value]) => !isTodo(value));
  return (
    <div className="container page">
      <PageLd kind="contacts" />
      <PageHead up title={t('contacts.title')} />
      <div className="contacts">
        <dl className="contacts__list">
          <div><dt>{t('contacts.label.address')}</dt><dd>{STUDIO.streetAddress}</dd></div>
          {contacts.map(([key, value]) => (
            <div key={key}><dt>{t(`contacts.label.${key}`)}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        <div className="contacts__map">
          <figure className="contacts__map-frame" aria-label={mapTitle}>
            <iframe
              src={STUDIO_MAP.embedUrl}
              title={mapTitle}
              allowFullScreen
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </figure>
          <a className="btn btn--text" href={STUDIO_MAP.url} target="_blank" rel="noopener noreferrer">{t('contacts.openMap')}</a>
        </div>
      </div>
    </div>
  );
}
