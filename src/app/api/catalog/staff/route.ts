import type { NextRequest } from 'next/server';
import { respondWithCatalog } from '@/server/catalog/route';
import { getCatalogStaff } from '@/server/catalog/staff';

export function GET(request: NextRequest) {
  return respondWithCatalog(request, getCatalogStaff, 'staff');
}
