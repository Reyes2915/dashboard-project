import {
  BudgetOverview,
  BudgetSummary,
  CategorySpend,
  DEPARTMENTS,
  Department,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  InvoiceCodeAvailability,
  PaginatedResponse,
  ProblemDetail,
  SessionInfo,
  USER_ROLES,
  UserRole,
  VAT_RATES,
  VatRate,
} from '../models/finops.models';

/**
 * Runtime type guards for every HTTP payload (API10 Unsafe Consumption of APIs).
 * Nothing reaches a Signal unless it passes one of these guards.
 */

export type Guard<T> = (value: unknown) => value is T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonNegativeInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function isOneOf<T extends string | number>(values: readonly T[]): Guard<T> {
  return (v: unknown): v is T => values.some((allowed) => allowed === v);
}

export const isUserRole: Guard<UserRole> = isOneOf(USER_ROLES);
export const isExpenseStatus: Guard<ExpenseStatus> = isOneOf(EXPENSE_STATUSES);
export const isExpenseCategory: Guard<ExpenseCategory> = isOneOf(EXPENSE_CATEGORIES);
export const isDepartment: Guard<Department> = isOneOf(DEPARTMENTS);
export const isVatRate: Guard<VatRate> = isOneOf(VAT_RATES);

export function isArrayOf<T>(guard: Guard<T>): Guard<readonly T[]> {
  return (v: unknown): v is readonly T[] => Array.isArray(v) && v.every(guard);
}

export function isExpense(v: unknown): v is Expense {
  return (
    isRecord(v) &&
    isString(v['id']) &&
    isString(v['title']) &&
    isDepartment(v['department']) &&
    isExpenseCategory(v['category']) &&
    isString(v['invoiceCode']) &&
    (v['receiptUrl'] === null || isString(v['receiptUrl'])) &&
    isFiniteNumber(v['netAmount']) &&
    isVatRate(v['vatRate']) &&
    isFiniteNumber(v['totalAmount']) &&
    isString(v['date']) &&
    isString(v['justification']) &&
    isExpenseStatus(v['status']) &&
    isString(v['createdBy']) &&
    (v['approvedBy'] === null || isString(v['approvedBy'])) &&
    isString(v['createdAt'])
  );
}

export function isPaginatedResponse<T>(itemGuard: Guard<T>): Guard<PaginatedResponse<T>> {
  return (v: unknown): v is PaginatedResponse<T> =>
    isRecord(v) &&
    isArrayOf(itemGuard)(v['items']) &&
    isNonNegativeInt(v['page']) &&
    isNonNegativeInt(v['pageSize']) &&
    isNonNegativeInt(v['total']) &&
    isNonNegativeInt(v['totalPages']);
}

export const isExpensePage: Guard<PaginatedResponse<Expense>> = isPaginatedResponse(isExpense);

function isBudgetSummary(v: unknown): v is BudgetSummary {
  return (
    isRecord(v) &&
    isDepartment(v['department']) &&
    isFiniteNumber(v['allocated']) &&
    isFiniteNumber(v['spent']) &&
    isFiniteNumber(v['pending'])
  );
}

function isCategorySpend(v: unknown): v is CategorySpend {
  return isRecord(v) && isExpenseCategory(v['category']) && isFiniteNumber(v['amount']);
}

export function isBudgetOverview(v: unknown): v is BudgetOverview {
  if (!isRecord(v)) return false;
  const counts = v['statusCounts'];
  return (
    isArrayOf(isBudgetSummary)(v['departments']) &&
    isArrayOf(isCategorySpend)(v['categories']) &&
    isRecord(counts) &&
    EXPENSE_STATUSES.every((s) => isNonNegativeInt(counts[s])) &&
    isString(v['generatedAt'])
  );
}

export function isSessionInfo(v: unknown): v is SessionInfo {
  return (
    isRecord(v) &&
    isString(v['token']) &&
    v['token'].length >= 32 &&
    isUserRole(v['role']) &&
    isString(v['userId']) &&
    isString(v['displayName']) &&
    isArrayOf(isDepartment)(v['scope']) &&
    isFiniteNumber(v['expiresAt'])
  );
}

export function isInvoiceCodeAvailability(v: unknown): v is InvoiceCodeAvailability {
  return isRecord(v) && isString(v['code']) && typeof v['available'] === 'boolean';
}

export function isProblemDetail(v: unknown): v is ProblemDetail {
  if (!isRecord(v)) return false;
  const errors = v['errors'];
  return (
    isString(v['type']) &&
    isString(v['title']) &&
    Number.isInteger(v['status']) &&
    isString(v['detail']) &&
    (v['instance'] === undefined || isString(v['instance'])) &&
    (errors === undefined || (isRecord(errors) && Object.values(errors).every(isString)))
  );
}
