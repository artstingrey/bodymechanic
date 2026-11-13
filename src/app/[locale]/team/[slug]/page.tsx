import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getStaff, staffSlugs } from '@/lib/api';
import { NearestSlots } from '@/components/team/NearestSlots';
import { PageHead } from '@/components/sections/PageHead';
import { BookingLink } from '@/components/booking/BookingLink';
import { Badge } from '@/components/ui/Badge';
import { PhotoPlaceholder, staffNumber } from '@/components/ui/Cards';
import { Todo } from '@/components/ui/Todo';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

export const dynamicParams = false;
export function generateStaticParams() {
  return staffSlugs().map((slug) => ({ slug }));
}

async function find(slug: string) {
  return (await getStaff(await pageLocale())).find((s) => s.slug === slug);
}

export async function generateMetadata({ params }: PageProps<'/[locale]/team/[slug]'>) {
  const { slug } = await params;
  const s = await find(slug);
  return pageMetadata(await pageLocale(), 'staff', `/team/${slug}`, { name: s?.name ?? '', position: s?.position ?? '' });
}

/** /team/[slug] (ТЗ §10, SHOULD): profile, nearest free slots (book_staff_seances), reviews, booking with this specialist. */
export default async function StaffPage({ params }: PageProps<'/[locale]/team/[slug]'>) {
  const { slug } = await params;
  const t = await getTranslations();
  const s = await find(slug);
  if (!s) notFound();
  return (
    <ScopeMessages messages={await pickMessages(['booking.staff'])}>
    <article className="container page">
      <PageLd kind="staff" slug={slug} />
      {/* R-FINAL-2 D-03 (lead, option A), the same template as /services/[slug]: below 1024 — head, «Записаться к специалисту»,
          specialization, nearest slots, then the photo; ≥ 1024 looks as before (pages.css restores the order). */}
      <div className="profile">
        <div className="profile__photo staff"><PhotoPlaceholder caption={t('placeholder.specialistPhoto')} num={staffNumber(s.name)} /></div>
        <div className="profile__text">
          {/* «Демо» under the name, as in the team list (design audit F18) */}
          <PageHead crumbs={[{ href: '/team', label: t('team.title') }, { label: s.name }]} title={s.name} up><Badge className="page-head__badge">{t('prototype.demoBadge')}</Badge></PageHead>
          {/* Ж-9: the specialist is handed over at the click, the address is the bare /booking/ (components/booking/BookingLink) */}
          <BookingLink preset={{ staff: s.id }} className="btn btn--primary btn-book">{t('common.actions.bookWithSpecialist')}</BookingLink>
          {/* «Специализация: Демо» read as a data error (F18): shown only once the position is real */}
          {s.position !== t('prototype.demoBadge') ? <p className="lead hero-lead">{`${t('team.profile.specialization')}: ${s.position}`}</p> : null}
          <section className="profile__slots">
            <h2 className="h3">{t('team.profile.nearestSlots')}</h2>
            <NearestSlots staffId={s.id} />
          </section>
          <Link href="/team" className="btn btn--text">{t('team.profile.back')}</Link>
        </div>
      </div>
      <div className="doc-sections">
        {(['experience', 'education', 'certificates', 'languages'] as const).map((k) => (
          <section key={k}><h2 className="h3">{t(`team.profile.${k}`)}</h2><Todo as="p">{t('team.todo.bio')}</Todo></section>
        ))}
        <section className="doc-sections__wide"><h2 className="h3">{t('team.profile.reviews')}</h2><p className="cap">{t('home.reviews.comingSoon')}</p><Todo as="p" hidden>{t('home.reviews.items')}</Todo></section>
      </div>
    </article>
    </ScopeMessages>
  );
}
