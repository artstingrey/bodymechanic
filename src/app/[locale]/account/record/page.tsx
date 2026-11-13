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

/**
 * Generic «record by link» page (PG-13). Render rewrite /{locale}/account/record/* → /{locale}/account/record/index.html
 * serves it for any id/hash; the component reads them from the URL (the rewrite: docs/CONFIG-DEPLOY.md; locally scripts/serve-out.mjs).
 */
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
