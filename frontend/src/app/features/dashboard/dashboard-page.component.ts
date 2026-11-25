import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatEurCompact } from '../../core/domain/money';
import { RoleService } from '../../core/services/role.service';
import { KpiCardComponent } from '../../shared/components/kpi-card/kpi-card.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { CategoryDonutChartComponent } from './components/category-donut-chart/category-donut-chart.component';
import { DepartmentBarChartComponent } from './components/department-bar-chart/department-bar-chart.component';
import { DashboardFacade } from './services/dashboard.facade';

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DashboardFacade],
  imports: [
    RouterLink,
    KpiCardComponent,
    SkeletonLoaderComponent,
    DepartmentBarChartComponent,
    CategoryDonutChartComponent,
  ],
  template: `
    <section class="page" aria-labelledby="dashboard-title" [attr.aria-busy]="facade.loading()">
      <header class="page-header">
        <div>
          <h1 id="dashboard-title">Budget overview</h1>
          <p>{{ scopeLabel() }}</p>
        </div>
        <div class="cluster">
          <button type="button" class="btn" (click)="facade.load()" [disabled]="facade.loading()">Refresh</button>
          <a class="btn btn--primary" routerLink="/expenses">Review expenses</a>
        </div>
      </header>

      @if (facade.error(); as error) {
        <div class="card alert" role="alert">
          <p><strong>Budget data unavailable.</strong> {{ error }}</p>
          <button type="button" class="btn" (click)="facade.load()">Try again</button>
        </div>
      }

      <section aria-label="Key performance indicators">
        @if (facade.kpis(); as k) {
          <ul class="kpi-grid">
            <li>
              <app-kpi-card label="Total budget" [value]="eur(k.allocated)" hint="Allocated for the fiscal year" />
            </li>
            <li>
              <app-kpi-card
                label="Approved spend"
                [value]="eur(k.spent)"
                [hint]="k.approvedCount + ' approved invoices'"
                tone="positive"
              />
            </li>
            <li>
              <app-kpi-card
                label="Pending approval"
                [value]="eur(k.pending)"
                [hint]="k.pendingCount + ' invoices awaiting decision'"
                [tone]="k.pendingCount > 0 ? 'warning' : 'neutral'"
              />
            </li>
            <li>
              <app-kpi-card
                label="Budget committed"
                [value]="k.utilisation + '%'"
                [hint]="
                  k.overBudgetDepartments > 0
                    ? k.overBudgetDepartments + ' department(s) over budget'
                    : eur(k.remaining) + ' remaining'
                "
                [tone]="k.overBudgetDepartments > 0 ? 'critical' : k.utilisation > 80 ? 'warning' : 'positive'"
              />
            </li>
          </ul>
        } @else {
          <app-skeleton-loader [rows]="3" label="Loading key indicators…" />
        }
      </section>

      <div class="chart-grid">
        <section class="card">
          @defer (on viewport) {
            <app-department-bar-chart [data]="facade.departments()" />
          } @placeholder (minimum 200ms) {
            <app-skeleton-loader [rows]="6" height="16rem" label="Loading department chart…" />
          } @loading (after 100ms; minimum 300ms) {
            <app-skeleton-loader [rows]="6" height="16rem" label="Loading department chart…" />
          } @error {
            <p role="alert">The department chart could not be loaded. Use the expenses table instead.</p>
          }
        </section>

        <section class="card">
          @defer (on viewport) {
            <app-category-donut-chart [data]="facade.categories()" />
          } @placeholder (minimum 200ms) {
            <app-skeleton-loader [rows]="6" height="16rem" label="Loading category chart…" />
          } @loading (after 100ms; minimum 300ms) {
            <app-skeleton-loader [rows]="6" height="16rem" label="Loading category chart…" />
          } @error {
            <p role="alert">The category chart could not be loaded.</p>
          }
        </section>
      </div>
    </section>
  `,
  styles: `
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: var(--space-4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
      gap: var(--space-4);
    }
    .alert {
      border-inline-start: 4px solid var(--color-danger);
    }
  `,
})
export class DashboardPageComponent {
  protected readonly facade = inject(DashboardFacade);
  private readonly roles = inject(RoleService);

  protected readonly scopeLabel = computed(() => {
    const session = this.roles.session();
    return session === null
      ? 'Establishing a secure session…'
      : `Showing ${session.scope.length} department(s) in your authorised scope.`;
  });

  constructor() {
    // Reload whenever the authenticated session changes (role switch or secure reset).
    effect(() => {
      if (this.roles.session() !== null) untracked(() => this.facade.load());
    });
  }

  protected eur(amount: number): string {
    return formatEurCompact(amount);
  }
}
