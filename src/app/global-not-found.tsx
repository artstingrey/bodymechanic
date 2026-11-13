/**
 * 404 for every unmatched URL → out/404.html (Render serves it for missing paths, DEL-12).
 * The locale is unknown at build time. Exactly ONE language variant lives in the DOM (lead / Market Analyst, R-FINAL):
 *  - English is rendered in #nf-root; Russian waits in an inert <template> (its h1 is not part of the document);
 *  - an inline script right after them swaps in the Russian markup for /ru/… paths and sets <html lang> before the first
 *    paint; without JS the page stays English with lang="en".
 * Both variants are static HTML strings behind dangerouslySetInnerHTML, so React hydration never compares (and never
 * restores) the swapped children. Header (R-CODE-03 F-02) and body share the site chrome classes.
 * Strings: messages nav.*, notFound.* (both locales).
 */
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import ru from '../../messages/ru.json';
import en from '../../messages/en.json';
import assets from '../lib/body3d/assets.json';
import './globals.css';
import '@/styles/font-fallback.css';
import '@/styles/nf.css';

// preload: false — Next puts the global not-found fonts into every page's preload list (the ad landing must not load the
// site's variable font: task 01a1b325 §6); the 404 is rare and the site pages preload the same file from their layout
const manrope = localFont({ src: '../fonts/Manrope.woff2', weight: '200 800', display: 'optional', variable: '--font-manrope', preload: false,
  adjustFontFallback: false, fallback: ['Manrope Fallback A', 'Manrope Fallback R'] }); // RC-6: as the site (styles/font-fallback.css)

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', colorScheme: 'only light' };
export const metadata: Metadata = { title: `${en.notFound.code} · ${en.common.brand}`, robots: { index: false, follow: false } };

type L = 'ru' | 'en';
const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Header + main of one language as static markup (same classes as the site header and the in-locale 404). */
function variant(l: L, m: typeof ru): string {
  const other: L = l === 'ru' ? 'en' : 'ru';
  const ls = m.nav.langSwitch;
  const p = assets.posters.male;
  // the short switch of the pill («RU · EN») and the long one of the menu («Русский  English»), as LangSwitch renders them
  const langItems = (labels: Record<L, string>, dots: boolean) => (['ru', 'en'] as const).map((x, i) => {
    const sep = dots && i > 0 ? '<span class="sep" aria-hidden="true">·</span>' : '';
    const item = x === l
      ? `<span aria-current="true" lang="${x}">${esc(labels[x])}</span>`
      : `<a href="/${other}/" hreflang="${other}" lang="${other}" aria-label="${esc(`${labels[x]}. ${other === 'ru' ? ls.toRu : ls.toEn}`)}">${esc(labels[x])}</a>`;
    return `<span style="display:contents">${sep}${item}</span>`;
  }).join('');
  // the site's section menu as a native <details> (static page, no React): same round button on the right edge as the burger
  // everywhere else, the same links (design audit F22: the 404 header looked different, «RU · EN» stood on the right edge)
  const menu = ([['services/', 'nav.burger.services'], ['prices/', 'nav.main.prices'], ['team/', 'nav.main.team'], ['#approach', 'nav.main.approach'],
    ['#reviews', 'nav.main.reviews'], ['#faq', 'nav.main.faq'], ['journal/', 'nav.burger.journal'], ['contacts/', 'nav.burger.contacts']] as const)
    .map(([href, key]) => { const [g, k] = key.split('.').slice(1) as ['burger' | 'main', string]; return `<li><a href="/${l}/${href}">${esc((m.nav[g] as Record<string, string>)[k])}</a></li>`; }).join('');
  // the same bar as the site layout: the long note from 768 px, prototype.demoNoticeShort on phones (layout.css; reviewer, RC-2:
  // the 404 kept the long note in two lines)
  return `<p class="demo-notice" role="note" lang="${l}"><span class="demo-badge">${esc(m.prototype.demoBadge)}</span> `
    + `<span class="demo-notice__full">${esc(m.prototype.demoNotice)}</span><span class="demo-notice__short">${esc(m.prototype.demoNoticeShort)}</span></p>`
    + `<header data-nf="${l}" lang="${l}" class="site-header"><div class="site-header__bar"><div class="site-header__bg" aria-hidden="true"></div>`
    + `<div class="site-header__row"><a href="/${l}/" aria-label="${esc(m.nav.logoAria)}" class="site-logo">`
    + `<img class="logo-full" src="/brand/bm-lockup-horizontal-color-plate.svg" width="323" height="78" alt="">`
    + `<img class="logo-nano" src="/brand/bm-lockup-compact-nano-color-plate.svg" width="242" height="52" alt=""></a>`
    + `<nav aria-label="${esc(ls.label)}" class="lang-switch">${langItems(ls, true)}</nav>`
    + `<a href="/${l}/booking/" class="btn btn--primary btn--sm btn-book">${esc(m.nav.book)}</a>`
    + `<details class="nf-menu"><summary class="burger" aria-label="${esc(m.nav.burger.open)}"><svg viewBox="0 0 18 14" aria-hidden="true" focusable="false"><line x1="1" x2="17" y1="1" y2="1"/><line x1="1" x2="17" y1="7" y2="7"/><line x1="1" x2="17" y1="13" y2="13"/></svg></summary>`
    + `<div class="nf-menu__panel"><nav aria-label="${esc(m.nav.burger.sections)}"><ul>${menu}</ul></nav>`
    // the rest of the menu (BD, RC-8: not a cut-down version): the account, the language, the action
    + `<a class="acct" href="/${l}/account/"><span class="av" aria-hidden="true"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg></span>`
    + `<span><b>${esc(m.nav.burger.account)}</b><small>${esc(m.nav.burger.accountHint)}</small></span><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a>`
    + `<div class="meta"><nav aria-label="${esc(ls.label)}" class="lang-switch lang-switch--long">${langItems(m.footer.lang, false)}</nav></div>`
    + `<div class="nf-menu__cta"><a class="btn btn--primary" href="/${l}/booking/">${esc(m.nav.book)}</a></div></div></details></div></div></header>`
    + `<main id="main" lang="${l}"><section data-nf="${l}" class="container page nf"><div class="nf__text">`
    + `<p class="nf__code tn" aria-hidden="true">${esc(m.notFound.code)}</p><h1 class="h1">${esc(m.notFound.title)}</h1>`
    + `<p class="lead">${esc(m.notFound.text)}</p><ul class="nf__links">`
    // two actions, as the text says (F22: a third «Записаться →» hung alone on ≤ 402 px); the sections are in the menu
    + `<li><a class="btn btn--primary" href="/${l}/">${esc(m.notFound.home)}</a></li>`
    + `<li><a class="btn btn--secondary" href="/${l}/booking/">${esc(m.notFound.book)}</a></li></ul></div>`
    // the front-view model (no crosshair: it aimed at nothing, design audit F22; same art as the in-locale 404)
    + `<figure class="nf__art"><picture><source srcset="${p.avif}" type="image/avif"><source srcset="${p.webp}" type="image/webp">`
    + `<img src="${p.png}" width="${p.width}" height="${p.height}" alt="${esc(m.notFound.illustrationAlt)}" loading="lazy" decoding="async"></picture>`
    + `</figure></section></main>`;
}

const pickLang = `(function(){var p=location.pathname,ru=p.indexOf('/ru/')===0||p==='/ru';
document.documentElement.lang=ru?'ru':'en';if(!ru)return;
var root=document.getElementById('nf-root'),t=document.getElementById('nf-ru');if(root&&t)root.innerHTML=t.innerHTML;})();`;

export default function GlobalNotFound() {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <div id="nf-root" dangerouslySetInnerHTML={{ __html: variant('en', en) }} />
        <template id="nf-ru" dangerouslySetInnerHTML={{ __html: variant('ru', ru) }} />
        <script dangerouslySetInnerHTML={{ __html: pickLang }} />
      </body>
    </html>
  );
}
