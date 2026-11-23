import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { catalogCategoryIds } from '@/content/catalog-categories';
import { LangSwitch } from './LangSwitch';
import { BurgerRoot, BurgerButton, BurgerDialog } from './BurgerMenu';
import { HeaderScroll } from './HeaderScroll';

/**
 * Global header (RC-8, the client's approved «floating header»): a pill over the page, on every page. It keeps the in-flow height of
 * the old bar (--header-h), so nothing below moves and the sticky / anchor offsets stay right.
 * Logo kit п.17: full horizontal lockup from 1024, compact nano lockup below.
 * Both lockups are the «-plate» copies (scripts/brand-plate.mjs): a light plate inside the image keeps the mark readable when a
 * browser force-darkens the page (R-FINAL-2 D-06); layout.css takes the plate's padding back, so the layout box is unchanged, and
 * keeps the pill solid --bg (the plate's own colour) under the lockup, so no box shows around it over any block or under the scrim.
 * Menu items ≥1280; below that the burger carries the sections. «Записаться» ≥768 (FAB below 768).
 */
export async function Header() {
  const t = await getTranslations();
  const main = [
    // Stable menu links for the studio's public Altegio categories.
    { key: 'onlineBooking', href: { pathname: '/services', query: { category: catalogCategoryIds.onlineBooking } } },
    { key: 'offsiteServices', href: { pathname: '/services', query: { category: catalogCategoryIds.offsiteServices } } },
    { key: 'approach', href: '/#approach' },
    { key: 'team', href: '/team' },
    { key: 'prices', href: '/prices' },
    { key: 'faq', href: '/#faq' },
    { key: 'contacts', href: '/contacts' },
  ];
  return (
    <header className="site-header">
      <HeaderScroll />
      <BurgerRoot>
      <div className="site-header__bar">
      <div className="site-header__bg" aria-hidden="true" />
      <div className="site-header__row">
        {/* prefetch off (as in the footer): the banner / logo prefetches started before the LCP of /booking and counted against it */}
        <Link href="/" prefetch={false} aria-label={t('nav.logoAria')} className="site-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG from the brand kit */}
          <img className="logo-full" src="/brand/bm-lockup-horizontal-color-plate.svg" width={323} height={78} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-nano" src="/brand/bm-lockup-compact-nano-color-plate.svg" width={242} height={52} alt="" />
        </Link>
        <nav aria-label={t('nav.main.label')} className="site-nav">
          <ul>{main.map((m) => <li key={m.key}><Link href={m.href}>{t(`nav.main.${m.key}`)}</Link></li>)}</ul>
        </nav>
        <LangSwitch />
        <ButtonLink href="/booking" size="sm" className="btn-book">{t('nav.book')}</ButtonLink>
        <BurgerButton />
      </div>
      </div>
      <BurgerDialog />
      </BurgerRoot>
    </header>
  );
}
