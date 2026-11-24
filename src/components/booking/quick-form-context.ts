'use client';

import { createContext } from 'react';
import type { ErrorCode } from '@/lib/forms/validate';

export type AvailabilityConflict = 'SLOT_TAKEN' | 'STAFF_NOT_FOUND' | 'SERVICE_NOT_FOUND';

export const QuickFormContext = createContext<{
  locked: boolean;
  errors: Record<string, ErrorCode>;
  clearError: (id: string) => void;
  setAvailabilityBlocked: (blocked: boolean) => void;
  registerRefresh: (handler: (reason: AvailabilityConflict) => void) => () => void;
} | null>(null);
