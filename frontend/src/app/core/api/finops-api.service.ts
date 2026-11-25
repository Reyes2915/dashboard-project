import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, OperatorFunction, map } from 'rxjs';
import {
  BudgetOverview,
  CreateExpenseDto,
  Expense,
  ExpenseDecision,
  ExpenseQuery,
  InvoiceCodeAvailability,
  PaginatedResponse,
  SessionInfo,
  UserRole,
} from '../models/finops.models';
import {
  Guard,
  isBudgetOverview,
  isExpense,
  isExpensePage,
  isInvoiceCodeAvailability,
  isSessionInfo,
} from '../security/payload-guards';
import { SecurityAuditService } from '../services/security-audit.service';
import { AUTH_OVERRIDE, AuthOverride, IDEMPOTENCY_KEY, SILENT_ERRORS } from './http-context';
import { ApiError, problem } from './problem';

export const API_BASE = '/api/v1';

/**
 * Typed gateway to the versioned REST API (API9). Every response is validated with a
 * runtime type guard before it is handed to callers (API10).
 */
@Injectable({ providedIn: 'root' })
export class FinopsApiService {
  private readonly http = inject(HttpClient);
  private readonly audit = inject(SecurityAuditService);

  issueSession(role: UserRole): Observable<SessionInfo> {
    return this.http
      .post<unknown>(`${API_BASE}/auth/session`, { role })
      .pipe(this.validated(isSessionInfo, 'SessionInfo'));
  }

  revokeSession(credentials: AuthOverride): Observable<void> {
    const context = new HttpContext().set(AUTH_OVERRIDE, credentials).set(SILENT_ERRORS, true);
    return this.http.delete<unknown>(`${API_BASE}/auth/session`, { context }).pipe(map(() => undefined));
  }

  listExpenses(query: ExpenseQuery): Observable<PaginatedResponse<Expense>> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('pageSize', query.pageSize)
      .set('sortBy', query.sortBy)
      .set('sortDir', query.sortDir);
    if (query.search !== '') params = params.set('search', query.search);
    if (query.status !== 'ALL') params = params.set('status', query.status);
    if (query.category !== 'ALL') params = params.set('category', query.category);
    return this.http
      .get<unknown>(`${API_BASE}/expenses`, { params })
      .pipe(this.validated(isExpensePage, 'PaginatedResponse<Expense>'));
  }

  getExpense(id: string): Observable<Expense> {
    return this.http
      .get<unknown>(`${API_BASE}/expenses/${encodeURIComponent(id)}`)
      .pipe(this.validated(isExpense, 'Expense'));
  }

  createExpense(dto: CreateExpenseDto, idempotencyKey: string): Observable<Expense> {
    const context = new HttpContext().set(IDEMPOTENCY_KEY, idempotencyKey);
    return this.http.post<unknown>(`${API_BASE}/expenses`, dto, { context }).pipe(this.validated(isExpense, 'Expense'));
  }

  updateExpenseStatus(id: string, status: ExpenseDecision): Observable<Expense> {
    return this.http
      .patch<unknown>(`${API_BASE}/expenses/${encodeURIComponent(id)}`, { status })
      .pipe(this.validated(isExpense, 'Expense'));
  }

  deleteExpense(id: string): Observable<void> {
    return this.http.delete<unknown>(`${API_BASE}/expenses/${encodeURIComponent(id)}`).pipe(map(() => undefined));
  }

  checkInvoiceCode(code: string): Observable<InvoiceCodeAvailability> {
    const context = new HttpContext().set(SILENT_ERRORS, true);
    return this.http
      .get<unknown>(`${API_BASE}/invoice-codes/${encodeURIComponent(code)}`, { context })
      .pipe(this.validated(isInvoiceCodeAvailability, 'InvoiceCodeAvailability'));
  }

  getBudgetOverview(): Observable<BudgetOverview> {
    return this.http.get<unknown>(`${API_BASE}/budgets`).pipe(this.validated(isBudgetOverview, 'BudgetOverview'));
  }

  /** Fail-closed contract check: an unexpected shape is an error, never a partially trusted value. */
  validated<T>(guard: Guard<T>, contract: string): OperatorFunction<unknown, T> {
    return map((payload: unknown) => {
      if (guard(payload)) return payload;
      this.audit.record('CONTRACT_VIOLATION', 'CRITICAL', `Response rejected: does not match ${contract}`);
      throw new ApiError(problem(502, 'contract-violation', 'The server returned an unexpected response.'));
    });
  }
}
