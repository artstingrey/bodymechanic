import config from './config.json';

export const LANDING_BOOKING_STAFF = 0;
export const landingBookingChips = new Map(Object.values(config.versions).flatMap(({ chips }) => chips.map(({ id, key }) => [id, key] as const)));
