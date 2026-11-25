import { ProblemDetail } from '../models/finops.models';

const PROBLEM_BASE = 'https://errors.finops.example.com/';

const DEFAULT_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** Builds an RFC 7807 ProblemDetail. Never include stack traces or internals in `detail`. */
export function problem(
  status: number,
  slug: string,
  detail: string,
  extras: Pick<ProblemDetail, 'instance' | 'errors'> = {},
): ProblemDetail {
  return {
    type: `${PROBLEM_BASE}${slug}`,
    title: DEFAULT_TITLES[status] ?? 'Error',
    status,
    detail,
    ...extras,
  };
}

/** Error type rethrown by the HTTP layer: consumers only ever see a sanitised ProblemDetail. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetail) {
    super(`${problem.status} ${problem.title}`);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
