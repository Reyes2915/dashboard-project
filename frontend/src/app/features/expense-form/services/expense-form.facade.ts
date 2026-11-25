import { Injectable, inject, signal } from '@angular/core';
import { Observable, finalize, tap } from 'rxjs';
import { FinopsApiService } from '../../../core/api/finops-api.service';
import { CreateExpenseDto, Expense } from '../../../core/models/finops.models';

/**
 * Submission state for the wizard. One idempotency key per business action (API6):
 * double clicks or network retries replay the same key and can never create duplicates.
 */
@Injectable()
export class ExpenseFormFacade {
  private readonly api = inject(FinopsApiService);

  private idempotencyKey = crypto.randomUUID();
  private readonly _submitting = signal(false);

  readonly submitting = this._submitting.asReadonly();

  submit(dto: CreateExpenseDto): Observable<Expense> {
    this._submitting.set(true);
    return this.api.createExpense(dto, this.idempotencyKey).pipe(
      tap(() => (this.idempotencyKey = crypto.randomUUID())),
      finalize(() => this._submitting.set(false)),
    );
  }
}
