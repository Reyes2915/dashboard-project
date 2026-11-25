import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserRole } from '../models/finops.models';
import { NotificationService } from '../services/notification.service';
import { RoleService } from '../services/role.service';
import { SecurityAuditService } from '../services/security-audit.service';

/**
 * UI-side access barrier (Web A01). It improves UX only: the API enforces the same rule
 * independently, so bypassing this guard in DevTools still ends in HTTP 403.
 */
export function roleGuard(...allowed: readonly UserRole[]): CanActivateFn {
  return (_route, state) => {
    const roles = inject(RoleService);
    if (roles.hasRole(allowed)) return true;

    inject(SecurityAuditService).record('AUTHZ_DENIED', 'INFO', `Route guard blocked ${roles.role()} on ${state.url}`);
    inject(NotificationService).warning(`This area requires one of: ${allowed.join(', ')}.`);
    return inject(Router).createUrlTree(['/dashboard']);
  };
}
