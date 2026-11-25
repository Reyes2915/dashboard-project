import { FormControl } from '@angular/forms';
import { Observable, firstValueFrom, isObservable, of, throwError } from 'rxjs';
import { FinopsApiService } from '../../../core/api/finops-api.service';
import { InvoiceCodeAvailability } from '../../../core/models/finops.models';
import {
  INVOICE_CHECK_DEBOUNCE_MS,
  invoiceCodeFormatValidator,
  invoiceCodeUniqueValidator,
  notInFutureDateValidator,
  safeHttpsUrlValidator,
  safeTextValidator,
} from './expense.validators';

describe('safeHttpsUrlValidator (API7 SSRF)', () => {
  const validate = (value: string): unknown => safeHttpsUrlValidator(new FormControl(value));

  it.each(['', 'https://receipts.vendor.com/inv-1.pdf', 'https://cdn.example.org:443/a?b=c'])('accepts %s', (url) => {
    expect(validate(url)).toBeNull();
  });

  it.each([
    ['http://vendor.com/receipt', 'SCHEME_NOT_ALLOWED'],
    ['javascript:alert(1)', 'SCHEME_NOT_ALLOWED'],
    ['file:///etc/passwd', 'SCHEME_NOT_ALLOWED'],
    ['https://localhost/admin', 'PRIVATE_HOST'],
    ['https://127.0.0.1/', 'PRIVATE_HOST'],
    ['https://10.0.0.5/', 'PRIVATE_HOST'],
    ['https://192.168.1.1/', 'PRIVATE_HOST'],
    ['https://172.16.0.1/', 'PRIVATE_HOST'],
    ['https://169.254.169.254/latest/meta-data', 'PRIVATE_HOST'],
    ['https://[::1]/', 'PRIVATE_HOST'],
    ['https://2130706433/', 'PRIVATE_HOST'],
    ['https://0x7f.0.0.1/', 'PRIVATE_HOST'],
    ['https://intranet/', 'PRIVATE_HOST'],
    ['https://printer.local/', 'PRIVATE_HOST'],
    ['https://user:pass@vendor.com/', 'CREDENTIALS_NOT_ALLOWED'],
    ['https://vendor.com:8443/', 'PORT_NOT_ALLOWED'],
    ['https://vendor.com/\u0000', 'MALFORMED'],
    ['not a url', 'MALFORMED'],
  ])('blocks %s (%s)', (url, reason) => {
    expect(validate(url)).toEqual({ unsafeUrl: { reason } });
  });
});

describe('text and format validators (Web A05)', () => {
  it('rejects markup and control characters in free text', () => {
    expect(safeTextValidator(new FormControl('Cloud invoice (Q4) – 50% off'))).toBeNull();
    expect(safeTextValidator(new FormControl('<img src=x onerror=alert(1)>'))).toEqual({ unsafeText: true });
    expect(safeTextValidator(new FormControl('`rm -rf`'))).toEqual({ unsafeText: true });
  });

  it('enforces the INV-XXXX invoice format', () => {
    expect(invoiceCodeFormatValidator(new FormControl('INV-0420'))).toBeNull();
    expect(invoiceCodeFormatValidator(new FormControl('INV-42'))).toEqual({ invoiceFormat: true });
    expect(invoiceCodeFormatValidator(new FormControl('inv-0420'))).toEqual({ invoiceFormat: true });
  });

  it('rejects invalid and future dates', () => {
    const validator = notInFutureDateValidator(() => '2026-11-18');
    expect(validator(new FormControl('2026-11-18'))).toBeNull();
    expect(validator(new FormControl('2026-11-19'))).toEqual({ futureDate: true });
    expect(validator(new FormControl('2026-02-30'))).toEqual({ invalidDate: true });
  });
});

describe('invoiceCodeUniqueValidator (async)', () => {
  function run(api: Pick<FinopsApiService, 'checkInvoiceCode'>, value: string): Promise<unknown> {
    const result = invoiceCodeUniqueValidator(api as FinopsApiService)(new FormControl(value));
    const stream: Observable<unknown> = isObservable(result) ? result : of(result);
    const promise = firstValueFrom(stream);
    vi.advanceTimersByTime(INVOICE_CHECK_DEBOUNCE_MS);
    return promise;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('skips the network call for malformed codes', async () => {
    const checkInvoiceCode = vi.fn();
    expect(await run({ checkInvoiceCode }, 'INV-1')).toBeNull();
    expect(checkInvoiceCode).not.toHaveBeenCalled();
  });

  it('flags codes that already exist', async () => {
    const checkInvoiceCode = vi.fn(() => of<InvoiceCodeAvailability>({ code: 'INV-1001', available: false }));
    expect(await run({ checkInvoiceCode }, 'INV-1001')).toEqual({ invoiceCodeTaken: true });
  });

  it('accepts available codes', async () => {
    const checkInvoiceCode = vi.fn(() => of<InvoiceCodeAvailability>({ code: 'INV-8888', available: true }));
    expect(await run({ checkInvoiceCode }, 'INV-8888')).toBeNull();
  });

  it('fails closed when the check cannot be completed', async () => {
    const checkInvoiceCode = vi.fn(() => throwError(() => new Error('offline')));
    expect(await run({ checkInvoiceCode }, 'INV-8888')).toEqual({ invoiceCodeUnverified: true });
  });
});
