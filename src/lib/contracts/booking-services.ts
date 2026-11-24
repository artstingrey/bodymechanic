import type { CatalogStaffMember } from './catalog';

export type BookingServiceSelection =
  | { serviceId: number; serviceIds?: undefined }
  | { serviceId?: number; serviceIds: number[] };

export type BookingServiceReference =
  | { serviceId: number; serviceIds?: never }
  | { serviceIds: number[]; serviceId?: never };

export type BookingStaff = Pick<CatalogStaffMember, 'id' | 'name'>;

export type BookingTime = {
  datetime: string;
  time: string;
  durationSeconds?: number;
};

export type BookingStaffData = BookingServiceReference & { staff: BookingStaff[] };
export type BookingDatesData = BookingServiceReference & { staffId: number; dates: string[] };
export type BookingTimesData = BookingServiceReference & { staffId: number; date: string; times: BookingTime[] };

export function validBookingId(value: unknown, minimum = 1): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

export function normalizeBookingServices(serviceId: unknown, serviceIds: unknown): number[] | null {
  if (serviceIds === undefined) return validBookingId(serviceId) ? [serviceId] : null;
  if (!Array.isArray(serviceIds) || serviceIds.length === 0 ||
    !serviceIds.every((id: unknown) => validBookingId(id))) return null;
  const ids = [...new Set<number>(serviceIds)].sort((a, b) => a - b);
  if (serviceId !== undefined && (ids.length !== 1 || ids[0] !== serviceId)) return null;
  return ids;
}

export function equalBookingServices(a: readonly number[], b: unknown): b is number[] {
  return Array.isArray(b) && a.length === b.length && a.every((id, index) => id === b[index]);
}

export function updateBookingServices(ids: readonly number[], id: number, checked: boolean) {
  return checked ? [...new Set([...ids, id])].sort((a, b) => a - b) : ids.filter((value) => value !== id);
}
