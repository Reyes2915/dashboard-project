import { InjectionToken } from '@angular/core';
import { Department } from '../models/finops.models';

export interface MockApiConfig {
  /** Simulated network latency for every response. */
  readonly latencyMs: number;
  /** API4: hard ceiling for `pageSize`. */
  readonly maxPageSize: number;
  /** API4: maximum length of the free-text `search` parameter. */
  readonly maxSearchLength: number;
  /** API4: fixed-window rate limit per credential. */
  readonly rateLimit: { readonly maxRequests: number; readonly windowMs: number };
  readonly sessionTtlMs: number;
  readonly storageKey: string;
  /** Injectable clock so expiry and rate-limit windows are testable. */
  readonly now: () => number;
}

export const DEFAULT_MOCK_API_CONFIG: MockApiConfig = {
  latencyMs: 300,
  maxPageSize: 50,
  maxSearchLength: 100,
  rateLimit: { maxRequests: 60, windowMs: 10_000 },
  sessionTtlMs: 15 * 60_000,
  storageKey: 'finops.mockdb.v1',
  now: () => Date.now(),
};

export const MOCK_API_CONFIG = new InjectionToken<MockApiConfig>('MOCK_API_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_MOCK_API_CONFIG,
});

/** Persistence backend for the simulated server (localStorage in the browser). */
export const MOCK_STORAGE = new InjectionToken<Storage>('MOCK_STORAGE', {
  providedIn: 'root',
  factory: () => localStorage,
});

export const BUDGET_ALLOCATIONS: Readonly<Record<Department, number>> = {
  ENGINEERING: 180_000,
  MARKETING: 95_000,
  SALES: 70_000,
  FINANCE: 40_000,
  OPERATIONS: 85_000,
  PEOPLE: 35_000,
};
