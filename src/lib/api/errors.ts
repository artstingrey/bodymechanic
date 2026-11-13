/** Typed failures of the BFF (ТЗ §08). UI maps `kind` to booking.error.* / account.* messages and offers «Повторить». */
export type ApiErrorKind = 'network' | 'server' | 'tooLate' | 'rateLimit' | 'captcha';
export class ApiError extends Error {
  constructor(public kind: ApiErrorKind) { super(kind); this.name = 'ApiError'; }
}
export const errorKind = (e: unknown): ApiErrorKind => (e instanceof ApiError ? e.kind : 'network');
