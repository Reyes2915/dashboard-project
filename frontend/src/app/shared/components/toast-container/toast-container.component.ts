import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService, ToastKind } from '../../../core/services/notification.service';

const ICONS: Readonly<Record<ToastKind, string>> = { success: '✓', info: 'ℹ', warning: '!', error: '✕' };
const LABELS: Readonly<Record<ToastKind, string>> = {
  success: 'Success',
  info: 'Information',
  warning: 'Warning',
  error: 'Error',
};

/** Polite live region: messages are announced without interrupting the user. */
@Component({
  selector: 'app-toast-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="toasts" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
      @for (toast of notifications.toasts(); track toast.id) {
        <div class="toast" [attr.data-kind]="toast.kind">
          <span class="toast__icon" aria-hidden="true">{{ icons[toast.kind] }}</span>
          <p class="toast__message">
            <span class="visually-hidden">{{ labels[toast.kind] }}: </span>{{ toast.message }}
          </p>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            aria-label="Dismiss notification"
            (click)="notifications.dismiss(toast.id)"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    .toasts {
      position: fixed;
      inset-block-end: var(--space-4);
      inset-inline-end: var(--space-4);
      z-index: 900;
      display: grid;
      gap: var(--space-2);
      inline-size: min(24rem, calc(100vw - 2rem));
    }
    .toast {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-inline-start: 4px solid var(--color-info);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-2);
    }
    .toast[data-kind='success'] {
      border-inline-start-color: var(--color-success);
    }
    .toast[data-kind='warning'] {
      border-inline-start-color: var(--color-warning);
    }
    .toast[data-kind='error'] {
      border-inline-start-color: var(--color-danger);
    }
    .toast__icon {
      font-weight: 700;
    }
    .toast__message {
      margin: 0;
      font-size: var(--text-sm);
    }
  `,
})
export class ToastContainerComponent {
  protected readonly notifications = inject(NotificationService);
  protected readonly icons = ICONS;
  protected readonly labels = LABELS;
}
