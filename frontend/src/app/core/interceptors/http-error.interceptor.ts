import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { TimeoutError, catchError, throwError } from 'rxjs';
import { AUTH_OVERRIDE, SILENT_ERRORS } from '../api/http-context';
import { ApiError, isApiError, problem } from '../api/problem';
import { ProblemDetail } from '../models/finops.models';
import { isProblemDetail } from '../security/payload-guards';
import { NotificationService } from '../services/notification.service';
import { RoleService } from '../services/role.service';
import { SecurityAuditService } from '../services/security-audit.service';

/**
 * Fail-closed error boundary for HTTP (Web A10 / API8). Every failure is normalised into a
 * sanitised RFC 7807 ProblemDetail; raw server payloads and stack traces never reach the UI.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  const roleService = inject(RoleService);
  const audit = inject(SecurityAuditService);

  return next(req).pipe(
    catchError((error: unknown) => {
      const detail = toProblemDetail(error, req);

      if (error instanceof TimeoutError) {
        audit.record('CRITICAL_ERROR', 'WARNING', `Request timed out: ${req.method} ${req.url}`);
      }

      if (detail.status === 401 && usesSessionCredentials(req) && !isAuthEndpoint(req)) {
        roleService.resetSession(detail.detail);
      } else if (!req.context.get(SILENT_ERRORS)) {
        notifyUser(notifications, detail);
      }
      return throwError(() => new ApiError(detail));
    }),
  );
};

export function toProblemDetail(error: unknown, req: HttpRequest<unknown>): ProblemDetail {
  if (isApiError(error)) return error.problem;
  if (error instanceof TimeoutError) {
    return problem(504, 'timeout', 'The request took too long. Please try again.', { instance: req.url });
  }
  if (error instanceof HttpErrorResponse) {
    if (isProblemDetail(error.error)) return error.error;
    if (error.status === 0) return problem(503, 'network', 'The service is unreachable. Check your connection.');
    return problem(error.status >= 400 ? error.status : 500, 'unexpected', 'The request could not be completed.');
  }
  return problem(500, 'unexpected', 'An unexpected error occurred.');
}

function notifyUser(notifications: NotificationService, detail: ProblemDetail): void {
  switch (detail.status) {
    case 401:
      notifications.warning('Authentication required.');
      break;
    case 403:
      notifications.error('Access denied: your role is not allowed to perform this action.');
      break;
    case 404:
      notifications.warning('The requested resource was not found.');
      break;
    case 429:
      notifications.warning('Too many requests. Please wait a few seconds and retry.');
      break;
    default:
      if (detail.status >= 500) notifications.error(`${detail.title}. ${detail.detail}`);
      else notifications.warning(detail.detail);
  }
}

/** Only a rejection of the user's own session triggers a reset; Security Lab probes use overrides. */
function usesSessionCredentials(req: HttpRequest<unknown>): boolean {
  return req.context.get(AUTH_OVERRIDE) === null;
}

function isAuthEndpoint(req: HttpRequest<unknown>): boolean {
  return req.url.includes('/auth/session');
}
