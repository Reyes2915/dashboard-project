import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';
import { FinopsApiService } from '../api/finops-api.service';
import { SessionInfo, UserRole } from '../models/finops.models';
import { NotificationService } from './notification.service';
import { SecurityAuditService } from './security-audit.service';

/**
 * Holds the simulated authenticated session. The bearer token lives in memory only:
 * it is never written to localStorage/sessionStorage (Web A04) and dies with the tab.
 */
@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly api = inject(FinopsApiService);
  private readonly audit = inject(SecurityAuditService);
  private readonly notifications = inject(NotificationService);

  private readonly _session = signal<SessionInfo | null>(null);
  private readonly _switching = signal(false);

  readonly session = this._session.asReadonly();
  readonly switching = this._switching.asReadonly();
  /** Least privilege by default: no session means VIEWER capabilities in the UI. */
  readonly role = computed<UserRole>(() => this._session()?.role ?? 'VIEWER');
  readonly isAdmin = computed(() => this.role() === 'ADMIN');
  readonly displayName = computed(() => this._session()?.displayName ?? 'Signing in…');

  hasRole(allowed: UserRole | readonly UserRole[]): boolean {
    const roles: readonly UserRole[] = typeof allowed === 'string' ? [allowed] : allowed;
    return this._session() !== null && roles.includes(this.role());
  }

  startSession(role: UserRole): Observable<SessionInfo | null> {
    this._switching.set(true);
    const previous = this._session();
    return this.api.issueSession(role).pipe(
      tap((session) => {
        this._session.set(session);
        this._switching.set(false);
        // Rotate: the previous token is revoked server-side so it cannot be replayed.
        if (previous !== null) {
          this.api.revokeSession({ token: previous.token, role: previous.role }).subscribe({ error: () => undefined });
        }
      }),
      catchError(() => {
        this._switching.set(false);
        return of(null);
      }),
    );
  }

  switchRole(role: UserRole): void {
    if (role === this.role() && this._session() !== null) return;
    this.startSession(role).subscribe((session) => {
      if (session !== null) this.notifications.info(`Signed in as ${session.displayName}.`);
    });
  }

  /** Secure session reset after a 401: drop credentials and fall back to a least-privilege session. */
  resetSession(reason: string): void {
    this.audit.record('SESSION_RESET', 'WARNING', `Session reset: ${reason}`);
    // Coalesce bursts of 401s into a single re-authentication.
    if (this._switching()) return;
    this._session.set(null);
    this.notifications.warning('Your session is no longer valid. A new read-only session was started.');
    this.startSession('VIEWER').subscribe();
  }
}
