/**
 * Hanging last word in titles (design audit F10/F11). Modern engines balance the lines with CSS `text-wrap: balance`
 * (Safari 17.5+, Chrome 114+). For iOS 16.4–17.4 the last two words are tied with a no-break space, but only when the
 * pair is short enough to fit the narrowest column it is used in. A longer tied pair would not fit and would be split
 * mid-word by overflow-wrap, which is worse than a hanging word.
 * maxPair: card titles 16 (the arrow sits in the photo corner since F10, so the title has the card's full width: 189 px at
 * 320; 16 Cyrillic characters at 20 px ≈ 175 px), page H1 14 (≈ 288 px at 26–30 px).
 */
export function noWidow(s: string, maxPair: number): string {
  const last = s.lastIndexOf(' ');
  if (last <= 0) return s;
  const prev = s.lastIndexOf(' ', last - 1);
  const pair = s.slice(prev + 1);
  return pair.length <= maxPair ? `${s.slice(0, last)} ${s.slice(last + 1)}` : s;
}

/**
 * Estimated width, in em, of the shortest possible last line without a hanging word: the last two words, where words are
 * split at ordinary spaces only (the deck ties one-letter words with no-break spaces, so «с инфракрасной капсулой» is
 * one unit). CSS divides the column width by it and lowers the font size just enough for that unit to fit (reviewer, RC-2:
 * five-word service names hung «капсулой» on phones). Manrope 700: Cyrillic ≈ 0.54 em and Latin ≈ 0.49 em per character,
 * measured; 0.56 / 0.52 keep ≈ 4 % in reserve for other engines. If the estimate is ever short, the browser simply wraps
 * the last word again. There is no tie here, so nothing can break mid-word.
 * undefined (no change): fewer than three words, a pair short enough for noWidow, or a hyphen in the pair (it breaks there).
 */
export function tailEm(s: string, maxPair: number): number | undefined {
  const words = s.split(' ');
  if (words.length < 3) return undefined;
  const pair = words.slice(-2).join(' ');
  if (pair.length <= maxPair || /[-‐]/.test(pair)) return undefined;
  return Math.round(pair.length * (/[Ѐ-ӿ]/.test(pair) ? 0.56 : 0.52) * 100) / 100;
}

/**
 * Estimated width, in em, of the longest word of a heading — CSS lowers the H1 just enough for it to fit the column (RC-5,
 * lead: «Политика конфиденциальности» — «конфиденциальности» was cut mid-word by overflow-wrap on 320 / 360 since RC-1;
 * hyphens: auto does not help where the engine has no Russian dictionary, e.g. Chrome on Windows). Manrope 700 at the H1
 * tracking (−0.035 em): Cyrillic ≈ 0.57 em and Latin ≈ 0.47 em per character, measured; 0.6 / 0.52 keep ≈ 5 % in reserve.
 * undefined (no change) when the word fits the narrowest phone column (288 px) at the smallest H1 size (30 px).
 */
export function longWordEm(s: string): number | undefined {
  const word = s.split(/[\s ]+/).reduce((a, b) => (b.length > a.length ? b : a), '');
  const em = Math.round(word.length * (/[Ѐ-ӿ]/.test(word) ? 0.6 : 0.52) * 100) / 100;
  return em * 30 > 288 ? em : undefined;
}
