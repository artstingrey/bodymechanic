/**
 * Build-time feature flags (NEXT_PUBLIC_* → inlined into the static export; set them in Render → Environment).
 * BOOKING_SMS_REQUIRED: SMS code at step 6 of the booking. Client's decision 2026-11-06 (README-CONTEXT, HI-FI): OFF.
 */
export const BOOKING_SMS_REQUIRED = process.env.NEXT_PUBLIC_BOOKING_SMS_REQUIRED === 'true';

/** Studio WhatsApp (digits, E.164 without «+»). TODO(content): the number comes from the client → Render env. Empty → the
 * wa.me link opens WhatsApp with the prepared text and lets the visitor pick the chat (no invented number). */
export const STUDIO_WHATSAPP = (process.env.NEXT_PUBLIC_STUDIO_WHATSAPP || '').replace(/\D/g, '');
export const whatsappUrl = (text: string) => `https://wa.me/${STUDIO_WHATSAPP}?text=${encodeURIComponent(text)}`;
/** The chat without any text: the `href` of a link whose prefilled text carries the visitor's data (components/ui/PrefilledLink, В-4). */
export const WHATSAPP_BASE = `https://wa.me/${STUDIO_WHATSAPP}`;
/** Booking: demo captcha (Turnstile at stage 2, ТЗ §07). The prototype issues a mock token after a short check. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
/** Google Tag Manager container (ТЗ §14, GA4 + Meta Pixel inside). Empty in the prototype → events stay in window.dataLayer. */
export const GTM_ID = (process.env.NEXT_PUBLIC_GTM_ID || '').trim();
/**
 * Studio facts for JSON-LD (HealthAndBeautyBusiness, ТЗ §14). TODO(content): street address, phone and opening hours come from
 * the client (deck: contacts.value.* are TODO) — empty values are simply not emitted, nothing is invented. Known from the
 * brief: the studio is in Dubai, UAE; prices are in AED.
 */
export const STUDIO = {
  locality: 'Dubai',
  country: 'AE',
  currency: 'AED',
  streetAddress: process.env.NEXT_PUBLIC_STUDIO_ADDRESS || '', // TODO(content)
  telephone: process.env.NEXT_PUBLIC_STUDIO_PHONE || '', // TODO(content), E.164
  /** schema.org openingHours, e.g. "Mo-Sa 09:00-21:00". TODO(content) */
  openingHours: (process.env.NEXT_PUBLIC_STUDIO_HOURS || '').split(';').map((s) => s.trim()).filter(Boolean),
};
