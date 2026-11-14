export type CatalogLocale = 'ru' | 'en';

export interface CatalogCategory {
  id: number;
  title: string;
}

export interface CatalogService extends CatalogCategory {
  description: string | null;
  categoryId: number | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  durationMin: number | null;
  imageUrl: string | null;
}

export interface CatalogServicesResponse {
  data: { services: CatalogService[]; categories: CatalogCategory[] };
  meta: { source: 'altegio'; locale: CatalogLocale };
}

export type CatalogErrorCode =
  | 'INVALID_QUERY'
  | 'CATALOG_UNAVAILABLE'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'INTERNAL_ERROR';

export interface CatalogErrorResponse {
  error: { code: CatalogErrorCode; message: string };
}
