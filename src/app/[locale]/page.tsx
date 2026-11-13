import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/ui/Button';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { getServices, getStaff } from '@/lib/api';
import { HeroAtlas } from '@/components/sections/HeroAtlas';
import { QuickForm } from '@/components/booking/QuickForm';
import { serviceFacts } from '@/components/services/ServiceFacts';
import { Badge } from '@/components/ui/Badge';
import { Carousel } from '@/components/ui/Carousel';
import { ServiceCard, StaffCard, ReviewCard, PhotoPlaceholder } from '@/components/ui/Cards';
import { AccordionItem } from '@/components/ui/Misc';
import { Photo, hasPhoto } from '@/components/ui/Photo';
import { Todo } from '@/components/ui/Todo';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'home', '/');
}

/** Two-line hero title (hi-fi): split before « с » / « with », else at the middle space. */
function splitTitle(s: string): [string, string] {
  const m = s.search(/ (с|with) /);
  const i = m > 0 ? m : s.lastIndexOf(' ', Math.floor(s.length / 2));
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ''];
}

/** Card photo sizes: 1.3 / 2.15 / 3.2 cards per row; the 2000 w master only on 2K / retina widths (R-VIS-01). */
const CARD_SIZES = '(min-width: 1920px) 420px, (min-width: 1440px) 400px, (min-width: 1024px) 30vw, (min-width: 768px) 45vw, 76vw';
const cardTone = (i: number) => (['lav', 'sand', 'sky'] as const)[i % 3];

const FAQ = ['choose', 'duration', 'prepare', 'specialist', 'reschedule', 'contraindications'] as const;

/** Home (ТЗ §05): block order 1–10. Skeleton: structure + strings + mock data; visuals come from the style frame. */
export default async function HomePage() {
  const locale = await pageLocale();
  const t = await getTranslations();
  const [services, staff] = await Promise.all([getServices(locale), getStaff(locale)]);
  const faq = FAQ.filter((k) => t.has(`home.faq.${k}.q`));
  const title = t('home.hero.title');
  const facts = serviceFacts(t as never);
  const carT = { label: t('a11y.carousel.label'), prev: t('a11y.carousel.prev'), next: t('a11y.carousel.next'), goTo: t.raw('a11y.carousel.goTo') as string, position: t.raw('a11y.carousel.position') as string };
  const [titleA, titleB] = splitTitle(title);
  return (
    <ScopeMessages messages={await pickMessages(['body3d', 'home.hero', 'home.form', 'forms', 'booking.queued', 'booking.done', 'booking.review', 'booking.error'])}>
    <>
      <PageLd kind="home" />
      {/* 1 Hero A «Анатомический атлас» (site/design/hifi/hifi-hero.html) */}
      <section className="hero" aria-labelledby="hero-title" data-fab-anchor="">
        <div className="container hero__grid">
          <div className="hero__text">
            <p className="lbl-u eyebrow">{t('common.brandCategory')}</p>
            <h1 id="hero-title" className="h1" aria-label={title}>
              <span className="ln" aria-hidden="true">{titleA}</span> <span className="ln" aria-hidden="true">{titleB}</span>
            </h1>
            <p className="lead">{t('home.hero.subtitle')}</p>
            <div className="hero__cta">
              <ButtonLink href="/booking" className="btn-book" data-track="body_open">{t('home.hero.cta')}</ButtonLink>
              <p className="cap">{t('home.hero.note')}</p>
            </div>
          </div>
          <HeroAtlas />
        </div>
      </section>

      {/* 2 Services carousel (order: sport & rehab first — ТЗ §05.2); B photo rhythm, prices always with «Демо» */}
      <section className="section home-sec" aria-labelledby="services-title">
        <div className="container">
          <div className="sec-head">
            <div>
              <h2 id="services-title" className="h2" data-split="">{t('home.services.title')}</h2>
              <p className="lead">{t('home.services.lead')}</p>
            </div>
            <ButtonLink href="/services" variant="text">{t('home.services.all')}</ButtonLink>
          </div>
          <Carousel label={t('home.services.title')} t={carT} hideCount>
            {services.map((s, i) => (
              <ServiceCard key={s.id} href={`/services/${s.slug}`} index={i + 1} title={s.title} description={s.description}
                tone={s.slug === 'thai' ? 'sky' : cardTone(i)}
                photo={hasPhoto('services', s.slug) ? <Photo set="services" id={s.slug} alt={`${t('placeholder.illustrativePhoto')}: ${s.title}`} sizes={CARD_SIZES} /> : undefined}
                photoCaption={t('placeholder.illustrativePhoto')}
                priceLabel={t('services.card.priceLabel')} durationLabel={t('services.card.durationLabel')}
                price={<><span>{facts.priceShort(s)}</span><Badge>{facts.demo}</Badge></>} duration={facts.durationShort(s) ? <span>{facts.durationShort(s)}</span> : undefined}
                linkLabel={t('home.services.cardLink')} />
            ))}
          </Carousel>
        </div>
      </section>

      {/* 3 Approach (dark block, three columns, C hairlines) */}
      <section id="approach" className="section section--dark on-dark home-sec" aria-labelledby="approach-title">
        <div className="container">
          <h2 id="approach-title" className="h2 approach__title" data-split="">{t('home.approach.title')}</h2>
          <div className="approach">
            {(['col1', 'col2', 'col3'] as const).map((c, i) => (
              <div key={c} className="approach__col" data-reveal="">
                <span className="approach__n tn" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="h3">{t(`home.approach.${c}.title`)}</h3>
                {t.has(`home.approach.${c}.sub`) ? <p className="lbl-u approach__sub">{t(`home.approach.${c}.sub`)}</p> : null}
                <p>{t(`home.approach.${c}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4 How it works (SHOULD): four steps on a ruled line */}
      <section className="section home-sec" aria-labelledby="process-title">
        <div className="container">
          <h2 id="process-title" className="h2" data-split="">{t('home.process.title')}</h2>
          <ol className="process">
            {(['step1', 'step2', 'step3', 'step4'] as const).map((s) => (
              <li key={s} data-reveal="">
                <span className="process__n tn" aria-hidden="true">{t(`home.process.${s}.num`)}</span>
                <h3 className="h3">{t(`home.process.${s}.title`)}</h3>
                <p>{t(`home.process.${s}.text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 5 Team: intro card + specialists (Altegio book_staff; demo placeholders) */}
      <section className="section section--surface home-sec" aria-labelledby="team-title">
        <div className="container">
          <div className="sec-head">
            <h2 id="team-title" className="h2" data-split="">{t('home.team.title')}</h2>
            <ButtonLink href="/team" variant="text">{t('nav.main.team')}</ButtonLink>
          </div>
          <Carousel label={t('home.team.title')} t={carT}>
            {[
              <div key="intro" className="team-intro"><Badge>{t('prototype.demoBadge')}</Badge><p>{t('home.team.intro')}</p><ButtonLink href="/booking" variant="secondary" size="sm">{t('home.team.cta')}</ButtonLink></div>,
              ...staff.map((s) => (
                <StaffCard key={s.id} name={s.name} note={s.position !== t('prototype.demoBadge') ? s.position : undefined} href={`/team/${s.slug}`} photoCaption={t('placeholder.specialistPhoto')} />
              )),
            ]}
          </Carousel>
          <Todo as="p" hidden>{t('home.team.people')}</Todo>
        </div>
      </section>

      {/* 6 Reviews — the place stays (client decision); until real reviews: ONE sample card with «Демо» and «Отзывы скоро появятся»
          (lead's empty-state policy, design audit F07: not three identical cards) */}
      <section id="reviews" className="section home-sec" aria-labelledby="reviews-title">
        <div className="container">
          <h2 id="reviews-title" className="h2" data-split="">{t('home.reviews.title')}</h2>
          <div className="reviews reviews--empty">
            <div data-reveal=""><ReviewCard name={t('placeholder.clientName')} meta={t('home.reviews.sourceVisit')} text={t('placeholder.reviewText')} demoLabel={t('prototype.demoBadge')} /></div>
            <p className="lead reviews__soon">{t('home.reviews.comingSoon')}</p>
          </div>
          <Todo as="p" hidden>{t('home.reviews.items')}</Todo>
        </div>
      </section>

      {/* 7 Space — branded photo slots until real photos arrive (README §6) */}
      <section className="section home-sec" aria-labelledby="space-title">
        <div className="container">
          <div className="sec-head">
            <div>
              <h2 id="space-title" className="h2" data-split="">{t('home.space.title')}</h2>
              <p className="lead">{t('home.space.text')}</p>
            </div>
          </div>
          {/* one compact branded placeholder until the room photos arrive (lead's empty-state policy, design audit F05: three empty
              plaques were ≈ 950 px of nothing on a phone) */}
          <div className="space" data-reveal="">
            <PhotoPlaceholder className="space__ph" caption={t('placeholder.roomPhoto')} demo={t('prototype.demoBadge')} />
          </div>
          <Todo as="p" hidden>{t('home.space.photos')}</Todo>
        </div>
      </section>

      {/* 8 FAQ — first item open (ТЗ §05.8) */}
      <section id="faq" className="section home-sec" aria-labelledby="faq-title">
        <div className="container faq">
          <div className="faq__head">
            <h2 id="faq-title" className="h2" data-split="">{t('home.faq.title')}</h2>
            <p className="lead">{t('home.faq.more')}</p>
          </div>
          <div className="faq__list">
            {faq.map((k, i) => (
              <AccordionItem key={k} q={t(`home.faq.${k}.q`)} open={i === 0}>
                <p>{t(`home.faq.${k}.a`)}</p>
                {t.has(`home.faq.${k}.todo`) ? <Todo as="p">{t(`home.faq.${k}.todo`)}</Todo> : null}
              </AccordionItem>
            ))}
          </div>
        </div>
      </section>

      {/* 9 Quick booking form «Начните с себя» */}
      <section className="section section--sand home-sec" aria-labelledby="form-title">
        <div className="container form-sec">
          <div className="form-sec__head">
            <p className="lbl-u eyebrow">{t('home.form.eyebrow')}</p>
            <h2 id="form-title" className="h2" data-split="">{t('home.form.title')}</h2>
            <p className="lead">{t('home.form.lead')}</p>
          </div>
          <div className="form-card" data-reveal="">
            <QuickForm services={services.map((s) => ({ id: s.id, title: s.title, price: s.priceOnRequest ? null : s.priceMin }))} />
          </div>
        </div>
      </section>
    </>
    </ScopeMessages>
  );
}
