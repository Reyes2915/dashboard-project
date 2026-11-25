import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HasRoleDirective } from '../../core/directives/has-role.directive';
import { canTransition } from '../../core/domain/expense-state-machine';
import { formatEur } from '../../core/domain/money';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  Expense,
  ExpenseCategory,
  ExpenseSortField,
  ExpenseStatus,
} from '../../core/models/finops.models';
import { RoleService } from '../../core/services/role.service';
import { ModalComponent } from '../../shared/components/modal/modal.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { controlValue } from '../../shared/utils/dom-events';
import { ExpensesFacade, MAX_SEARCH_LENGTH, PAGE_SIZES } from './services/expenses.facade';

interface PendingAction {
  readonly kind: 'APPROVED' | 'REJECTED' | 'DELETE';
  readonly expense: Expense;
}

const COLUMNS: readonly { readonly field: ExpenseSortField; readonly label: string; readonly numeric?: boolean }[] = [
  { field: 'date', label: 'Date' },
  { field: 'title', label: 'Expense' },
  { field: 'department', label: 'Department' },
  { field: 'totalAmount', label: 'Total', numeric: true },
  { field: 'status', label: 'Status' },
];

@Component({
  selector: 'app-expenses-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ExpensesFacade],
  imports: [ReactiveFormsModule, RouterLink, DatePipe, HasRoleDirective, ModalComponent, SkeletonLoaderComponent],
  templateUrl: './expenses-page.component.html',
  styleUrl: './expenses-page.component.scss',
})
export class ExpensesPageComponent {
  protected readonly facade = inject(ExpensesFacade);
  protected readonly roles = inject(RoleService);

  protected readonly columns = COLUMNS;
  protected readonly statuses = EXPENSE_STATUSES;
  protected readonly categories = EXPENSE_CATEGORIES;
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly maxSearchLength = MAX_SEARCH_LENGTH;

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly modalHeading = computed(() => {
    const action = this.pendingAction();
    if (action === null) return '';
    return action.kind === 'DELETE'
      ? 'Delete expense?'
      : action.kind === 'APPROVED'
        ? 'Approve expense?'
        : 'Reject expense?';
  });

  constructor() {
    effect(() => {
      if (this.roles.session() !== null) untracked(() => this.facade.refresh());
    });
  }

  protected ariaSort(field: ExpenseSortField): 'ascending' | 'descending' | 'none' {
    const { sortBy, sortDir } = this.facade.query();
    if (sortBy !== field) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  protected canDecide(expense: Expense): boolean {
    return canTransition(expense.status, 'APPROVED');
  }

  protected onStatusFilter(event: Event): void {
    const value = controlValue(event);
    this.facade.setStatus(EXPENSE_STATUSES.find((s): s is ExpenseStatus => s === value) ?? 'ALL');
  }

  protected onCategoryFilter(event: Event): void {
    const value = controlValue(event);
    this.facade.setCategory(EXPENSE_CATEGORIES.find((c): c is ExpenseCategory => c === value) ?? 'ALL');
  }

  protected onPageSize(event: Event): void {
    const value = Number(controlValue(event));
    this.facade.setPageSize(PAGE_SIZES.find((size) => size === value) ?? PAGE_SIZES[0]);
  }

  protected confirm(kind: PendingAction['kind'], expense: Expense): void {
    this.pendingAction.set({ kind, expense });
  }

  protected executePending(): void {
    const action = this.pendingAction();
    this.pendingAction.set(null);
    if (action === null) return;
    if (action.kind === 'DELETE') this.facade.remove(action.expense);
    else this.facade.decide(action.expense, action.kind);
  }

  protected eur(amount: number): string {
    return formatEur(amount);
  }

  protected label(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase();
  }
}
