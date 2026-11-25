import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly message: string;
}

const MAX_TOASTS = 4;
const DEFAULT_TTL_MS = 6000;

/** Toast queue. Bounded so repeated failures cannot flood the live region. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly _toasts = signal<readonly Toast[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly toasts = this._toasts.asReadonly();

  show(kind: ToastKind, message: string, ttlMs = DEFAULT_TTL_MS): string {
    const toast: Toast = { id: crypto.randomUUID(), kind, message };
    this._toasts.update((list) => {
      const next = [...list, toast];
      const overflow = next.slice(0, Math.max(0, next.length - MAX_TOASTS));
      overflow.forEach((t) => this.clearTimer(t.id));
      return next.slice(-MAX_TOASTS);
    });
    if (ttlMs > 0)
      this.timers.set(
        toast.id,
        setTimeout(() => this.dismiss(toast.id), ttlMs),
      );
    return toast.id;
  }

  success(message: string): string {
    return this.show('success', message);
  }

  info(message: string): string {
    return this.show('info', message);
  }

  warning(message: string): string {
    return this.show('warning', message);
  }

  error(message: string): string {
    return this.show('error', message, 9000);
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }
}
