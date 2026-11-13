import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getStaff } from '@/lib/api';
import { PageHead } from '@/components/sections/PageHead';
import { Badge } from '@/components/ui/Badge';
import { StaffCard } from '@/components/ui/Cards';
import { Todo } from '@/components/ui/Todo';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'team', '/team');
}

/** /team (ТЗ §10): Altegio staff + CMS bio. Prototype: «Демо-специалист» cards with photo placeholders. */
export default async function TeamPage() {
  const t = await getTranslations();
  const staff = await getStaff(await pageLocale());
  return (
    <div className="container page">
      <PageLd kind="team" />
      <PageHead up title={t('team.title')} lead={t('team.lead')}><Badge className="page-head__badge">{t('prototype.demoBadge')}</Badge></PageHead>
      <ul className="card-grid card-grid--4">{staff.map((s) => (
        <li key={s.id}>
          <StaffCard name={s.name} note={s.position !== t('prototype.demoBadge') ? s.position : undefined} href={`/team/${s.slug}`}
            photoCaption={t('placeholder.specialistPhoto')} />
        </li>))}
      </ul>
      <Todo as="p" hidden>{t('team.todo.bio')}</Todo>
    </div>
  );
}
