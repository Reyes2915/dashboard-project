import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MockApiServer } from '../mock-api/mock-api.server';

/**
 * Terminal interceptor that routes every `/api/*` call to the in-memory REST server.
 * Registered last so that auth, timeout and error handling run exactly as they would
 * against a real backend. Replace with nothing to talk to a real `/api/v1`.
 */
export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) return next(req);
  return inject(MockApiServer).handle(req);
};
