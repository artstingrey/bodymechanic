import config from './config.json';

export const LANDING_BOOKING_STAFF = 0;
export const landingBookingChips = new Map(config.versions.a.chips.map(({ id, key }) => [id, key]));
