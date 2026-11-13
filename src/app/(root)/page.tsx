/**
 * "/" → /ru/ or /en/ (ТЗ §12: by browser language, default EN; the user's saved choice wins).
 * A static host cannot read Accept-Language, so the choice is made in the browser.
 * DECISION: do NOT add a Render redirect for "/" — it would bypass this language detection. Without JS → /en/.
 */
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';

const pick = `(function(){try{
var saved=localStorage.getItem('bm.locale')||(document.cookie.match(/(?:^|; )NEXT_LOCALE=(ru|en)/)||[])[1];
if(saved!=='ru'&&saved!=='en')saved=null;
var nav=((navigator.languages&&navigator.languages[0])||navigator.language||'en').toLowerCase();
var l=saved||(nav.indexOf('ru')===0?'ru':'en');
location.replace('/'+l+'/'+location.search+location.hash);
}catch(e){location.replace('/en/');}})();`;

// Plain <a>: /ru/ and /en/ are separate root layouts — a full document load is intended here.
/* eslint-disable @next/next/no-html-link-for-pages */
export default function RootPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: pick }} />
      <noscript><meta httpEquiv="refresh" content="0; url=/en/" /></noscript>
      <p>{en.common.brand}: <a href="/en/" hrefLang="en" lang="en">{en.footer.lang.en}</a> · <a href="/ru/" hrefLang="ru" lang="ru">{ru.footer.lang.ru}</a></p>
    </>
  );
}
