import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { startWith } from 'rxjs';
import { FinopsApiService } from '../../core/api/finops-api.service';
import { isApiError } from '../../core/api/problem';
import { PendingChangesAware } from '../../core/guards/unsaved-changes.guard';
import { computeTotal, computeVat, formatEur } from '../../core/domain/money';
import {
  CreateExpenseDto,
  DEPARTMENTS,
  Department,
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  VAT_RATES,
  VatRate,
} from '../../core/models/finops.models';
import { NotificationService } from '../../core/services/notification.service';
import { RoleService } from '../../core/services/role.service';
import { ModalComponent } from '../../shared/components/modal/modal.component';
import { ExpenseFormFacade } from './services/expense-form.facade';
import {
  invoiceCodeFormatValidator,
  invoiceCodeUniqueValidator,
  notInFutureDateValidator,
  safeHttpsUrlValidator,
  safeTextValidator,
  todayIso,
} from './validators/expense.validators';

const STEPS = ['Invoice details', 'Amounts', 'Review'] as const;

/** Maps each control to its step so server-side 422 errors can send the user to the right place. */
const FIELD_STEP: Readonly<Record<string, number>> = {
  title: 0,
  department: 0,
  category: 0,
  invoiceCode: 0,
  receiptUrl: 0,
  netAmount: 1,
  vatRate: 1,
  date: 1,
  justification: 1,
};

@Component({
  selector: 'app-expense-wizard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ExpenseFormFacade],
  imports: [ReactiveFormsModule, RouterLink, ModalComponent],
  templateUrl: './expense-wizard.component.html',
  styleUrl: './expense-wizard.component.scss',
})
export class ExpenseWizardComponent implements PendingChangesAware {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(FinopsApiService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly injector = inject(Injector);
  protected readonly facade = inject(ExpenseFormFacade);
  private readonly roles = inject(RoleService);

  protected readonly steps = STEPS;
  protected readonly categories = EXPENSE_CATEGORIES;
  protected readonly vatRates = VAT_RATES;
  protected readonly maxDate = todayIso();
  protected readonly departments = computed<readonly Department[]>(() => this.roles.session()?.scope ?? DEPARTMENTS);

  protected readonly step = signal(0);
  protected readonly discardOpen = signal(false);
  private submitted = false;
  private discardResolver: ((discard: boolean) => void) | null = null;

  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  readonly form = this.fb.nonNullable.group({
    details: this.fb.nonNullable.group({
      title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(80), safeTextValidator]],
      department: this.fb.nonNullable.control<Department>('ENGINEERING', Validators.required),
      category: this.fb.nonNullable.control<ExpenseCategory>('SOFTWARE', Validators.required),
      invoiceCode: this.fb.nonNullable.control('', {
        validators: [Validators.required, invoiceCodeFormatValidator],
        asyncValidators: [invoiceCodeUniqueValidator(this.api)],
      }),
      receiptUrl: ['', [Validators.maxLength(2048), safeHttpsUrlValidator]],
    }),
    amounts: this.fb.nonNullable.group({
      netAmount: this.fb.control<number | null>(null, [
        Validators.required,
        Validators.min(0.01),
        Validators.max(1_000_000),
      ]),
      vatRate: this.fb.nonNullable.control<VatRate>(21, Validators.required),
      date: [todayIso(), [Validators.required, notInFutureDateValidator()]],
      justification: [
        '',
        [Validators.required, Validators.minLength(10), Validators.maxLength(500), safeTextValidator],
      ],
    }),
  });

  private readonly amounts = toSignal(
    this.form.controls.amounts.valueChanges.pipe(startWith(this.form.controls.amounts.getRawValue())),
    { requireSync: true },
  );

  protected readonly vatAmount = computed(() => {
    const { netAmount, vatRate } = this.amounts();
    return typeof netAmount === 'number' && vatRate !== undefined ? computeVat(netAmount, vatRate) : 0;
  });
  protected readonly totalAmount = computed(() => {
    const { netAmount, vatRate } = this.amounts();
    return typeof netAmount === 'number' && vatRate !== undefined ? computeTotal(netAmount, vatRate) : 0;
  });

  // ------------------------------------------------------------- navigation

  protected next(): void {
    const group = this.step() === 0 ? this.form.controls.details : this.form.controls.amounts;
    if (group.pending) {
      this.notifications.info('Still verifying the invoice code, please wait a moment.');
      return;
    }
    if (group.invalid) {
      group.markAllAsTouched();
      this.focusFirstInvalid(group);
      return;
    }
    this.goTo(this.step() + 1);
  }

  protected back(): void {
    this.goTo(this.step() - 1);
  }

  protected goTo(index: number): void {
    // Steps can only be revisited, never skipped ahead past an invalid step.
    if (index < 0 || index >= STEPS.length || index > this.step() + 1) return;
    this.step.set(index);
    afterNextRender(() => this.stepHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  // ------------------------------------------------------------- submission

  protected submit(): void {
    if (this.form.invalid || this.form.pending) {
      this.form.markAllAsTouched();
      this.goTo(this.form.controls.details.valid ? 1 : 0);
      return;
    }
    const dto = this.toDto();
    this.facade.submit(dto).subscribe({
      next: (expense) => {
        this.submitted = true;
        this.form.markAsPristine();
        this.notifications.success(`Expense ${expense.invoiceCode} submitted for approval.`);
        void this.router.navigate(['/expenses']);
      },
      error: (error: unknown) => {
        const fieldErrors = isApiError(error) ? error.problem.errors : undefined;
        if (fieldErrors !== undefined) this.applyServerErrors(fieldErrors);
      },
    });
  }

  protected errorFor(control: AbstractControl, label: string): string | null {
    if (!(control.touched || control.dirty) || control.valid || control.pending) return null;
    const e = control.errors ?? {};
    if (e['required']) return `${label} is required.`;
    if (e['minlength']) return `${label} is too short.`;
    if (e['maxlength']) return `${label} is too long.`;
    if (e['min'] || e['max']) return `${label} must be between 0.01 and 1,000,000.`;
    if (e['unsafeText']) return `${label} contains characters that are not allowed.`;
    if (e['invoiceFormat']) return 'Use the format INV-0000.';
    if (e['invoiceCodeTaken']) return 'This invoice code is already registered.';
    if (e['invoiceCodeUnverified']) return 'The invoice code could not be verified. Try again.';
    if (e['unsafeUrl']) return 'Only public https:// URLs are allowed (no localhost, private IPs or other schemes).';
    if (e['invalidDate']) return 'Enter a valid date.';
    if (e['futureDate']) return 'The invoice date cannot be in the future.';
    if (typeof e['server'] === 'string') return e['server'];
    return `${label} is invalid.`;
  }

  protected eur(value: number | null): string {
    return formatEur(value ?? 0);
  }

  protected label(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase();
  }

  // ------------------------------------------------------------- unsaved changes guard

  hasPendingChanges(): boolean {
    return this.form.dirty && !this.submitted;
  }

  confirmDiscard(): Promise<boolean> {
    this.discardOpen.set(true);
    return new Promise<boolean>((resolve) => (this.discardResolver = resolve));
  }

  protected resolveDiscard(discard: boolean): void {
    this.discardOpen.set(false);
    this.discardResolver?.(discard);
    this.discardResolver = null;
  }

  // ------------------------------------------------------------- helpers

  private toDto(): CreateExpenseDto {
    const { details, amounts } = this.form.getRawValue();
    const receipt = details.receiptUrl.trim();
    return {
      title: details.title.trim(),
      department: details.department,
      category: details.category,
      invoiceCode: details.invoiceCode,
      receiptUrl: receipt === '' ? null : receipt,
      netAmount: amounts.netAmount ?? 0,
      vatRate: amounts.vatRate,
      date: amounts.date,
      justification: amounts.justification.trim(),
    };
  }

  private applyServerErrors(errors: Readonly<Record<string, string>>): void {
    const controls: Record<string, AbstractControl> = {
      ...this.form.controls.details.controls,
      ...this.form.controls.amounts.controls,
    };
    let firstStep: number | null = null;
    for (const [field, message] of Object.entries(errors)) {
      const control = controls[field];
      if (control === undefined) continue;
      control.setErrors({ server: message });
      control.markAsTouched();
      const step = FIELD_STEP[field] ?? 0;
      firstStep = firstStep === null ? step : Math.min(firstStep, step);
    }
    if (firstStep !== null) this.step.set(firstStep);
  }

  private focusFirstInvalid(group: { readonly controls: Readonly<Record<string, AbstractControl>> }): void {
    const first = Object.keys(group.controls).find((name) => group.controls[name]?.invalid === true);
    if (first === undefined) return;
    afterNextRender(() => document.getElementById(`field-${first}`)?.focus(), { injector: this.injector });
  }
}
