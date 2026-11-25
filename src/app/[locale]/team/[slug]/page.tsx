import { cache } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getStaff, staffSlugs } from '@/lib/api';
import { catalogStaffId, catalogStaffSlug } from '@/lib/catalog-staff-slug';
import type { CatalogLocale } from '@/lib/contracts/catalog';
import { getCatalogStaff } from '@/server/catalog/staff';
import { NearestSlots, StaffTodaySlots } from '@/components/team/NearestSlots';
import { HomeTeamPhoto } from '@/components/sections/HomeTeamPhoto';
import { PageHead } from '@/components/sections/PageHead';
import { BookingLink } from '@/components/booking/BookingLink';
import { PhotoPlaceholder, staffNumber } from '@/components/ui/Cards';
import { Todo } from '@/components/ui/Todo';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

const demoSlugs = new Set(staffSlugs());

const find = cache(async (locale: CatalogLocale, slug: string) => {
  const id = catalogStaffId(slug);
  if (id === undefined) {
    if (!demoSlugs.has(slug)) return null;
    const profile = (await getStaff(locale)).find((staff) => staff.slug === slug);
    return profile ? { source: 'demo', profile } as const : null;
  }

  await connection();
  const catalog = await getCatalogStaff(locale).catch(() => null);
  if (!catalog) return { source: 'unavailable' } as const;
  const staff = catalog.data.staff.find((member) => member.id === id);
  return staff ? { source: 'altegio', profile: {
    id, slug: catalogStaffSlug(id), name: staff.name, position: staff.position, description: staff.description,
    specialization: staff.specialization, avatarUrl: staff.imageUrl,
  } } as const : null;
});

export async function generateMetadata({ params }: PageProps<'/[locale]/team/[slug]'>) {
  const { slug } = await params;
  const locale = await pageLocale();
  const detail = await find(locale, slug);
  if (!detail) return {};
  const path = `/team/${slug}`;
  const t = await getTranslations({ locale });
  if (detail.source === 'unavailable') {
    return pageMetadata(locale, 'staffProfile', path, { title: t('team.profile.unavailableTitle') }, {
      description: t('team.profile.unavailable'), ogFromDescription: true,
    });
  }
  if (detail.source === 'demo') {
    return pageMetadata(locale, 'staff', path, { name: detail.profile.name });
  }

  const { name, position, specialization } = detail.profile;
  const title = position ? `${name}, ${position}` : name;
  const description = [title, specialization !== position ? specialization : null].filter(Boolean).join(' · ');
  return pageMetadata(locale, 'staffProfile', path, { title }, { description, ogFromDescription: true });
}

/** /team/[slug] (ТЗ §10, SHOULD): profile, nearest free slots (book_staff_seances), reviews, booking with this specialist. */
export default async function StaffPage({ params }: PageProps<'/[locale]/team/[slug]'>) {
  const { slug } = await params;
  const locale = await pageLocale();
  const t = await getTranslations({ locale });
  const detail = await find(locale, slug);
  if (!detail) notFound();
  if (detail.source === 'unavailable') {
    const title = t('team.profile.unavailableTitle');
    return (
      <article className="container page">
        <PageHead crumbs={[{ href: '/team', label: t('team.title') }, { label: title }]} title={title} up />
        <p className="lead" role="alert">{t('team.profile.unavailable')}</p>
        <a href={`/${locale}/team/${slug}/`} className="btn btn--secondary">{t('common.actions.retry')}</a>
      </article>
    );
  }
  const s = detail.profile;
  const real = detail.source === 'altegio';
  return (
    <ScopeMessages messages={await pickMessages(real ? ['team.profile.slots'] : ['booking.staff'])}>
    <article className="container page">
      <PageLd kind="staff" profile={s} />
      {/* R-FINAL-2 D-03 (lead, option A), the same template as /services/[slug]: below 1024 — head, «Записаться к специалисту»,
          nearest slots, then the photo; ≥ 1024 looks as before (pages.css restores the order). */}
      <div className="profile">
        <div className="profile__photo staff">
          {real ? <HomeTeamPhoto key={s.avatarUrl} src={s.avatarUrl} alt={s.name} unavailable={t('home.team.photoUnavailable')} />
            : <PhotoPlaceholder caption={t('placeholder.specialistPhoto')} num={staffNumber(s.name)} />}
        </div>
        <div className="profile__text">
          <PageHead crumbs={[{ href: '/team', label: t('team.title') }, { label: s.name }]} title={s.name} up eyebrow={real ? s.position : undefined} />
          {detail.source === 'altegio' && detail.profile.description &&
            <p className="profile__description">{detail.profile.description}</p>}
          <BookingLink preset={{ staff: s.id, staffProfile: real ? true : undefined }} className="btn btn--primary btn-book">
            {t('common.actions.bookWithSpecialist')}
          </BookingLink>
          <section className="profile__slots">
            <h2 className="h3">{t('team.profile.nearestSlots')}</h2>
            {real ? <StaffTodaySlots key={`${locale}:${s.id}`} staffId={s.id} /> : <NearestSlots staffId={s.id} />}
          </section>
        </div>
      </div>
      <div className="doc-sections" hidden>
        {(['experience', 'education', 'certificates', 'languages'] as const).map((k) => (
          <section key={k}><h2 className="h3">{t(`team.profile.${k}`)}</h2><Todo as="p">{t('team.todo.bio')}</Todo></section>
        ))}
        <section className="doc-sections__wide"><h2 className="h3">{t('team.profile.reviews')}</h2><p className="cap">{t('home.reviews.comingSoon')}</p><Todo as="p">{t('home.reviews.items')}</Todo></section>
      </div>
    </article>
    </ScopeMessages>
  );
}
