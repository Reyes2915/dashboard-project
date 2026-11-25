import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { FinopsApiService } from '../../../core/api/finops-api.service';
import { ApiError, problem } from '../../../core/api/problem';
import { Expense, ExpenseQuery, PaginatedResponse } from '../../../core/models/finops.models';
import { buildSeed } from '../../../core/mock-api/mock-seed';
import { DEFAULT_QUERY, ExpensesFacade, SEARCH_DEBOUNCE_MS } from './expenses.facade';

function page(
  items: readonly Expense[],
  overrides: Partial<PaginatedResponse<Expense>> = {},
): PaginatedResponse<Expense> {
  return { items, page: 1, pageSize: 10, total: items.length, totalPages: 1, ...overrides };
}

describe('ExpensesFacade', () => {
  const seed = buildSeed();
  let listExpenses: ReturnType<typeof vi.fn<(q: ExpenseQuery) => Observable<PaginatedResponse<Expense>>>>;
  let updateExpenseStatus: ReturnType<typeof vi.fn>;
  let deleteExpense: ReturnType<typeof vi.fn>;
  let facade: ExpensesFacade;

  beforeEach(() => {
    vi.useFakeTimers();
    listExpenses = vi.fn((): Observable<PaginatedResponse<Expense>> =>
      of(page(seed.slice(0, 10), { total: seed.length, totalPages: 3 })),
    );
    updateExpenseStatus = vi.fn(() => of(seed[2]));
    deleteExpense = vi.fn(() => of(undefined));

    TestBed.configureTestingModule({
      providers: [
        ExpensesFacade,
        { provide: FinopsApiService, useValue: { listExpenses, updateExpenseStatus, deleteExpense } },
      ],
    });
    facade = TestBed.inject(ExpensesFacade);
  });

  afterEach(() => vi.useRealTimers());

  it('loads the first page with the default query and exposes derived signals', () => {
    facade.refresh();
    expect(listExpenses).toHaveBeenCalledWith(DEFAULT_QUERY);
    expect(facade.items()).toHaveLength(10);
    expect(facade.total()).toBe(seed.length);
    expect(facade.rangeLabel()).toBe(`Showing 1–10 of ${seed.length} expenses.`);
    expect(facade.loading()).toBe(false);
  });

  it('debounces search input by 300ms and resets to page 1', () => {
    facade.goToPage(2);
    listExpenses.mockClear();

    facade.searchControl.setValue('a');
    facade.searchControl.setValue('aw');
    facade.searchControl.setValue('aws');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(listExpenses).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(listExpenses).toHaveBeenCalledTimes(1);
    expect(listExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'aws', page: 1 }));
  });

  it('ignores values that only differ by whitespace (distinctUntilChanged)', () => {
    facade.searchControl.setValue('cloud');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    facade.searchControl.setValue('cloud  ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(listExpenses).toHaveBeenCalledTimes(1);
  });

  it('never sends a search term longer than the API limit (API4)', () => {
    facade.searchControl.setValue('x'.repeat(101));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(listExpenses).not.toHaveBeenCalled();
  });

  it('cancels stale requests with switchMap so the latest query wins', () => {
    const slow = new Subject<PaginatedResponse<Expense>>();
    listExpenses.mockReturnValueOnce(slow).mockReturnValueOnce(of(page(seed.slice(0, 1))));

    facade.setStatus('PENDING');
    facade.setStatus('APPROVED');
    slow.next(page(seed.slice(0, 5)));

    expect(slow.observed).toBe(false);
    expect(facade.items()).toHaveLength(1);
    expect(facade.query().status).toBe('APPROVED');
  });

  it('cycles sort direction and maps it to aria-sort friendly state', () => {
    facade.toggleSort('title');
    expect(facade.query()).toMatchObject({ sortBy: 'title', sortDir: 'asc' });
    facade.toggleSort('title');
    expect(facade.query()).toMatchObject({ sortBy: 'title', sortDir: 'desc' });
    facade.toggleSort('totalAmount');
    expect(facade.query()).toMatchObject({ sortBy: 'totalAmount', sortDir: 'desc' });
  });

  it('clamps pagination to the known page range', () => {
    facade.refresh();
    facade.goToPage(99);
    expect(facade.query().page).toBe(3);
    facade.goToPage(-1);
    expect(facade.query().page).toBe(1);
  });

  it('surfaces a sanitised error message when loading fails (fail-closed)', () => {
    listExpenses.mockReturnValueOnce(throwError(() => new ApiError(problem(503, 'down', 'Service unavailable.'))));
    facade.refresh();
    expect(facade.error()).toBe('Service unavailable.');
    expect(facade.loading()).toBe(false);
  });

  it('approves through the API, then refreshes the table', () => {
    const expense = seed[2]!;
    listExpenses.mockClear();
    facade.decide(expense, 'APPROVED');
    expect(updateExpenseStatus).toHaveBeenCalledWith(expense.id, 'APPROVED');
    expect(listExpenses).toHaveBeenCalledTimes(1);
    expect(facade.isBusy(expense.id)).toBe(false);
  });

  it('resynchronises with the server after a forbidden mutation (403)', () => {
    deleteExpense.mockReturnValueOnce(throwError(() => new ApiError(problem(403, 'forbidden', 'Denied.'))));
    listExpenses.mockClear();
    facade.remove(seed[2]!);
    expect(listExpenses).toHaveBeenCalledTimes(1);
  });
});
