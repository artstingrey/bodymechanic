import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LangSwitch } from './LangSwitch';
import { CookieSettingsLink } from './CookieBanner';
import { Todo, isTodo } from '@/components/ui/Todo';
import { STUDIO } from '@/lib/config';

/**
 * Footer (ТЗ §04, §05.10; ui-kit «Подвал»): giant mark on --dark (wide ≥768, stacked on phones), columns
 * Services / Studio / Contacts / Language (2 → 4 columns), documents, © 2026.
 * Phones (< 768): RC-7 one centred axis — logo,
 * group headings, link rows and legal lines (layout.css, Brand Designer's variant B). The stacked lockup's viewBox has 6 units
 * of room under «MECHANIC» (RC-7, BD: its letters ended 2 units below the old box), hence 720 × 549; the wide one (≥ 768) was
 * cut at the top and the bottom (drawing −3.5 … 404.1 in 0 … 400.6) and has 8 units on both now, hence 1680 × 417.
 */
/** the footer's contact rows: label key (or «social» for «Instagram · Telegram»), value key */
const CONTACT_ROWS = [['footer.links.whatsapp', 'contacts.value.whatsapp'], ['footer.links.phone', 'contacts.value.phone'],
  ['footer.links.email', 'contacts.value.email'], ['social', 'footer.socialLinks']] as const;

export async function Footer() {
  const t = await getTranslations();
  const contacts = CONTACT_ROWS.filter(([, key]) => !isTodo(t(key)));
  const legalEntity = t('footer.legalEntity');
  return (
    <footer className="site-footer on-dark">
      <div className="container">
        <p className="site-footer__logo">
          <picture>
            <source media="(min-width: 768px)" srcSet="/brand/bm-footer-giant-wide-on-dark.svg" width={1680} height={417} />
            <img src="/brand/bm-footer-giant-stacked-centered-on-dark.svg" width={720} height={549} alt={t('common.brand')} loading="lazy" decoding="async" />
          </picture>
        </p>
        <nav aria-label={t('nav.footer.label')} className="site-footer__cols">
          <div><h2>{t('footer.col.services')}</h2><ul>
            <li><Link prefetch={false} href="/services">{t('footer.links.allServices')}</Link></li>
            <li><Link prefetch={false} href="/prices">{t('footer.links.prices')}</Link></li>
            <li><Link prefetch={false} href="/booking">{t('footer.links.book')}</Link></li>
          </ul></div>
          <div><h2>{t('footer.col.studio')}</h2><ul>
            <li><Link prefetch={false} href="/#approach">{t('footer.links.approach')}</Link></li>
            <li><Link prefetch={false} href="/team">{t('footer.links.team')}</Link></li>
            {/* <li><Link prefetch={false} href="/journal">{t('footer.links.journal')}</Link></li> */}
            <li><Link prefetch={false} href="/#faq">{t('footer.links.faq')}</Link></li>
          </ul></div>
          <div><h2>{t('footer.col.contacts')}</h2><ul>
            <li><Link prefetch={false} href="/contacts">{t('footer.links.address')}</Link></li>
            <li className="ct ct--address">{STUDIO.streetAddress}</li>
            {contacts.map(([label, v]) => (
              <li key={v} className="ct"><span>{label === 'social' ? `${t('footer.social.instagram')} · ${t('footer.social.telegram')}` : t(label)}</span><Todo>{t(v)}</Todo></li>
            ))}
          </ul></div>
          <div><h2>{t('footer.col.language')}</h2><LangSwitch variant="long" /></div>
        </nav>
        <div className="site-footer__legal">
          <p>{t('footer.copyright', { year: 2026 })}{isTodo(legalEntity) ? null : <> {legalEntity}</>}</p>
          <ul className="site-footer__docs">
            <li><Link prefetch={false} href="/privacy">{t('footer.docs.privacy')}</Link></li>
            {/* <li><Link prefetch={false} href="/terms">{t('footer.docs.terms')}</Link></li> */}
            <li><CookieSettingsLink label={t('footer.docs.cookies')} /></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
