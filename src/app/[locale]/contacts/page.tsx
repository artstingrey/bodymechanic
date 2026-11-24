import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { PageHead } from '@/components/sections/PageHead';
import { StudioContacts } from '@/components/sections/StudioContacts';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'contacts', '/contacts');
}

export default async function ContactsPage() {
  const t = await getTranslations();
  return (
    <div className="container page">
      <PageLd kind="contacts" />
      <PageHead up title={t('contacts.title')} />
      <StudioContacts />
    </div>
  );
}
