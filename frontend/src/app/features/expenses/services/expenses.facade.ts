import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, Validators } from '@angular/forms';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  expand,
  filter,
  map,
  of,
  reduce,
  switchMap,
  tap,
} from 'rxjs';
import { FinopsApiService } from '../../../core/api/finops-api.service';
import { isApiError } from '../../../core/api/problem';
import {
  Expense,
  ExpenseCategory,
  ExpenseDecision,
  ExpenseQuery,
  ExpenseSortField,
  ExpenseStatus,
  PaginatedResponse,
} from '../../../core/models/finops.models';
import { downloadCsv, toCsv } from '../../../core/security/csv';
import { NotificationService } from '../../../core/services/notification.service';

export const SEARCH_DEBOUNCE_MS = 300;
export const MAX_SEARCH_LENGTH = 100;
export const PAGE_SIZES = [10, 25, 50] as const;
const MAX_EXPORT_PAGES = 20;

export const DEFAULT_QUERY: ExpenseQuery = {
  page: 1,
  pageSize: 10,
  search: '',
  status: 'ALL',
  category: 'ALL',
  sortBy: 'date',
  sortDir: 'desc',
};

type LoadResult =
  { readonly ok: true; readonly page: PaginatedResponse<Expense> } | { readonly ok: false; readonly message: string };

/**
 * Signal-based facade for the expenses table. Search is a reactive pipeline
 * (FormControl -> debounceTime -> distinctUntilChanged -> switchMap) so stale responses are cancelled.
 */
@Injectable()
export class ExpensesFacade {
  private readonly api = inject(FinopsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_SEARCH_LENGTH)],
  });

  private readonly reload$ = new Subject<void>();
  private readonly _query = signal<ExpenseQuery>(DEFAULT_QUERY);
  private readonly _page = signal<PaginatedResponse<Expense> | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
  private readonly _exporting = signal(false);

  readonly query = this._query.asReadonly();
  readonly page = this._page.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly exporting = this._exporting.asReadonly();

  readonly items = computed(() => this._page()?.items ?? []);
  readonly total = computed(() => this._page()?.total ?? 0);
  readonly totalPages = computed(() => this._page()?.totalPages ?? 1);
  readonly rangeLabel = computed(() => {
    const page = this._page();
    if (page === null) return '';
    if (page.total === 0) return 'No expenses match the current filters.';
    const from = (page.page - 1) * page.pageSize + 1;
    const to = from + page.items.length - 1;
    return `Showing ${from}–${to} of ${page.total} expenses.`;
  });

  constructor() {
    this.searchControl.valueChanges
      .pipe(
        map((value) => value.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        filter(() => this.searchControl.valid),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((search) => this.patchQuery({ search, page: 1 }));

    this.reload$
      .pipe(
        map(() => this._query()),
        tap(() => {
          this._loading.set(true);
          this._error.set(null);
        }),
        switchMap((query) =>
          this.api.listExpenses(query).pipe(
            map((page): LoadResult => ({ ok: true, page })),
            catchError((error: unknown) =>
              of<LoadResult>({
                ok: false,
                message: isApiError(error) ? error.problem.detail : 'Expenses could not be loaded.',
              }),
            ),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this._loading.set(false);
        if (!result.ok) {
          this._error.set(result.message);
          return;
        }
        this._page.set(result.page);
        // Keep the user on a valid page after deletions or narrower filters.
        if (result.page.items.length === 0 && result.page.page > result.page.totalPages) {
          this.patchQuery({ page: result.page.totalPages });
        }
      });
  }

  refresh(): void {
    this.reload$.next();
  }

  setStatus(status: ExpenseStatus | 'ALL'): void {
    this.patchQuery({ status, page: 1 });
  }

  setCategory(category: ExpenseCategory | 'ALL'): void {
    this.patchQuery({ category, page: 1 });
  }

  setPageSize(pageSize: number): void {
    this.patchQuery({ pageSize, page: 1 });
  }

  goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.totalPages());
    if (target !== this._query().page) this.patchQuery({ page: target });
  }

  toggleSort(field: ExpenseSortField): void {
    const { sortBy, sortDir } = this._query();
    const nextDir =
      sortBy === field
        ? sortDir === 'asc'
          ? 'desc'
          : 'asc'
        : field === 'date' || field === 'totalAmount'
          ? 'desc'
          : 'asc';
    this.patchQuery({ sortBy: field, sortDir: nextDir, page: 1 });
  }

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  decide(expense: Expense, decision: ExpenseDecision): void {
    this.mutate(expense.id, this.api.updateExpenseStatus(expense.id, decision), () =>
      this.notifications.success(`"${expense.title}" was ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`),
    );
  }

  remove(expense: Expense): void {
    this.mutate(expense.id, this.api.deleteExpense(expense.id), () =>
      this.notifications.success(`"${expense.title}" was deleted.`),
    );
  }

  /** Exports every row matching the current filters (paged at the API maximum) as injection-safe CSV. */
  exportCsv(): void {
    if (this._exporting()) return;
    this._exporting.set(true);
    const base: ExpenseQuery = { ...this._query(), page: 1, pageSize: 50 };

    this.api
      .listExpenses(base)
      .pipe(
        expand((page) =>
          page.page < page.totalPages && page.page < MAX_EXPORT_PAGES
            ? this.api.listExpenses({ ...base, page: page.page + 1 })
            : EMPTY,
        ),
        reduce((rows: Expense[], page) => [...rows, ...page.items], []),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (rows) => {
          const csv = toCsv(
            [
              'Invoice',
              'Title',
              'Department',
              'Category',
              'Date',
              'Net (EUR)',
              'VAT %',
              'Total (EUR)',
              'Status',
              'Justification',
            ],
            rows.map((e) => [
              e.invoiceCode,
              e.title,
              e.department,
              e.category,
              e.date,
              e.netAmount,
              e.vatRate,
              e.totalAmount,
              e.status,
              e.justification,
            ]),
          );
          downloadCsv(`expenses-${new Date().toISOString().slice(0, 10)}.csv`, csv);
          this.notifications.success(`Exported ${rows.length} expenses.`);
          this._exporting.set(false);
        },
        error: () => this._exporting.set(false),
      });
  }

  private patchQuery(patch: Partial<ExpenseQuery>): void {
    this._query.update((query) => ({ ...query, ...patch }));
    this.reload$.next();
  }

  private mutate(id: string, request: Observable<unknown>, onSuccess: () => void): void {
    if (this.isBusy(id)) return;
    this._busyIds.update((ids) => new Set(ids).add(id));
    const release = (): void =>
      this._busyIds.update((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        release();
        onSuccess();
        this.refresh();
      },
      // Errors were already surfaced by the HTTP error interceptor; resync with the server state.
      error: () => {
        release();
        this.refresh();
      },
    });
  }
}
