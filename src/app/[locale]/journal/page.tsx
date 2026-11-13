import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getArticles } from '@/lib/api';
import { PageHead } from '@/components/sections/PageHead';
import { Icon } from '@/components/ui/Icon';
import { Photo, coverOf, COVER_SIZES } from '@/components/ui/Photo';
import { Todo } from '@/components/ui/Todo';
import { Badge } from '@/components/ui/Badge';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'journal', '/journal');
}

/** /journal (ТЗ §10, SHOULD): article list with categories. Prototype: «Демо-статья» placeholders with the final covers (R-VIS-01). */
export default async function JournalPage() {
  const t = await getTranslations();
  const articles = getArticles(await pageLocale());
  return (
    <div className="container page">
      <PageLd kind="journal" />
      {/* no category filter while there is only «Все рубрики»: a single dark chip read as a call to action leading nowhere
          (design audit F19); the chip row comes back with real categories */}
      <PageHead up title={t('journal.title')} lead={t('journal.lead')} />
      <ul className="card-grid">{articles.map((a, i) => (
        <li key={a.slug}>
          <article className="post">
            <div className="post__cover" data-reveal="clip">{coverOf(i) ? <Photo set="journal" id={coverOf(i)!} alt="" sizes={COVER_SIZES} priority={i === 0 ? 'high' : i < 3} /> : null}</div>
            {a.category === t('prototype.demoBadge') ? <p className="post__badge"><Badge>{a.category}</Badge></p> : <p className="lbl-u eyebrow">{a.category}</p>}
            <h2 className="h3"><Link href={`/journal/${a.slug}`}>{a.title}</Link></h2>
            <Todo as="p" hidden>{a.excerpt}</Todo>
            <span className="btn btn--text" aria-hidden="true">{t('journal.card.read')}<Icon name="arrow-right" /></span>
          </article>
        </li>
      ))}</ul>
      <Todo as="p" hidden>{t('journal.todo.articles')}</Todo>
    </div>
  );
}
