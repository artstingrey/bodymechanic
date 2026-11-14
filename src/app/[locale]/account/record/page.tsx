import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { privateMetadata } from '@/lib/seo';
import { RecordFromUrl } from '@/components/account/Account';
import { PageHead } from '@/components/sections/PageHead';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

export async function generateMetadata() {
  return privateMetadata(await pageLocale(), 'account', '/account/record');
}

/** Demo record-by-link screen (PG-13). The browser reads the record ID and hash from the address. */
export default async function RecordGenericPage() {
  const t = await getTranslations();
  return (
    <ScopeMessages messages={await pickMessages(['account', 'booking.sms', 'booking.time', 'booking.error', 'forms', 'body3d.zones'])}>
    <div className="container page account">
      <PageHead up title={t('account.link.title')} split={false} />
      <RecordFromUrl />
    </div>
    </ScopeMessages>
  );
}
