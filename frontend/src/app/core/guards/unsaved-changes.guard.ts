import { CanDeactivateFn } from '@angular/router';

/** Contract for routed components that hold user input (Web A06 Insecure Design). */
export interface PendingChangesAware {
  hasPendingChanges(): boolean;
  /** Opens an accessible confirmation and resolves with the user's decision. */
  confirmDiscard(): Promise<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<PendingChangesAware> = (component) =>
  component.hasPendingChanges() ? component.confirmDiscard() : true;
