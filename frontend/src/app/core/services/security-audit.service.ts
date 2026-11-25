import { Injectable, computed, signal } from '@angular/core';
import { SecurityAuditEvent, SecurityEventSource, SecurityEventType, SecuritySeverity } from '../models/finops.models';
import { maskSensitive } from '../security/pii-masking';

const MAX_EVENTS = 200;

/**
 * In-memory security event log (Web A09). Bounded ring buffer so a flood of blocked
 * requests cannot exhaust memory. Every message is PII-masked before storage.
 */
@Injectable({ providedIn: 'root' })
export class SecurityAuditService {
  private readonly _events = signal<readonly SecurityAuditEvent[]>([]);

  readonly events = this._events.asReadonly();
  readonly criticalCount = computed(() => this._events().filter((e) => e.severity === 'CRITICAL').length);
  readonly unseenCount = signal(0);

  record(
    type: SecurityEventType,
    severity: SecuritySeverity,
    message: string,
    source: SecurityEventSource = 'CLIENT',
  ): SecurityAuditEvent {
    const event: SecurityAuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      severity,
      source,
      message: maskSensitive(message),
    };
    this._events.update((events) => [event, ...events].slice(0, MAX_EVENTS));
    this.unseenCount.update((n) => n + 1);
    return event;
  }

  markSeen(): void {
    this.unseenCount.set(0);
  }

  clear(): void {
    this._events.set([]);
    this.unseenCount.set(0);
  }
}
