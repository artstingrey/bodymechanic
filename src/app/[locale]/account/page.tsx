import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { privateMetadata } from '@/lib/seo';
import { Account } from '@/components/account/Account';
import { PageHead } from '@/components/sections/PageHead';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

export async function generateMetadata() {
  return privateMetadata(await pageLocale(), 'account', '/account');
}

export default async function AccountPage() {
  const t = await getTranslations();
  return (
    <ScopeMessages messages={await pickMessages(['account', 'booking.sms', 'booking.time', 'booking.error', 'forms', 'body3d.zones'])}>
    <div className="container page account">
      <PageHead up title={t('account.title')} split={false} />
      <Account />
    </div>
    </ScopeMessages>
  );
}
