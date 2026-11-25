import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog built on the native <dialog> element:
 * - showModal() makes the rest of the page inert (native focus containment),
 * - an explicit Tab/Shift+Tab trap covers engines with partial support,
 * - Escape closes, focus moves into the dialog and is restored to the opener on close.
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
  template: `
    <dialog
      #dialog
      class="modal"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="descriptionId"
      (cancel)="onCancel($event)"
      (close)="onNativeClose()"
    >
      <header class="modal__header">
        <h2 class="modal__title" [id]="titleId">{{ heading() }}</h2>
        <button type="button" class="btn btn--ghost btn--sm" aria-label="Close dialog" (click)="dismissed.emit()">
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div class="modal__body" [id]="descriptionId">
        <ng-content />
      </div>
      <footer class="modal__actions">
        <ng-content select="[modalActions]" />
      </footer>
    </dialog>
  `,
  styles: `
    .modal {
      inline-size: min(32rem, calc(100vw - 2rem));
      padding: 0;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-2);
    }
    .modal::backdrop {
      background: var(--color-overlay);
    }
    .modal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-5) 0;
    }
    .modal__title {
      margin: 0;
      font-size: var(--text-lg);
    }
    .modal__body {
      padding: var(--space-4) var(--space-5);
      color: var(--color-text-secondary);
    }
    .modal__actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: var(--space-2);
      padding: 0 var(--space-5) var(--space-5);
    }
  `,
})
export class ModalComponent {
  private static nextId = 0;

  readonly open = input.required<boolean>();
  readonly heading = input.required<string>();
  readonly dismissed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private opener: HTMLElement | null = null;

  protected readonly titleId = `modal-title-${ModalComponent.nextId}`;
  protected readonly descriptionId = `modal-desc-${ModalComponent.nextId++}`;

  constructor() {
    effect(() => {
      const shouldOpen = this.open();
      untracked(() => (shouldOpen ? this.show() : this.hide()));
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.dismissed.emit();
  }

  /** The browser may close the dialog without a cancellable event; keep component state in sync. */
  protected onNativeClose(): void {
    if (this.open()) this.dismissed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.open()) return;
    const focusable = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private show(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // Initial focus on the first action inside the body/footer, falling back to the close button.
    const target =
      dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
  }

  private hide(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    // Restore focus even if the browser already closed the dialog natively (Chrome close watchers).
    if (this.opener?.isConnected) this.opener.focus();
    this.opener = null;
  }
}
