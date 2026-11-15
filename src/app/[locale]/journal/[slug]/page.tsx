import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { articleSlugs, getArticles } from '@/lib/api';
import { PageHead } from '@/components/sections/PageHead';
import { Silhouette } from '@/components/ui/Cards';
import { Photo, coverOf } from '@/components/ui/Photo';
import { stripTodo, isTodo } from '@/components/ui/Todo';
import { DEMO_LABEL } from '@/lib/api/mock-data';

export const dynamicParams = false;
export function generateStaticParams() {
  return articleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<'/[locale]/journal/[slug]'>) {
  const { slug } = await params;
  const a = getArticles(await pageLocale()).find((x) => x.slug === slug);
  return pageMetadata(await pageLocale(), 'article', `/journal/${slug}`, { title: a?.title ?? '', excerpt: stripTodo(a?.excerpt ?? '') });
}

/** /journal/[slug] (README §13): article with TOC, author-specialist, «book with the author». */
export default async function ArticlePage({ params }: PageProps<'/[locale]/journal/[slug]'>) {
  const { slug } = await params;
  const t = await getTranslations();
  const locale = await pageLocale();
  const all = getArticles(locale);
  const idx = all.findIndex((x) => x.slug === slug);
  const a = all[idx];
  if (!a) notFound();
  const body = t('journal.todo.articles');
  return (
    <article className="container page">
      <PageLd kind="article" slug={slug} />
      <PageHead crumbs={[{ href: '/journal', label: t('journal.title') }, { label: a.title }]} eyebrow={a.category === DEMO_LABEL[locale] ? undefined : a.category} title={a.title} />
      {coverOf(idx) ? <div className="post-cover" data-reveal="clip"><Photo set="journal" id={coverOf(idx)!} alt="" sizes="(min-width: 1440px) 1320px, 96vw" priority /></div> : null}
      <div className="post-body">
        {/* the contents card only with real contents: the placeholder was printed twice in a row (design audit F20) */}
        {isTodo(a.excerpt) ? null : <nav className="post-toc" aria-label={t('journal.article.toc')}><h2 className="lbl-u">{t('journal.article.toc')}</h2><p>{a.excerpt}</p></nav>}
        {isTodo(body) ? null : <div className="post-text"><p>{body}</p></div>}
        <aside className="post-author">
          <h2 className="lbl-u">{t('journal.article.author')}</h2>
          <div className="post-author__row"><span className="bk-opt__ava" aria-hidden="true"><Silhouette /></span><b>{t('placeholder.specialist')}</b></div>
          <Link href="/booking" className="btn btn--primary btn--sm btn-book">{t('journal.article.bookAuthor')}</Link>
        </aside>
      </div>
      <section className="page-sec">
        <h2 className="h3">{t('journal.article.related')}</h2>
        <ul className="link-list">{all.filter((x) => x.slug !== slug).map((x) => <li key={x.slug}><Link href={`/journal/${x.slug}`}>{x.title}</Link></li>)}</ul>
      </section>
    </article>
  );
}
