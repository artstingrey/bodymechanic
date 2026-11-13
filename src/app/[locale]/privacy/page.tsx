import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { PageHead } from '@/components/sections/PageHead';
import { Todo } from '@/components/ui/Todo';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'privacy', '/privacy');
}

/** /privacy — long-text template; the text comes from the client via CMS (TODO(content)). */
export default async function PrivacyPage() {
  const t = await getTranslations();
  return (
    <article className="container page">
      <PageLd kind="privacy" />
      <PageHead up title={t('docs.privacy.title')} split={false} />
      <div className="doc-text">
        <Todo as="p">{t('docs.todo.privacy')}</Todo>
        {/* lead: the UTM clause (decision 2026-11-07) until the lawyers' text — TODO(legal), J-04 in the lawyers' register (MA; client guide «Вопросы юристам»). No public
            «Черновик» pill (RC-4, empty-state policy as S02): the working mark stays in data-draft for QA only */}
        <p className="doc-clause" data-draft="">{t('docs.privacy.clause.utm')}</p>
      </div>
    </article>
  );
}
