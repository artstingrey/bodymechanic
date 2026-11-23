import { preload } from 'react-dom';
import assets from '@/lib/body3d/assets.json';
import { pageLocale } from '@/lib/locale';
import { pageMetadata } from '@/lib/seo';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { ABSORB_PRESET_INLINE } from '@/lib/booking/preset';
import '@/styles/booking.css';
import { ScopeMessages } from '@/components/i18n/ScopeMessages';
import { pickMessages } from '@/lib/i18n/pickMessages';

export async function generateMetadata() {
  return pageMetadata(await pageLocale(), 'booking', '/booking');
}

/**
 * Deep links (?step=2–7, e.g. the specialist's «nearest windows» → ?step=2): the static HTML is step 1, so hide
 * the flow until it has hydrated and switched to the linked step (BookingFlow sets data-ready) — step 1 never flashes.
 * The rule goes to <head> (React tolerates extra nodes there); it only matches a flow that is not ready yet.
 * Before it, in the same script: a link from outside may carry a choice (?service, ?staff, ?date, ?time) — it is moved out
 * of the address while the HTML is parsed, before the router and any tag read the address (lib/booking/preset, Ж-9).
 */
const DEEP_LINK_GUARD = "if(/[?&]step=[2-7]/.test(location.search)){var s=document.createElement('style');s.textContent='.booking:not([data-ready]){visibility:hidden}';document.head.appendChild(s)}";

/**
 * /booking — full-screen 3D mode + steps (ТЗ §04, §06, §07). R-FINAL perf (option A): step 1 is prerendered — the static
 * HTML is the real step 1, its model poster is the LCP and stays the same element through hydration; the step and the
 * stored choices are applied after hydration (useBookingFlow).
 */
export default async function BookingPage() {
  // the default (male) poster from the head, high priority: it is the LCP element of step 1
  preload(assets.posters.male.avif, { as: 'image', type: 'image/avif', fetchPriority: 'high' });
  return (
    <ScopeMessages messages={await pickMessages([
      'body3d', 'home.hero', 'booking', 'forms', 'contraindications', 'mock',
      'home.services.cards', 'home.services.priceUnknown', 'home.services.priceFrom', 'home.services.duration',
      'home.form.feedback', 'account.sampleRecords',
    ])}>
    <div className="container bk-page">
      <script dangerouslySetInnerHTML={{ __html: ABSORB_PRESET_INLINE + DEEP_LINK_GUARD }} />
      <BookingFlow />
    </div>
    </ScopeMessages>
  );
}
