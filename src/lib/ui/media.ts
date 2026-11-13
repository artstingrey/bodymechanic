/**
 * Shared media queries (JS side; booking.css spells out the same pairs — CSS has no custom media yet).
 *
 * SHEET_MQ — phones with the bottom-sheet layout of booking step 1 («Запись» as a sheet over the model, the fixed CTA bar):
 * under 768 px wide, except short landscape windows. LAND_PHONE_MQ — those short landscape phones (≤ 480 px high: iPhone SE
 * 667×375 → 667×325 visible, Android 740×360): they get the two-column layout of the landscape phones ≥ 768 (booking.css
 * F25: model | «Запись» + actions) — RC-3 (lead; the RC-2 phone layout gave them a 120–180 px canvas).
 */
export const SHEET_MQ = '(max-width: 767px) and (orientation: portrait), (max-width: 767px) and (min-height: 481px)';
export const LAND_PHONE_MQ = '(max-width: 767px) and (orientation: landscape) and (max-height: 480px)';

/** true while the step-1 «Запись» panel is a bottom sheet (client only) */
export const isSheetLayout = () => typeof window !== 'undefined' && window.matchMedia(SHEET_MQ).matches;
