import { Injectable, computed, inject, signal } from '@angular/core';
import { FinopsApiService } from '../../../core/api/finops-api.service';
import { isApiError } from '../../../core/api/problem';
import { BudgetOverview } from '../../../core/models/finops.models';

export interface DashboardKpis {
  readonly allocated: number;
  readonly spent: number;
  readonly pending: number;
  readonly remaining: number;
  /** Committed (spent + pending) as a percentage of the allocated budget. */
  readonly utilisation: number;
  readonly overBudgetDepartments: number;
  readonly pendingCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
}

/** Signal-based facade: components read derived state, never raw HTTP. */
@Injectable()
export class DashboardFacade {
  private readonly api = inject(FinopsApiService);

  private readonly _overview = signal<BudgetOverview | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly overview = this._overview.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly departments = computed(() => this._overview()?.departments ?? []);
  readonly categories = computed(() => (this._overview()?.categories ?? []).filter((c) => c.amount > 0));

  readonly kpis = computed<DashboardKpis | null>(() => {
    const overview = this._overview();
    if (overview === null) return null;
    const totals = overview.departments.reduce(
      (acc, d) => ({
        allocated: acc.allocated + d.allocated,
        spent: acc.spent + d.spent,
        pending: acc.pending + d.pending,
      }),
      { allocated: 0, spent: 0, pending: 0 },
    );
    const committed = totals.spent + totals.pending;
    return {
      ...totals,
      remaining: totals.allocated - committed,
      utilisation: totals.allocated === 0 ? 0 : Math.round((committed / totals.allocated) * 1000) / 10,
      overBudgetDepartments: overview.departments.filter((d) => d.spent + d.pending > d.allocated).length,
      pendingCount: overview.statusCounts.PENDING,
      approvedCount: overview.statusCounts.APPROVED,
      rejectedCount: overview.statusCounts.REJECTED,
    };
  });

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    this.api.getBudgetOverview().subscribe({
      next: (overview) => {
        this._overview.set(overview);
        this._loading.set(false);
      },
      error: (error: unknown) => {
        this._error.set(isApiError(error) ? error.problem.detail : 'Budget data could not be loaded.');
        this._loading.set(false);
      },
    });
  }
}
