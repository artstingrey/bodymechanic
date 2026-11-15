import 'server-only';

const failures = {
  unavailable: { status: 503, code: 'CATALOG_UNAVAILABLE', message: 'The service catalog is temporarily unavailable.' },
  rateLimited: { status: 503, code: 'UPSTREAM_RATE_LIMITED', message: 'The service catalog is temporarily rate limited.' },
  timeout: { status: 504, code: 'UPSTREAM_TIMEOUT', message: 'The service catalog request timed out.' },
  invalidResponse: { status: 502, code: 'UPSTREAM_INVALID_RESPONSE', message: 'The service catalog provider returned an invalid response.' },
} as const;

export class AltegioError extends Error {
  readonly response: (typeof failures)[keyof typeof failures];

  constructor(
    kind: keyof typeof failures,
    readonly retryAfter?: string,
    readonly upstreamRetryAfter?: string,
  ) {
    super(failures[kind].message);
    this.name = 'AltegioError';
    this.response = failures[kind];
  }
}
