/**
 * Comment of an Altegio record (ТЗ §08, README п.10, site/copy/comment-template.json) — BILINGUAL by default.
 * settings.staffCommentLanguage (CMS): 'ru' | 'en' | 'both' (default 'both').
 *  - ru / en: labels and zone names in that language;
 *  - both: every label and zone name as «RU / EN» in one line («Пол / Gender: М / M», «Колено, левая сторона / Knee, left side»),
 *    the client's free text once, as typed. The «both» label templates are derived from the RU and EN templates: inside each
 *    literal piece the shared punctuation stays, only the differing words are paired.
 * Zone names and sides come from both decks regardless of the site language. Prefixes [Сайт/3D] / [Сайт/форма] never change.
 * ≤ 1000 characters: only the client's free text (zone notes, general field) is shortened; labels and zone names never are.
 * Pure function — at stage 2 it runs in the BFF (POST /api/booking/record); the gate reproduces the template's examples.
 */
import data from './comment-data.json';
import { baseOf, sideOf } from '../body3d/zones';

export type CommentLanguage = 'ru' | 'en' | 'both';
export const DEFAULT_COMMENT_LANGUAGE = data.default as CommentLanguage;

export interface CommentInput {
  /** 3d = /booking, form = «Начните с себя» on the home page, lp = the ad landing (prefixLp «[Сайт/LP]», lp-brief T-10) */
  source: '3d' | 'form' | 'lp';
  gender?: 'male' | 'female';
  age?: number;
  markers?: { zoneId: string; intensity?: number; note?: string }[];
  generalNote?: string;
  /** utm_source / utm_medium / utm_campaign first, other utm_* after them in key order */
  utm?: Record<string, string>;
}

type Pair = { ru: string; en: string };
type LabelKey = keyof typeof data.labels;
const PAIR = data.pairJoiner; // « / »
const fill = (tpl: string, v: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

/** «Пол: {gender} · Возраст: {age}» + «Gender: {gender} · Age: {age}» → «Пол / Gender: {gender} · Возраст / Age: {age}». */
function pairTemplate(ru: string, en: string): string {
  if (ru === en) return ru;
  const split = (s: string) => s.split(/(\{\w+\})/);
  const a = split(ru), b = split(en);
  if (a.length !== b.length) return `${ru}${PAIR}${en}`; // different shapes: keep both whole
  const notLetter = (c: string | undefined) => c !== undefined && !/\p{L}/u.test(c);
  return a.map((seg, i) => {
    const other = b[i];
    if (seg === other || /^\{\w+\}$/.test(seg)) return seg;
    let p = 0; while (p < seg.length && p < other.length && seg[p] === other[p] && notLetter(seg[p])) p++;
    let s = 0; while (s < seg.length - p && s < other.length - p && seg[seg.length - 1 - s] === other[other.length - 1 - s] && notLetter(seg[seg.length - 1 - s])) s++;
    return seg.slice(0, p) + seg.slice(p, seg.length - s) + PAIR + other.slice(p, other.length - s) + seg.slice(seg.length - s);
  }).join('');
}

function label(key: LabelKey, lang: CommentLanguage): string {
  const l = data.labels[key] as Pair;
  return lang === 'both' ? pairTemplate(l.ru, l.en) : l[lang];
}
const value = (p: Pair, lang: CommentLanguage) => (lang === 'both' ? (p.ru === p.en ? p.ru : `${p.ru}${PAIR}${p.en}`) : p[lang]);

/** Zone label with the side in one language: «Задняя поверхность бедра, левая сторона» / «Back of thigh, left side». */
export function zoneLabelIn(key: string, lang: 'ru' | 'en'): string {
  const Z = data.zones[lang] as Record<string, string>;
  const zone = Z[baseOf(key)] ?? Z.unknown;
  const side = sideOf(key);
  return side ? fill(side === 'l' ? Z.left : Z.right, { zone }) : zone;
}

export function formatComment(i: CommentInput, lang: CommentLanguage = DEFAULT_COMMENT_LANGUAGE): string {
  const build = (generalNote: string | undefined, notes: (string | undefined)[]) => {
    const lines: string[] = [];
    const gender = i.gender ? value(i.gender === 'female' ? data.labels.genderFemale : data.labels.genderMale, lang) : '';
    const profile = label('profile', lang).split(' · ')
      .filter((part) => (!part.includes('{gender}') || i.gender) && (!part.includes('{age}') || i.age != null))
      .map((part) => fill(part, { gender, age: i.age ?? '' }))
      .join(' · ');
    const prefix = i.source === '3d' ? data.prefixes.prefix3d : i.source === 'lp' ? data.prefixes.prefixLp : data.prefixes.prefixForm;
    lines.push([prefix, profile].filter(Boolean).join(' '));
    const markers = i.markers ?? [];
    if (markers.length) {
      const list = markers.map((m, k) => [
        fill(label('zoneItem', lang), { n: k + 1, zone: value({ ru: zoneLabelIn(m.zoneId, 'ru'), en: zoneLabelIn(m.zoneId, 'en') }, lang) }),
        m.intensity != null ? fill(label('zoneIntensity', lang), { value: m.intensity }) : null,
        notes[k] ? fill(label('zoneNote', lang), { note: notes[k]! }) : null,
      ].filter(Boolean).join(data.joiners.zoneParts)).join(data.joiners.zones);
      lines.push(fill(label('zonesLabel', lang), { list }));
    }
    if (generalNote) lines.push(fill(label('stateLabel', lang), { text: generalNote }));
    if (i.utm && Object.keys(i.utm).length) {
      const order = ['utm_source', 'utm_medium', 'utm_campaign'];
      const keys = [...order.filter((k) => i.utm![k]), ...Object.keys(i.utm).filter((k) => !order.includes(k)).sort()];
      lines.push(fill(label('utmLabel', lang), { utm: keys.map((k) => i.utm![k]).join(' / ') }));
    }
    return lines.join(data.joiners.lines);
  };

  // only the client's free text is shortened — proportionally, each keeps its beginning + «…»; labels and zone names stay whole
  let free = [i.generalNote?.trim() || undefined, ...(i.markers ?? []).map((m) => m.note?.trim() || undefined)];
  let out = build(free[0], free.slice(1));
  while (out.length > data.maxLength) {
    const total = free.reduce((n, t) => n + (t?.length ?? 0), 0);
    if (!total) return out.slice(0, data.maxLength); // nothing left to shorten (cannot happen with ≤ 10 markers)
    const ratio = Math.max(0, total - (out.length - data.maxLength) - 2 * free.filter(Boolean).length) / total; // room for «…»
    free = free.map((t) => {
      if (!t) return t;
      const n = Math.floor(t.length * ratio);
      return n >= t.length ? t : n > 0 ? `${t.slice(0, n).trimEnd()}…` : undefined;
    });
    out = build(free[0], free.slice(1));
  }
  return out;
}

export const COMMENT_EXAMPLES = data.examples as Record<CommentLanguage, string>;
