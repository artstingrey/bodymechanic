import type { BookingStaff } from '@/lib/contracts/booking-services';

export type StaffNameTranslations = Readonly<Record<string, { name: string } | undefined>>;

export function withLocalizedStaffName<T extends BookingStaff>(staff: T, translations: StaffNameTranslations): T {
  const name = translations[staff.id]?.name.trim();
  return name && name !== staff.name ? { ...staff, name } : staff;
}
