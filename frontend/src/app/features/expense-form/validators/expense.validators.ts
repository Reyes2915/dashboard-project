import { AbstractControl, AsyncValidatorFn, ValidationErrors, ValidatorFn } from '@angular/forms';
import { Observable, catchError, map, of, switchMap, take, timer } from 'rxjs';
import { FinopsApiService } from '../../../core/api/finops-api.service';
import { INVOICE_CODE_PATTERN, isSafeText, isValidIsoDate } from '../../../core/security/text-policy';
import { checkUrlPolicy } from '../../../core/security/url-policy';

/**
 * API7 SSRF (client barrier): optional receipt URL must be https:// to a public host.
 * Blocks localhost, private/link-local/metadata IPs, credentials in URLs and file:/javascript: schemes.
 * The API re-applies the same policy server-side.
 */
export const safeHttpsUrlValidator: ValidatorFn = (
  control: AbstractControl<string | null>,
): ValidationErrors | null => {
  const value = control.value ?? '';
  if (value.trim() === '') return null;
  const violation = checkUrlPolicy(value);
  return violation === null ? null : { unsafeUrl: { reason: violation } };
};

/** Web A05: allow-list of characters for free text. */
export const safeTextValidator: ValidatorFn = (control: AbstractControl<string | null>): ValidationErrors | null => {
  const value = control.value ?? '';
  return value === '' || isSafeText(value) ? null : { unsafeText: true };
};

export const invoiceCodeFormatValidator: ValidatorFn = (control: AbstractControl<string | null>) =>
  control.value === null || control.value === '' || INVOICE_CODE_PATTERN.test(control.value)
    ? null
    : { invoiceFormat: true };

export function notInFutureDateValidator(today: () => string = todayIso): ValidatorFn {
  return (control: AbstractControl<string | null>): ValidationErrors | null => {
    const value = control.value ?? '';
    if (value === '') return null;
    if (!isValidIsoDate(value)) return { invalidDate: true };
    return value > today() ? { futureDate: true } : null;
  };
}

export const INVOICE_CHECK_DEBOUNCE_MS = 400;

/**
 * Asynchronous uniqueness check. Angular cancels the previous validation on every keystroke,
 * so the leading timer acts as a debounce. Fails closed: if the check cannot complete,
 * the control stays invalid rather than silently accepting a possible duplicate.
 */
export function invoiceCodeUniqueValidator(api: FinopsApiService): AsyncValidatorFn {
  return (control: AbstractControl<string | null>): Observable<ValidationErrors | null> => {
    const code = control.value ?? '';
    if (!INVOICE_CODE_PATTERN.test(code)) return of(null);
    return timer(INVOICE_CHECK_DEBOUNCE_MS).pipe(
      switchMap(() => api.checkInvoiceCode(code)),
      map((result) => (result.available ? null : { invoiceCodeTaken: true })),
      catchError(() => of({ invoiceCodeUnverified: true })),
      take(1),
    );
  };
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
