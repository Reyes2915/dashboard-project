import { ErrorHandler, Injectable, inject, isDevMode } from '@angular/core';
import { isApiError } from '../api/problem';
import { NotificationService } from '../services/notification.service';
import { SecurityAuditService } from '../services/security-audit.service';

/**
 * Last line of defence for uncaught runtime errors (Web A10).
 * Fail closed: the user gets a generic message with a correlation reference;
 * stack traces are never rendered and only reach the console in development builds.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly notifications = inject(NotificationService);
  private readonly audit = inject(SecurityAuditService);

  handleError(error: unknown): void {
    // HTTP errors were already normalised and surfaced by the HTTP error interceptor.
    if (isApiError(error)) return;

    const name = error instanceof Error ? error.name : typeof error;
    const event = this.audit.record('CRITICAL_ERROR', 'CRITICAL', `Unhandled ${name}`);
    this.notifications.error(`Something went wrong. Reference: ${event.id.slice(0, 8)}.`);

    if (isDevMode()) console.error(error);
  }
}
