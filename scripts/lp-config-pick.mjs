/**
 * The ad landing's config as the app needs it: the WORKING fields of the deck's lp-config.json.
 * The deck file also carries the authors' notes — why a rule exists, who decided what and when, what is still to be
 * confirmed. They are documentation, not configuration; and src/lib/lp/config.json is imported by client code, so every
 * byte of it ships to the visitor's browser (security review В-5: the notes were readable in the public build).
 * `npm run sync` writes this subset into src/lib/lp/config.json; `npm run i18n` compares the committed file with it.
 * The meaning of the notes lives in docs/KNOWN-ISSUES.md, docs/BACKEND-CONTRACT.md and docs/ANALYTICS-SEO.md.
 * A field the code starts to read is added HERE — TypeScript fails on a missing one (the JSON is typed by its content).
 */
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** @param {Record<string, any>} deck the parsed lp-config.json of the deck */
export function lpWorkingConfig(deck) {
  return {
    versions: Object.fromEntries(Object.entries(deck.versions).map(([v, x]) => [v, {
      ...pick(x, ['waTag', 'defaultH1', 'subKey', 'situationKey', 'waMessageKey', 'seoTitleKey', 'seoDescriptionKey']),
      services: x.services.map((s) => pick(s, ['id', 'titleKey', 'descriptionKey', 'priceMin'])),
      chips: x.chips.map((c) => pick(c, ['id', 'key'])),
    }])),
    offer: {
      ...pick(deck.offer, ['id', 'status', 'percent', 'currency', 'demoPrice', 'demoSalePrice']),
      keys: pick(deck.offer.keys, ['badge', 'body', 'service', 'full', 'urgency', 'terms']),
      exampleBadge: pick(deck.offer.exampleBadge, ['key', 'shortKey']),
    },
    notifications: { telegram: pick(deck.notifications.telegram, ['includeMarks', 'marksLineRu', 'marksHintRu']) },
    faq: pick(deck.faq, ['order']),
    blockTitleKeys: pick(deck.blockTitleKeys, ['why', 'steps', 'services', 'studio', 'risk', 'faq', 'final']),
    directions: pick(deck.directions, ['titleKey', 'keys']),
  };
}
