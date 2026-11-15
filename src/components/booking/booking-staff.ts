import { ApiError } from '@/lib/api/errors';
import type { CatalogLocale, CatalogStaffMember } from '@/lib/contracts/catalog';

type BookingStaff = Pick<CatalogStaffMember, 'id' | 'name'>;

export async function getBookingStaff(locale: CatalogLocale, serviceId: number, signal: AbortSignal): Promise<BookingStaff[]> {
  const response = await fetch(`/api/booking/staff?serviceId=${serviceId}&locale=${locale}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status === 429 ? 'rateLimit' : 'server');
  const result = await response.json() as { data?: { serviceId: number; staff: BookingStaff[] } };
  if (result?.data?.serviceId !== serviceId || !Array.isArray(result.data.staff)) throw new ApiError('server');
  return result.data.staff;
}
