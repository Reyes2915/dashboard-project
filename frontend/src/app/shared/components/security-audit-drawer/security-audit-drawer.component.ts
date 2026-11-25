import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { SecuritySeverity } from '../../../core/models/finops.models';
import { SecurityAuditService } from '../../../core/services/security-audit.service';
import { controlValue } from '../../utils/dom-events';

type SeverityFilter = SecuritySeverity | 'ALL';

/**
 * Collapsible, non-modal side panel showing security events in real time (Web A09).
 * Opened by a disclosure button (aria-expanded/aria-controls); Escape closes and returns focus.
 */
@Component({
  selector: 'app-security-audit-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  host: { '(keydown.escape)': 'open() && closed.emit()' },
  template: `
    <aside
      [id]="panelId()"
      class="drawer"
      [class.drawer--open]="open()"
      [attr.aria-hidden]="!open()"
      [attr.inert]="open() ? null : ''"
      aria-labelledby="audit-drawer-title"
    >
      <header class="drawer__header">
        <h2 id="audit-drawer-title" #heading tabindex="-1">Security audit log</h2>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          aria-label="Close security audit log"
          (click)="closed.emit()"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      <div class="drawer__toolbar">
        <label class="field">
          <span class="field__label">Severity</span>
          <select class="select" [value]="filter()" (change)="setFilter($event)">
            <option value="ALL">All ({{ audit.events().length }})</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </select>
        </label>
        <button type="button" class="btn btn--sm" [disabled]="audit.events().length === 0" (click)="audit.clear()">
          Clear log
        </button>
      </div>

      <p class="visually-hidden" aria-live="polite">{{ latestAnnouncement() }}</p>

      @if (visibleEvents().length === 0) {
        <p class="drawer__empty">No security events recorded. Try the Security Lab to trigger OWASP defences.</p>
      } @else {
        <ol class="events" aria-label="Security events, newest first">
          @for (event of visibleEvents(); track event.id) {
            <li class="event" [attr.data-severity]="event.severity">
              <div class="event__meta">
                <span class="event__severity">{{ event.severity }}</span>
                <span class="event__type mono">{{ event.type }}</span>
                <time [attr.datetime]="event.timestamp">{{ event.timestamp | date: 'HH:mm:ss' }}</time>
              </div>
              <p class="event__message">{{ event.message }}</p>
              <p class="event__source">Source: {{ event.source === 'API_GATEWAY' ? 'API gateway' : 'Client' }}</p>
            </li>
          }
        </ol>
      }
    </aside>
  `,
  styles: `
    .drawer {
      position: fixed;
      inset-block: 0;
      inset-inline-end: 0;
      z-index: 800;
      inline-size: var(--drawer-width);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      background: var(--color-surface);
      border-inline-start: 1px solid var(--color-border);
      box-shadow: var(--shadow-2);
      overflow-y: auto;
      transform: translateX(100%);
      visibility: hidden;
      /* Hide only after the slide-out finishes; become visible (and focusable) immediately on open. */
      transition:
        transform var(--duration-base) ease,
        visibility 0s linear var(--duration-base);
    }
    .drawer--open {
      transform: none;
      visibility: visible;
      transition: transform var(--duration-base) ease;
    }
    .drawer__header,
    .drawer__toolbar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .drawer__header h2 {
      margin: 0;
    }
    .drawer__empty {
      color: var(--color-text-muted);
    }
    .events {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .event {
      padding: var(--space-3);
      border: 1px solid var(--color-border);
      border-inline-start: 4px solid var(--color-info);
      border-radius: var(--radius-md);
    }
    .event[data-severity='WARNING'] {
      border-inline-start-color: var(--color-warning);
    }
    .event[data-severity='CRITICAL'] {
      border-inline-start-color: var(--color-danger);
    }
    .event__meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      font-size: var(--text-xs);
      color: var(--color-text-secondary);
    }
    .event__severity {
      font-weight: 700;
    }
    .event__message {
      margin: var(--space-1) 0 0;
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
    .event__source {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }
  `,
})
export class SecurityAuditDrawerComponent {
  protected readonly audit = inject(SecurityAuditService);
  private readonly injector = inject(Injector);

  readonly open = input.required<boolean>();
  readonly panelId = input('security-audit-drawer');
  readonly closed = output<void>();

  protected readonly filter = signal<SeverityFilter>('ALL');
  protected readonly visibleEvents = computed(() => {
    const filter = this.filter();
    const events = this.audit.events();
    return filter === 'ALL' ? events : events.filter((e) => e.severity === filter);
  });
  protected readonly latestAnnouncement = computed(() => {
    const latest = this.audit.events()[0];
    return this.open() && latest !== undefined ? `New ${latest.severity.toLowerCase()} event: ${latest.type}` : '';
  });

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.audit.markSeen();
          // Focus only after the render that removes `inert`, otherwise the heading is not focusable.
          afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
        });
      }
    });
  }

  protected setFilter(event: Event): void {
    const value = controlValue(event);
    this.filter.set(value === 'CRITICAL' || value === 'WARNING' || value === 'INFO' ? value : 'ALL');
  }
}
