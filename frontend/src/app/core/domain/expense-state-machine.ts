import { ExpenseStatus } from '../models/finops.models';

/**
 * Finite state machine for expense approval (Web A06 Insecure Design).
 * PENDING -> APPROVED | REJECTED. Terminal states are irreversible.
 * Shared by the UI (to hide impossible actions) and the API (to enforce them).
 */
const TRANSITIONS: Readonly<Record<ExpenseStatus, readonly ExpenseStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ExpenseStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
