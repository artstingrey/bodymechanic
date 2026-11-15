import type { Slot } from '@/lib/api/types';

export interface StaffTodaySlot extends Slot {
  /** Present when the provider returned this time for a specific service. */
  serviceId?: number;
}

export interface StaffTodayResponse {
  data: { times: StaffTodaySlot[] };
}
