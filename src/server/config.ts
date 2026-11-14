import 'server-only';

import { AltegioError } from './altegio/errors';

export function getAltegioConfig() {
  const location = process.env.ALTEGIO_LOCATION_ID?.trim() ?? '';
  const locationId = Number(location);
  const partnerToken = process.env.ALTEGIO_PARTNER_TOKEN?.trim() ?? '';
  const currency = process.env.ALTEGIO_CURRENCY?.trim() || null;

  if (!/^\d+$/.test(location) || !Number.isSafeInteger(locationId) || locationId <= 0 ||
    !/^[A-Za-z0-9._~+/-]+=*$/.test(partnerToken) || (currency && !/^[A-Z]{3}$/.test(currency))) {
    throw new AltegioError('unavailable');
  }

  return { locationId, partnerToken, currency };
}
