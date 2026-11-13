import type { CSSProperties, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon } from './Icon';
import { Badge } from './Badge';
import { noWidow, tailEm } from '@/lib/typo';

type Href = Parameters<typeof Link>[0]['href'];
export type CardTone = 'lav' | 'sand' | 'sky';

/**
 * Service card (ui-kit «Карточка услуги»): pastel card, 4:5 photo with «Иллюстративное фото», index 01, title, short text,
 * Цена | Длительность table pinned to the bottom. The title link covers the whole card (one tab stop); hover lifts 2 px,
 * the photo never moves inside its mask (no parallax, README п.15).
 */
export function ServiceCard({ href, index, title, description, price, duration, priceLabel, durationLabel, tone = 'sand', photo, photoCaption, linkLabel, badge, titleAs: H = 'h3' }: {
  href: Href; index?: number; title: string; description?: string; price: ReactNode; duration?: ReactNode; priceLabel: string; durationLabel: string;
  tone?: CardTone; photo?: ReactNode; photoCaption?: string; linkLabel: string; badge?: ReactNode; titleAs?: 'h2' | 'h3';
}) {
  // the arrow sits in the photo's top-right corner, so the title takes the card's full width (design audit F10: «Спортивный /
  // массаж» wrapped and hung because a 44 px arrow shared the title row); without a photo it stays in the head row
  const go = <span className="go" aria-hidden="true"><Icon name="arrow-up-right" /></span>;
  // a long last pair («с инфракрасной капсулой», 250 px at 20 px) lowers the title just enough to fit the card column on
  // phones (ui.css .svc .t[data-fit]); only with a photo — without one the arrow shares the title row
  const tail = photo ? tailEm(title, 16) : undefined;
  return (
    <article className={`svc svc--${tone}`}>
      <div className="photo" data-reveal="clip">{photo}{photo ? go : null}</div>
      {photo && photoCaption ? <p className="photo-cap">{photoCaption}</p> : null}
      <div className="body">
        {/* the title link stretches over the WHOLE card (photo and arrow included, R-CODE-02 F-03): nothing between it and
            .svc is positioned; the arrow sits in the head row in normal flow and lets clicks through */}
        <div className="head">
          <div>
            {index != null ? <span className="idx">{String(index).padStart(2, '0')}</span> : null}
            <H className="t" data-fit={tail ? '' : undefined} style={tail ? ({ '--tail': tail } as CSSProperties) : undefined}><Link href={href} aria-label={`${title}. ${linkLabel}`}>{noWidow(title, 16)}</Link></H>
          </div>
          {photo ? null : go}
        </div>
        {badge}
        {description ? <p className="d">{description}</p> : null}
        <dl className="data">
          <div><dt>{priceLabel}</dt><dd>{price}</dd></div>
          {duration ? <div><dt>{durationLabel}</dt><dd>{duration}</dd></div> : null}
        </dl>
      </div>
    </article>
  );
}

/**
 * Brand mark for small specialist avatars (booking, article author): the emblem tone-on-tone (CSS mask of
 * /brand/bm-full-mono-dark.svg). It replaces the old bust of three primitives (design audit F06). No invented photos or names.
 */
export function Silhouette() {
  return <span className="sil" aria-hidden="true" />;
}

/**
 * Photo placeholder, one brand style for the whole site (lead's empty-state policy, design audit F05/F06):
 * - Bone tone with the emblem tone-on-tone;
 * - optional number in the atlas style («01» for «Специалист студии 1»);
 * - the caption («Фото … — скоро») and, where the block has no badge of its own, «Демо».
 */
export function PhotoPlaceholder({ caption, num, demo, className }: { caption: string; num?: string; demo?: string; className?: string }) {
  return (
    <div className={['ph', className].filter(Boolean).join(' ')} role="img" aria-label={caption}>
      {num ? <span className="ph__num" aria-hidden="true">{num.padStart(2, '0')}</span> : null}
      <span className="ph__cap" aria-hidden="true"><span>{caption}</span>{demo ? <span className="badge">{demo}</span> : null}</span>
    </div>
  );
}

/** «Специалист студии 3» → «3» (the placeholder's number); real names give none. */
export const staffNumber = (name: string) => name.match(/(\d+)\s*$/)?.[1];

/** Specialist card (placeholder until the client sends real photos and names). «Демо» sits under the name (F18). */
export function StaffCard({ name, note, photoCaption, href, badge }: { name: string; note?: ReactNode; photoCaption: string; href?: Href; badge?: ReactNode }) {
  return (
    <article className="staff">
      <PhotoPlaceholder caption={photoCaption} num={staffNumber(name)} />
      <b>{href ? <Link href={href}>{name}</Link> : name}</b>
      {badge}
      {note ? <span className="cap">{note}</span> : null}
    </article>
  );
}

/** Review card — placeholder with «Демо» (client has no reviews yet; block kept with placeholders, client decision). */
export function ReviewCard({ name, meta, text, demoLabel }: { name: string; meta: string; text: string; demoLabel: string }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <article className="review">
      <div className="who">
        <span className="av" aria-hidden="true">{initials}</span>
        <div><b>{name}</b><div className="cap">{meta}</div></div>
        <Badge className="ml-auto">{demoLabel}</Badge>
      </div>
      <p style={{ margin: 0 }}>{text}</p>
    </article>
  );
}
