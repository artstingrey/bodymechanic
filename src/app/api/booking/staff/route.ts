import type { NextRequest } from 'next/server';
import { respondWithBooking } from '@/server/booking/route';

export function GET(request: NextRequest) {
  return respondWithBooking(request, 'staff');
}
