import type { NextRequest } from 'next/server';
import { respondWithCatalog } from '@/server/catalog/route';
import { getCatalogServices } from '@/server/catalog/services';
import { getCatalogStaff } from '@/server/catalog/staff';

export function GET(request: NextRequest) {
  return respondWithCatalog(request, async (locale, staffId) => {
    if (staffId !== undefined) {
      const { data: { staff } } = await getCatalogStaff(locale);
      if (!staff.some(({ id }) => id === staffId)) return null;
    }
    return getCatalogServices(locale, { staffId });
  }, 'service', { allowStaffFilter: true });
}
