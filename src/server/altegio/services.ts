import 'server-only';

import { altegioGet } from './client';

export function fetchBookServices(locationId: number): Promise<unknown> {
  return altegioGet('book_services', `book_services/${locationId}?without_seances=1`);
}
