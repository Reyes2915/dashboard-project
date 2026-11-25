/**
 * Domain contracts for the FinOps Enterprise Dashboard.
 * Literal tuples are the single source of truth: types are derived from them so that
 * runtime guards and compile-time types can never drift apart.
 */

export const USER_ROLES = ['ADMIN', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EXPENSE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/** Terminal states reachable from PENDING. */
export type ExpenseDecision = Exclude<ExpenseStatus, 'PENDING'>;

export const EXPENSE_CATEGORIES = [
  'CLOUD',
  'SOFTWARE',
  'HARDWARE',
  'TRAVEL',
  'MARKETING',
  'CONSULTING',
  'TRAINING',
  'OFFICE',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const DEPARTMENTS = ['ENGINEERING', 'MARKETING', 'SALES', 'FINANCE', 'OPERATIONS', 'PEOPLE'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const VAT_RATES = [0, 4, 10, 21] as const;
export type VatRate = (typeof VAT_RATES)[number];

export interface Expense {
  readonly id: string;
  readonly title: string;
  readonly department: Department;
  readonly category: ExpenseCategory;
  readonly invoiceCode: string;
  readonly receiptUrl: string | null;
  readonly netAmount: number;
  readonly vatRate: VatRate;
  readonly totalAmount: number;
  /** ISO date (YYYY-MM-DD). */
  readonly date: string;
  readonly justification: string;
  readonly status: ExpenseStatus;
  readonly createdBy: string;
  readonly approvedBy: string | null;
  /** ISO timestamp. */
  readonly createdAt: string;
}

/** Client-writable subset. Privileged fields (id, status, approvedBy...) are deliberately absent (API3). */
export interface CreateExpenseDto {
  readonly title: string;
  readonly department: Department;
  readonly category: ExpenseCategory;
  readonly invoiceCode: string;
  readonly receiptUrl: string | null;
  readonly netAmount: number;
  readonly vatRate: VatRate;
  readonly date: string;
  readonly justification: string;
}

export interface UpdateExpenseStatusDto {
  readonly status: ExpenseDecision;
}

export interface BudgetSummary {
  readonly department: Department;
  readonly allocated: number;
  readonly spent: number;
  readonly pending: number;
}

export interface CategorySpend {
  readonly category: ExpenseCategory;
  readonly amount: number;
}

export interface BudgetOverview {
  readonly departments: readonly BudgetSummary[];
  readonly categories: readonly CategorySpend[];
  readonly statusCounts: Readonly<Record<ExpenseStatus, number>>;
  readonly generatedAt: string;
}

export const EXPENSE_SORT_FIELDS = ['date', 'title', 'department', 'totalAmount', 'status'] as const;
export type ExpenseSortField = (typeof EXPENSE_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

export interface ExpenseQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ExpenseStatus | 'ALL';
  readonly category: ExpenseCategory | 'ALL';
  readonly sortBy: ExpenseSortField;
  readonly sortDir: SortDirection;
}

export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface SessionInfo {
  readonly token: string;
  readonly role: UserRole;
  readonly userId: string;
  readonly displayName: string;
  readonly scope: readonly Department[];
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface InvoiceCodeAvailability {
  readonly code: string;
  readonly available: boolean;
}

/** RFC 7807 Problem Details for HTTP APIs. */
export interface ProblemDetail {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly errors?: Readonly<Record<string, string>>;
}

export const SECURITY_EVENT_TYPES = [
  'AUTHN_FAILURE',
  'AUTHZ_DENIED',
  'INTEGRITY_VIOLATION',
  'RATE_LIMITED',
  'VALIDATION_REJECTED',
  'CONTRACT_VIOLATION',
  'SESSION_RESET',
  'CRITICAL_ERROR',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
export type SecuritySeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type SecurityEventSource = 'API_GATEWAY' | 'CLIENT';

export interface SecurityAuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly type: SecurityEventType;
  readonly severity: SecuritySeverity;
  readonly source: SecurityEventSource;
  readonly message: string;
}
