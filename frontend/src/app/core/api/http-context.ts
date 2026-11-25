import { HttpContextToken } from '@angular/common/http';
import { UserRole } from '../models/finops.models';

export interface AuthOverride {
  readonly token: string | null;
  readonly role: UserRole | null;
}

/** Replaces the session credentials for one request (used by the Security Lab and session rotation). */
export const AUTH_OVERRIDE = new HttpContextToken<AuthOverride | null>(() => null);

/** Caller-provided idempotency key so retries of the same business action reuse it (API6). */
export const IDEMPOTENCY_KEY = new HttpContextToken<string | null>(() => null);

/** Lets the Security Lab send a mutation without an idempotency key to prove the server rejects it. */
export const OMIT_IDEMPOTENCY_KEY = new HttpContextToken<boolean>(() => false);

/** Suppresses user-facing toasts; the caller renders the error itself. Audit logging still happens. */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);
