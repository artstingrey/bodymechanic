import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { PageLd } from '@/components/seo/PageLd';
import { PageHead } from '@/components/sections/PageHead';
import { Todo, isTodo } from '@/components/ui/Todo';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'contacts', '/contacts');
}

const FIELDS = ['address', 'directions', 'parking', 'hours', 'whatsapp', 'phone', 'email'] as const;

/** /contacts (ТЗ §10): all values TODO(content). Map: a placeholder until the address is known, then the facade — the Google Maps
 * iframe loads only after a click (README §5, IN-07). */
export default async function ContactsPage() {
  const t = await getTranslations();
  return (
    <div className="container page">
      <PageLd kind="contacts" />
      <PageHead up title={t('contacts.title')} />
      <div className="contacts">
        {/* nothing known yet (all seven values TODO): one line + one «Демо» for the block, not a pill on every row (BD recheck S03,
            lead: one demo mark per block; MA: contacts.pending comes with the RC-3 deck). The notes stay in data-todo for QA. */}
        {FIELDS.every((k) => isTodo(t(`contacts.value.${k}`)))
          ? (
            <div className="contacts__list">
              <p className="pending">{t.has('contacts.pending') ? <span>{t('contacts.pending')}</span> : null}<span className="badge">{t('prototype.demoBadge')}</span></p>
              {FIELDS.map((k) => <Todo key={k} as="span" hidden>{t(`contacts.value.${k}`)}</Todo>)}
            </div>
          )
          : <dl className="contacts__list">{FIELDS.map((k) => (<div key={k}><dt>{t(`contacts.label.${k}`)}</dt><Todo as="dd">{t(`contacts.value.${k}`)}</Todo></div>))}</dl>}
        {isTodo(t('contacts.value.address'))
          ? (
            // no address yet (reviewer, RC-2): the brand map placeholder, as the landing's «Как добраться» — Bone plate, the
            // pin, «Адрес появится перед запуском» (the page's one «Демо» sits with the list above, S03). No grid, no disabled
            // button, no «loads after the click» hint.
            <figure className="map-facade map-facade--pending">
              <span className="map-facade__pin" aria-hidden="true" />
              <figcaption className="map-facade__cap">{t.has('lp.directions.pending') ? <span>{t('lp.directions.pending')}</span> : <span className="badge">{t('prototype.demoBadge')}</span>}</figcaption>
            </figure>
          )
          : (
            // with an address: the facade; its button swaps in the Google Maps iframe (README §5, IN-07). The click is wired with
            // the coordinates at launch — until then the button stays disabled.
            <figure className="map-facade" aria-label={t('contacts.mapLabel')}>
              <span className="space__tick" aria-hidden="true" />
              <button type="button" className="btn btn--secondary" disabled>{t('contacts.mapFacade.button')}</button>
              <figcaption className="cap">{t('contacts.mapFacade.note')}</figcaption>
            </figure>
          )}
      </div>
    </div>
  );
}
