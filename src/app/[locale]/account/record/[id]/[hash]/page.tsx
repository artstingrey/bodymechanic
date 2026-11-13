import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { privateMetadata } from '@/lib/seo';
import { DEMO } from '@/lib/api';
import { RecordFromUrl } from '@/components/account/Account';
import { PageHead } from '@/components/sections/PageHead';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

// Static export: only the demo record is pre-rendered; other ids are served by the generic page via a Render rewrite.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ id: String(DEMO.id), hash: DEMO.hash }];
}

export async function generateMetadata({ params }: PageProps<'/[locale]/account/record/[id]/[hash]'>) {
  const { id, hash } = await params;
  return privateMetadata(await pageLocale(), 'account', `/account/record/${id}/${hash}`);
}

export default async function RecordPage() {
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
