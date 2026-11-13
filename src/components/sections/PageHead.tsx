import type { CSSProperties, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Icon } from '@/components/ui/Icon';
import { longWordEm, noWidow, tailEm } from '@/lib/typo';
import '@/styles/pages.css';

type Href = Parameters<typeof Link>[0]['href'];

/**
 * Inner-page head: breadcrumbs (Главная / … / current), optional eyebrow, H1, lead, extra content (filters, CTA).
 * `up` (service and specialist pages, R-FINAL-2 F2-03): below 600 px the trail shows only the parent as «← Услуги» — the
 * current page repeats the H1 right below and cost a line on long titles. The BreadcrumbList JSON-LD keeps the full path.
 * RC-6 (lead + AD + BD): every first-level page (trail «Главная / page»: services, prices, team, journal, contacts, privacy,
 * terms, account pages) passes `up` too, so phones show «← Главная» on one line everywhere — «Главная / Политика
 * конфиденциальности» took two lines on 320. From 600 px, and on second-level pages without `up` (article), the full trail.
 */
export async function PageHead({ crumbs = [], eyebrow, title, lead, children, split = true, up = false }: {
  crumbs?: { href?: Href; label: string }[]; eyebrow?: ReactNode; title: string; lead?: ReactNode; children?: ReactNode; split?: boolean; up?: boolean;
}) {
  const t = await getTranslations();
  // a section page without explicit crumbs is «Главная / <title>» — the current page is the last item (aria-current), the
  // same trail as its BreadcrumbList JSON-LD (Frontend Builder's note, 2026-11-07)
  const long = title.length > 32;
  const tail = long ? tailEm(title, 14) : undefined;
  const word = longWordEm(title); // RC-5: a word too long for a 320 column at 30 px lowers the H1 (pages.css [data-word])
  const vars = { ...(tail ? { '--tail': tail } : {}), ...(word ? { '--word': word } : {}) };
  const items = [{ href: '/' as Href, label: t('nav.breadcrumbs.home') }, ...(crumbs.length ? crumbs : [{ label: title }])];
  return (
    <header className="page-head" data-fab-anchor="">
      <nav className={up ? 'crumbs crumbs--up' : 'crumbs'} aria-label={t('nav.breadcrumbs.label')}>
        <ol>
          {items.map((it, i) => (
            <li key={i} style={{ display: 'contents' }} className={up && i === items.length - 2 ? 'crumbs__up' : undefined}>
              {i > 0 ? <span className="sep" aria-hidden="true">/</span> : null}
              {it.href && i < items.length - 1
                ? <Link href={it.href}>{up && i === items.length - 2 ? <Icon name="arrow-left" className="crumbs__arrow" /> : null}{it.label}</Link>
                : <span aria-current="page">{it.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      {eyebrow ? <p className="lbl-u eyebrow">{eyebrow}</p> : null}
      {/* data-long: titles over 32 characters (lead, F11) — a service H1 drops to 26 px on phones (pages.css); --tail: the
          last-line unit in em, the size goes lower still where 26 px would hang the last word (320–359 px, RC-2) */}
      <h1 className="h1" data-split={split ? '' : undefined} data-long={long ? '' : undefined} data-word={word ? '' : undefined} style={tail || word ? (vars as CSSProperties) : undefined}>{noWidow(title, 14)}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
      {children}
    </header>
  );
}
