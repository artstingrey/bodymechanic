/**
 * Build-time feature flags (NEXT_PUBLIC_* → inlined into the static export; set them in Render → Environment).
 * BOOKING_SMS_REQUIRED: SMS code at step 6 of the booking. Client's decision 2026-11-06 (README-CONTEXT, HI-FI): OFF.
 */
export const BOOKING_SMS_REQUIRED = process.env.NEXT_PUBLIC_BOOKING_SMS_REQUIRED === 'true';

export const WHATSAPP_NUMBER = '+971 58 517 23 80';
/** The chat without any text: the `href` of a link whose prefilled text carries the visitor's data (components/ui/PrefilledLink, В-4). */
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, '')}`;
export const whatsappUrl = (text: string) => text ? `${WHATSAPP_URL}?text=${encodeURIComponent(text)}` : WHATSAPP_URL;
export const INSTAGRAM_URL = 'https://www.instagram.com/mechanic.body.uae/';
/** Booking: demo captcha (Turnstile at stage 2, ТЗ §07). The prototype issues a mock token after a short check. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
/** Google Tag Manager container (ТЗ §14, GA4 + Meta Pixel inside). Empty in the prototype → events stay in window.dataLayer. */
export const GTM_ID = (process.env.NEXT_PUBLIC_GTM_ID || '').trim();
/**
 * Studio facts shared by the site, booking and JSON-LD.
 */
export const STUDIO = {
  locality: 'Dubai',
  country: 'AE',
  currency: 'AED',
  streetAddress: process.env.NEXT_PUBLIC_STUDIO_ADDRESS?.trim() ||
    'Dubai, Al Thanyah Fifth, Jumeirah Lakes Towers, HDS Tower Cluster F, 16 floor, 1606',
  telephone: process.env.NEXT_PUBLIC_STUDIO_PHONE || '', // TODO(content), E.164
  /** schema.org openingHours, e.g. "Mo-Sa 09:00-21:00". TODO(content) */
  openingHours: (process.env.NEXT_PUBLIC_STUDIO_HOURS || '').split(';').map((s) => s.trim()).filter(Boolean),
};

// Both map URLs point to the HDS Tower pin. Update them if the studio moves.
export const STUDIO_MAP = {
  url: 'https://www.google.com/maps?cid=7020879899118915970',
  embedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3613.872727873327!2d55.142340499999996!3d25.0723025!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3e5f6cac1b6ef3a9%3A0x616f2d11eda9d182!2sHDS%20Tower!5e0!3m2!1sru!2sua!4v1794770429600!5m2!1sru!2sua',
};
