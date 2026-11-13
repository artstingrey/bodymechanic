import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { PageHead } from '@/components/sections/PageHead';
import { Todo } from '@/components/ui/Todo';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'terms', '/terms');
}

/** /terms — long-text template; the text comes from the client via CMS (TODO(content)). */
export default async function TermsPage() {
  const t = await getTranslations();
  return (
    <article className="container page">
      <PageLd kind="terms" />
      <PageHead up title={t('docs.terms.title')} split={false} />
      <div className="doc-text"><Todo as="p">{t('docs.todo.terms')}</Todo></div>
    </article>
  );
}
