import type { NextRequest } from 'next/server';
import { respondWithStaffToday } from '@/server/booking/route';

export function GET(request: NextRequest) {
  return respondWithStaffToday(request);
}
