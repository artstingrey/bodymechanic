import { getTranslations } from 'next-intl/server';
import { StudioMapFrame } from '@/components/ui/StudioMapFrame';
import { isTodo } from '@/components/ui/Todo';
import { INSTAGRAM_URL, STUDIO, STUDIO_MAP, WHATSAPP_NUMBER, WHATSAPP_URL } from '@/lib/config';
import '@/styles/studio-contacts.css';

const FIELDS = ['directions', 'parking', 'hours', 'phone', 'email'] as const;

export async function StudioContacts() {
  const t = await getTranslations('contacts');
  const contacts = FIELDS.map((key) => [key, t(`value.${key}`)] as const).filter(([, value]) => !isTodo(value));

  return (
    <div className="contacts">
      <dl className="contacts__list">
        <div><dt>{t('label.address')}</dt><dd>{STUDIO.streetAddress}</dd></div>
        {contacts.map(([key, value]) => (
          <div key={key}><dt>{t(`label.${key}`)}</dt><dd>{value}</dd></div>
        ))}
        <div>
          <dt>{t('label.whatsapp')}</dt>
          <dd><a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">{WHATSAPP_NUMBER}</a></dd>
        </div>
        <div>
          <dt>{t('label.instagram')}</dt>
          <dd><a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">{t('value.instagram')}</a></dd>
        </div>
      </dl>
      <div className="contacts__map">
        <StudioMapFrame className="contacts__map-frame" title={t('mapLabel')} />
        <a className="contacts__map-link" href={STUDIO_MAP.url} target="_blank" rel="noopener noreferrer">{t('openMap')}</a>
      </div>
    </div>
  );
}
