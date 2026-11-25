import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { timeout } from 'rxjs';
import { AUTH_OVERRIDE, IDEMPOTENCY_KEY, OMIT_IDEMPOTENCY_KEY } from '../api/http-context';
import { RoleService } from '../services/role.service';

export const REQUEST_TIMEOUT_MS = 8000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Attaches session credentials and anti-replay headers to same-origin API calls only,
 * and bounds every request in time (API2, API6, API10).
 */
export const authSecurityInterceptor: HttpInterceptorFn = (req, next) => {
  // Never leak credentials to third-party origins.
  if (!req.url.startsWith('/api/')) return next(req);

  const session = inject(RoleService).session();
  const override = req.context.get(AUTH_OVERRIDE);
  const token = override !== null ? override.token : (session?.token ?? null);
  const role = override !== null ? override.role : (session?.role ?? null);

  let headers = req.headers.set('Accept', 'application/json');
  if (token !== null) headers = headers.set('Authorization', `Bearer ${token}`);
  if (role !== null) headers = headers.set('X-User-Role', role);

  // Make the content type explicit so the server can enforce it (API8).
  const contentType = req.detectContentTypeHeader();
  if (req.body !== null && !headers.has('Content-Type') && contentType !== null) {
    headers = headers.set('Content-Type', contentType);
  }

  if (MUTATING_METHODS.has(req.method) && !req.context.get(OMIT_IDEMPOTENCY_KEY) && !headers.has('X-Idempotency-Key')) {
    headers = headers.set('X-Idempotency-Key', req.context.get(IDEMPOTENCY_KEY) ?? crypto.randomUUID());
  }

  return next(req.clone({ headers, withCredentials: false })).pipe(timeout(REQUEST_TIMEOUT_MS));
};
