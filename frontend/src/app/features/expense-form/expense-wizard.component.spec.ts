import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MemoryStorage } from '../../../testing/memory-storage';
import { authSecurityInterceptor } from '../../core/interceptors/auth-security.interceptor';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { mockApiInterceptor } from '../../core/interceptors/mock-api.interceptor';
import { DEFAULT_MOCK_API_CONFIG, MOCK_API_CONFIG, MOCK_STORAGE } from '../../core/mock-api/mock-api.config';
import { RoleService } from '../../core/services/role.service';
import { ExpenseWizardComponent } from './expense-wizard.component';

describe('ExpenseWizardComponent', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ExpenseWizardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([httpErrorInterceptor, authSecurityInterceptor, mockApiInterceptor])),
        { provide: MOCK_API_CONFIG, useValue: { ...DEFAULT_MOCK_API_CONFIG, latencyMs: 0 } },
        { provide: MOCK_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    await firstValueFrom(TestBed.inject(RoleService).startSession('ADMIN'));
  });

  async function render() {
    const fixture = TestBed.createComponent(ExpenseWizardComponent);
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement, wizard: fixture.componentInstance };
  }

  it('marks the current step with aria-current="step" and blocks progress while invalid', async () => {
    const { fixture, root } = await render();
    expect(root.querySelector('[aria-current="step"]')?.textContent).toContain('Invoice details');

    root.querySelector<HTMLButtonElement>('.wizard__actions .btn--primary')?.click();
    await fixture.whenStable();
    expect(root.querySelector('[aria-current="step"]')?.textContent).toContain('Invoice details');
    expect(root.querySelector('#field-title')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects an SSRF receipt URL inline before it ever reaches the API', async () => {
    const { fixture, root, wizard } = await render();
    wizard.form.controls.details.controls.receiptUrl.setValue('http://169.254.169.254/latest');
    wizard.form.controls.details.controls.receiptUrl.markAsTouched();
    await fixture.whenStable();
    expect(root.querySelector('#receipt-error')?.textContent).toContain('Only public https://');
  });

  it('computes VAT and total live and reports unsaved changes to the guard', async () => {
    const { fixture, root, wizard } = await render();
    const { details, amounts } = wizard.form.controls;
    details.setValue({
      title: 'Observability seats',
      department: 'ENGINEERING',
      category: 'SOFTWARE',
      invoiceCode: 'INV-6001',
      receiptUrl: '',
    });
    await vi.waitFor(() => expect(details.controls.invoiceCode.pending).toBe(false), { timeout: 2000 });
    amounts.patchValue({ netAmount: 1000, vatRate: 21 });
    details.markAsDirty();

    root.querySelector<HTMLButtonElement>('.wizard__actions .btn--primary')?.click();
    await fixture.whenStable();
    expect(root.querySelector('[aria-current="step"]')?.textContent).toContain('Amounts');
    expect(root.querySelector('#vat-summary')?.textContent).toContain('210.00');
    expect(root.querySelector('#vat-summary')?.textContent).toContain('1,210.00');
    expect(wizard.hasPendingChanges()).toBe(true);
  });
});
