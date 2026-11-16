import { isPossiblePhoneNumber } from 'libphonenumber-js/min';
import { normalizePhone, rules, type ErrorCode } from '@/lib/forms/validate';

export function landingPhoneError(value: string): ErrorCode | null {
  const error = rules.phone(value);
  if (error) return error;
  return isPossiblePhoneNumber(normalizePhone(value)) ? null : 'phoneInvalid';
}
