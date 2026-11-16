import type { Metadata } from 'next';
import { Suspense } from 'react';
import { preload } from 'react-dom';
import { notFound } from 'next/navigation';
import { locale as rootLocale } from 'next/root-params';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { isLocale, type Locale } from '@/i18n/routing';
import { pageUrl, SITE_URL } from '@/lib/site';
import { STUDIO, whatsappUrl } from '@/lib/config';
import CFG from '@/lib/lp/config.json';
import HERO from '@/lib/lp/hero.json';
import { Photo } from '@/components/ui/Photo';
import { PhotoPlaceholder } from '@/components/ui/Cards';
import { isTodo } from '@/components/ui/Todo';
import { Icon } from '@/components/ui/Icon';
import { LeadForm } from '@/components/lp/LeadForm';
import { SheetHero } from '@/components/lp/SheetHero';
import { StickyCta } from '@/components/lp/StickyCta';
import { LpTracking } from '@/components/lp/LpTracking';
import { LpConsent } from '@/components/lp/LpConsent';
import { LandingCatalogCards } from '@/components/lp/LandingCatalogCards';
import { chooseLandingOffer, LandingCatalogOffer } from '@/components/lp/LandingCatalogOffer';
import { StudioMapFrame } from '@/components/ui/StudioMapFrame';
import { getCatalogServices } from '@/server/catalog/services';

/**
 * Ad landing (FB/IG + Google, README-LP; frames site/landing/design/lp-frames.html): two versions on one frame — A «active
 * and athletes», B «office: neck, shoulders, lower back». Variant A reads the live service catalog.
 * The variant B service cards, offer and FAQ order come from lp-config.json.
 */
const VARIANTS = ['a', 'b'] as const;
type Variant = (typeof VARIANTS)[number];
type Crop = 'band' | 'short' | 'tall';
type CO = { n: number; key: string; x: number; y: number; side: string; len: number; phone: boolean };

export const dynamicParams = false;
export function generateStaticParams() {
  return VARIANTS.map((variant) => ({ variant }));
}

/** preload per crop: as the <picture> sources, minus the ≤ 600 px high phones that show no photo */
const PRELOAD_MEDIA = {
  short: '(max-width: 767px) and (min-height: 601px) and (max-height: 700px)',
  band: '(max-width: 1023px) and (min-height: 701px), (min-width: 768px) and (max-width: 1023px), (min-width: 1024px) and (orientation: portrait)',
  tall: '(min-width: 1024px) and (orientation: landscape)', // portrait ≥ 1024 = the tablet band (lp.css, desktop audit L4)
} as const;
const GIF1 = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const isVariant = (v: string): v is Variant => (VARIANTS as readonly string[]).includes(v);

export async function generateMetadata({ params }: { params: Promise<{ variant: string }> }): Promise<Metadata> {
  const { variant } = await params;
  const locale = (await rootLocale()) as Locale;
  if (!isVariant(variant) || !isLocale(locale)) return {};
  const t = await getTranslations({ locale });
  const vc = CFG.versions[variant];
  const path = `/lp/${variant}/`;
  const title = t(vc.seoTitleKey), description = t(vc.seoDescriptionKey);
  // The link preview when the page is shared in WhatsApp: the landing's OWN card per version and language (brand kit,
  // public/og/og-lp-<a|b>-<ru|en>.png). RC-9 (C-1): it used to be the site's card og-template-*, which has «Спортивный
  // массаж, ЛФК и реабилитация в Дубае» / «…exercise therapy and rehabilitation» drawn on it — words the landings and the
  // ads must not carry; a text check cannot see a picture, so the gate checks that the card is not the site's (lp.spec)
  const og = `${SITE_URL}/og/og-lp-${variant}-${locale}.png`;
  return {
    title, description,
    robots: { index: false, follow: false },
    alternates: { canonical: pageUrl(locale, path), languages: { ru: pageUrl('ru', path), en: pageUrl('en', path), 'x-default': pageUrl('en', path) } }, // hreflang like the site, no switcher
    openGraph: { title, description, url: pageUrl(locale, path), locale: locale === 'ru' ? 'ru_RU' : 'en_US', type: 'website', images: [{ url: og, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', images: [og] },
  };
}

/** «Спортивный массаж в Дубае: восстановление между тренировками» → [«…Дубае:», «восстановление…»] (accent on the second part) */
function splitH1(s: string): [string, string] {
  const m = /(: |\. )/.exec(s);
  if (m) return [s.slice(0, m.index + 1), s.slice(m.index + 2)];
  // EN /lp/a has no colon: «Sports massage in Dubai for | recovery between training sessions» — the same accent as RU (RC-8, BD)
  const f = /\bDubai for /.exec(s);
  return f ? [s.slice(0, f.index + f[0].length - 1), s.slice(f.index + f[0].length)] : [s, ''];
}

async function loadLandingCatalog(locale: Locale) {
  await connection();
  return getCatalogServices(locale).catch(() => null);
}

export default async function LandingPage({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  const locale = (await rootLocale()) as Locale;
  if (!isVariant(variant) || !isLocale(locale)) notFound();
  const t = await getTranslations();
  const vc = CFG.versions[variant];
  const off = CFG.offer;
  const demoOffer = { percent: off.percent, salePrice: off.demoSalePrice, price: off.demoPrice, service: t(off.keys.service) };
  const termsSet = !t(off.keys.terms).startsWith('TODO(content)');
  const legalEntity = t('footer.legalEntity');
  const chips = vc.chips.map((c) => ({ id: c.id, label: t(c.key) }));
  const waMessage = `${t(vc.waMessageKey)} ${vc.waTag}`;
  const waHref = whatsappUrl(waMessage);
  const privacyHref = `/${locale}/privacy/`;
  const [h1a, h1b] = splitH1(t(vc.defaultH1));
  const bt = CFG.blockTitleKeys;
  const [district, building, mapLink] = CFG.directions.keys.map((k) => t(k));
  const hero = HERO[variant] as Record<Crop, { ar: number[]; widths: number[]; co: CO[] }>;
  const src = (c: Crop, fmt: string) => hero[c].widths.map((w) => `/lp/${variant}-${c}-${w}.${fmt} ${w}w`).join(', ');
  const MEDIA = { none: '(max-width: 767px) and (max-height: 600px)', tall: '(min-width: 1024px) and (orientation: landscape)', short: '(max-width: 767px) and (max-height: 700px)', band: '(max-width: 1023px), (min-width: 1024px) and (orientation: portrait)' } as const;
  const SIZES = { tall: '(min-width: 1440px) 560px, 40vw', short: '100vw', band: '(min-width: 1024px) and (orientation: portrait) 960px, (min-width: 768px) 704px, 100vw' } as const;
  const example = variant === 'b' && off.status === 'example';
  const badge = t(off.keys.badge, { percent: off.percent });
  const pendingOffer = t('lp.offer.catalogPendingBody');
  // The cards and all three offer slots share the catalog read. The random choice runs once per page.
  const catalog = variant === 'a' ? loadLandingCatalog(locale) : null;
  const selectedOffer = catalog?.then((data) => chooseLandingOffer(data, locale, off.percent, t, pendingOffer));
  const catalogOffer = selectedOffer ? (
    <Suspense fallback={pendingOffer}><LandingCatalogOffer text={selectedOffer} /></Suspense>
  ) : null;
  const pill = <span className="offer-pill"><b>{badge}</b>{' '}<span>{catalogOffer ?? t(off.keys.body, demoOffer)}</span></span>;

  // LCP image (R-LP-03 F-04): preload the AVIF crop of the screen class with fetchpriority=high through ReactDOM.preload —
  // React writes such preloads into <head> right after the charset / viewport, before Next's async scripts (a JSX <link>
  // landed after all of them). No font preload competes with it (layout: preload false).
  for (const c of ['short', 'band', 'tall'] as const) {
    preload(`/lp/${variant}-${c}-${hero[c].widths[0]}.avif`, { as: 'image', type: 'image/avif', media: PRELOAD_MEDIA[c], imageSrcSet: src(c, 'avif'), imageSizes: SIZES[c], fetchPriority: 'high' });
  }
  return (
    <div className="lp" data-variant={variant}>
      {/* measurement (Frontend Builder): attribution + URL clean-up, consent → Consent Mode → GTM after load (lp-brief §5) */}
      <LpTracking variant={variant} locale={locale} />
      <LpConsent privacyHref={privacyHref} s={{
        label: t('cookie.dialogLabel'), title: t('cookie.title'), text: t('cookie.text'), learnMore: t('cookie.learnMore'),
        acceptAll: t('cookie.acceptAll'), necessaryOnly: t('cookie.necessaryOnly'), customize: t('cookie.customize'), save: t('cookie.save'),
        necessary: t('cookie.cat.necessary.title'), necessaryDesc: `${t('cookie.cat.necessary.desc')} · ${t('cookie.alwaysOn')}`,
        analytics: t('cookie.cat.analytics.title'), analyticsDesc: t('cookie.cat.analytics.desc'),
        marketing: t('cookie.cat.marketing.title'), marketingDesc: t('cookie.cat.marketing.desc'), utmNote: t('cookie.utmNote'),
      }} />
      <header className="w lp-top">
        <span className="logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, brand-kit SVG; the logo does not leave the page */}
          <img className="nano" src="/brand/bm-lockup-compact-nano-color-plate.svg" width={242} height={52} alt={t('common.brand')} fetchPriority="low" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="full" src="/brand/bm-lockup-horizontal-color-plate.svg" width={323} height={78} alt="" fetchPriority="low" />
        </span>
        <a className="btn btn--wa" href={waHref} target="_blank" rel="noopener noreferrer" aria-label={t('lp.form.whatsapp')} data-track="whatsapp">
          <span className="wa"><Icon name="whatsapp" /></span><span className="t">{t('lp.form.whatsapp')}</span>
        </a>
      </header>

      <main id="main">
        <section className="w lp-hero" aria-labelledby="lp-h1">
          <figure className="lp-media">
            <picture>
              {/* ≤ 600 px high phones show no photo (lp.css): a 1-px GIF, so nothing is downloaded */}
              <source media={MEDIA.none} srcSet={GIF1} />
              {(['tall', 'short', 'band'] as const).flatMap((c) => ['avif', 'webp'].map((f) => (
                <source key={`${c}-${f}`} media={MEDIA[c]} type={`image/${f}`} srcSet={src(c, f)} sizes={SIZES[c]} />
              )))}
              {/* art-directed crops pre-generated by site/landing/design/src/lp_assets.py */}
              <img src={`/lp/${variant}-band-860.webp`} width={860} height={Math.round(860 / (hero.band.ar[0] / hero.band.ar[1]))} alt="" fetchPriority="high" />
            </picture>
            {(['band', 'short', 'tall'] as const).flatMap((c) => hero[c].co.map((co) => (
              <span key={`${c}-${co.n}`} className="co" data-crop={c} data-n={co.n} data-phone={c === 'tall' ? undefined : String(co.phone)} data-dir={co.side}
                style={{ ['--x' as string]: `${co.x}%`, ['--y' as string]: `${co.y}%`, ['--len' as string]: `${co.len}px` }} aria-hidden="true">
                <i /><b /><span><em>{String(co.n).padStart(2, '0')}</em>{t(co.key)}</span>
              </span>
            )))}
            {pill}
            {example ? <span className="ex ex--photo">{t(off.exampleBadge.shortKey)}</span> : null}
            <figcaption className="tag">{t('placeholder.illustrativePhoto')}</figcaption>
          </figure>
          <div className="lp-copy">
            <h1 id="lp-h1">{h1a} <span className="acc">{h1b}</span></h1>
            <p className="sub">{t(vc.subKey)}</p>
            {pill}
            {example ? <span className="ex ex--copy">{t(off.exampleBadge.shortKey)}</span> : null}
          </div>
          <LeadForm id="lp-f1" variant={variant} chips={chips} waMessage={waMessage} privacyHref={privacyHref} />
          <SheetHero variant={variant} chips={chips} waMessage={waMessage} privacyHref={privacyHref} />
        </section>

        <section className="lp-sec lp-sec--first lp-rise" aria-labelledby="lp-why">
          <div className="w">
            <div className="head"><p className="lbl" id="lp-why">{t(bt.why)}</p><h2>{t(vc.situationKey)}</h2></div>
            <ul className="lp-why">
              {[1, 2, 3].map((i) => (
                <li key={i}>
                  <span className="n">{String(i).padStart(2, '0')}</span>
                  <b>{t(`lp.why.${i}.title`)}</b>
                  {i < 3 || t.has(`lp.why.${i}.text`) ? <span className="t">{t(`lp.why.${i}.text`)}</span> : null}
                  {i === 2 ? <a className="lnk" href={`/${locale}/booking/`}>{t('lp.why.2.link')}</a> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-sec lp-sec--tint lp-rise" aria-labelledby="lp-steps">
          <div className="w">
            <div className="head"><h2 id="lp-steps">{t(bt.steps)}</h2></div>
            <ol className="lp-steps">
              {[1, 2, 3].map((i) => (
                <li key={i}><span className="n">{String(i).padStart(2, '0')}</span><div><h3>{t(`lp.steps.${i}.title`)}</h3>
                  {i === 3 ? <a className="lnk" href="#lp-directions">{t(`lp.steps.${i}.text`)}</a> : <p>{t(`lp.steps.${i}.text`)}</p>}</div></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-sec lp-rise" aria-labelledby="lp-services">
          <div className="w">
            <div className="head"><h2 id="lp-services">{t(bt.services)}</h2><p className="sub">{t('lp.services.note')}</p></div>
            {catalog ? (
              <Suspense fallback={<p className="sub" role="status">{t('home.services.loading')}</p>}>
                <LandingCatalogCards catalog={catalog} locale={locale} percent={off.percent} t={t} />
              </Suspense>
            ) : <div className="lp-cards">
              {vc.services.map((sv, i) => {
                const sale = Math.round((sv.priceMin * (100 - off.percent)) / 100);
                return (
                  <article key={sv.id} className="lp-card">
                    <div className="ph">
                      <Photo set="services" id={sv.id} alt="" sizes="(min-width: 768px) 30vw, 78vw" />
                      <span className="tag">{t('placeholder.illustrativePhoto')}</span>
                    </div>
                    <div className="bd">
                      <span className="n">{String(i + 1).padStart(2, '0')}</span>
                      <h3>{t(sv.titleKey)}</h3>
                      <p>{t(sv.descriptionKey)}</p>
                      <dl>
                        <div><dt>{t('services.card.priceLabel')}</dt><dd><span className="price-row"><span className="price">{sale} {off.currency}</span> <s>{sv.priceMin}</s></span></dd></div>
                        <div><dt>{t('services.card.durationLabel')}</dt><dd>{t('mock.duration.upTo')}</dd></div>
                      </dl>
                    </div>
                  </article>
                );
              })}
            </div>}
          </div>
        </section>

        <section className="lp-sec lp-rise" style={{ paddingTop: 0 }} aria-labelledby="lp-studio">
          <div className="w">
            <div className="head"><h2 id="lp-studio">{t(bt.studio)}</h2></div>
            {/* one brand placeholder, as on the site (design audit 9: a bust of three primitives + a crosshair, captions over them) */}
            <div className="lp-studio">
              <PhotoPlaceholder caption={t('placeholder.specialistPhoto')} />
            </div>
          </div>
        </section>

        {/* R-LP-02 L-01: the address is never hidden (ads do not launch until district, building and map link are real) */}
        <section id="lp-directions" className="lp-sec lp-sec--tint lp-rise" aria-labelledby="lp-dir">
          <div className="w lp-two">
            <div className="fhead"><h2 id="lp-dir">{t(CFG.directions.titleKey)}</h2></div>
            <div className="lp-dirs">
              {variant === 'a' ? (
                <>
                  <StudioMapFrame className="map map--live" title={t('contacts.mapLabel')} />
                  <address>{STUDIO.streetAddress}</address>
                </>
              ) : (
                <>
                  <div className="map" aria-hidden="true"><span className="pin" /></div>
                  {isTodo(district) && isTodo(building) && isTodo(mapLink) && t.has('lp.directions.pending')
                    ? <p className="pending">{t('lp.directions.pending')}</p> : null}
                  {!isTodo(district) || !isTodo(building) ? (
                    <address>{[district, building].map((s, i) => isTodo(s) ? null : <span key={i}>{s}</span>)}</address>
                  ) : null}
                  {isTodo(mapLink) ? null : <a className="btn btn--wa" href={mapLink} target="_blank" rel="noopener noreferrer">{t('contacts.openMap')}<Icon name="arrow-up-right" /></a>}
                </>
              )}
            </div>
          </div>
        </section>

        <section className="lp-sec lp-rise" aria-labelledby="lp-risk">
          <div className="w lp-two">
            <div className="fhead"><h2 id="lp-risk">{t(bt.risk)}</h2></div>
            <ul className="lp-risk">{[1, 2, 3].map((i) => <li key={i}><Icon name="check" /><span>{t(`lp.risk.${i}`)}</span></li>)}</ul>
          </div>
        </section>

        <section className="lp-sec lp-rise" style={{ paddingTop: 0 }} aria-labelledby="lp-faq">
          <div className="w lp-faq-wrap">
            <div className="fhead"><h2 id="lp-faq">{t(bt.faq)}</h2></div>
            <div className="lp-faq">
              {/* a question shows only with an answer in the deck (lead, BD's LP audit L07): «Как подготовиться?» and «Как
                  перенести запись?» wait for the client (TODO register) — no «Демо» in place of an answer */}
              {CFG.faq.order.map((k) => [k, t(`${k}.${k.startsWith('home.') ? 'todo' : 'a'}`)] as const)
                .filter(([, a]) => !isTodo(a))
                .map(([k, a], i) => (
                  <details key={k} open={i === 0}>
                    <summary>{t(`${k}.q`)}</summary>
                    <p>{a}</p>
                  </details>
                ))}
            </div>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="lp-final">
          <div className="w grid">
            <div style={{ display: 'grid', gap: 12 }}>
              {/* L11 (BD, RC-4): at most three text blocks above the form — «Пример оффера — условия уточняются» qualifies the offer
                  line, so it sits in it (one block), not on a line of its own */}
              <p className="lbl">{catalogOffer ? <>{badge} {catalogOffer}</> : (
                <>{t(off.keys.full, demoOffer)}{termsSet ? ` · ${t(off.keys.urgency)}` : ''}{example ? <> <span className="ex">{t(off.exampleBadge.key)}</span></> : null}</>
              )}</p>
              <h2 id="lp-final">{t(bt.final)}</h2>
              {/* design audit 6: no triple «Оставьте номер…» — one lead in its own words (deck, Market Analyst) and no card title;
                  4: the example offer label already covers pending terms. */}
              <p className="sub">{t('lp.final.text')}</p>
              {variant === 'b' && !termsSet && !example && t.has('lp.offer.termsPending') ? <p className="pending">{t('lp.offer.termsPending')}</p> : null}
            </div>
            <LeadForm id="lp-f2" variant={variant} chips={chips} waMessage={waMessage} privacyHref={privacyHref} />
          </div>
        </section>
      </main>

      <footer className="w lp-foot">
        <div className="row">
          <span>{t('footer.copyright', { year: 2026 })}{isTodo(legalEntity) ? null : <> {legalEntity}</>}</span>
          <a href={privacyHref} target="_blank" rel="noopener">{t('footer.docs.privacy')}</a>
          <a href={`/${locale}/terms/`} target="_blank" rel="noopener">{t('footer.docs.terms')}</a>
        </div>
        <p>{t('disclaimer.general')}</p>
      </footer>
      <StickyCta label={t(variant === 'a' ? 'lp.booking.selectService' : 'lp.form.submit')}
        sheetLabel={t(variant === 'a' ? 'lp.booking.selectService' : 'lp.form.submit')} waLabel={t('lp.form.whatsapp')} waHref={waHref} />
    </div>
  );
}
