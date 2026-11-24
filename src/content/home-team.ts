import type { BookingStaff } from '@/lib/contracts/booking-services';

export type StaffTranslations = Readonly<Record<string, { name: string; description?: string } | undefined>>;

export function withLocalizedStaffName<T extends BookingStaff>(staff: T, translations: StaffTranslations): T {
  const name = translations[staff.id]?.name.trim();
  return name && name !== staff.name ? { ...staff, name } : staff;
}
