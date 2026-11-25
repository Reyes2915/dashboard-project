import { ChangeDetectionStrategy, Component, ElementRef, computed, input, signal, viewChildren } from '@angular/core';
import { formatEur, formatEurCompact } from '../../../../core/domain/money';
import { BudgetSummary } from '../../../../core/models/finops.models';

interface BarRow {
  readonly key: string;
  readonly label: string;
  readonly y: number;
  readonly spentWidth: number;
  readonly pendingX: number;
  readonly pendingWidth: number;
  readonly allocatedX: number;
  readonly over: boolean;
  readonly summary: string;
  readonly valueLabel: string;
}

const WIDTH = 640;
const LABEL_WIDTH = 120;
const VALUE_WIDTH = 84;
const ROW_HEIGHT = 44;
const BAR_HEIGHT = 16;
const PLOT_WIDTH = WIDTH - LABEL_WIDTH - VALUE_WIDTH;
const GAP = 2;

/**
 * Budget vs. committed spend per department as native SVG.
 * Keyboard: Tab into the chart, Arrow Up/Down (or Left/Right), Home/End move between bars.
 * Each bar exposes a full text alternative; a data table is available for AT and print.
 */
@Component({
  selector: 'app-department-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="chart">
      <figcaption class="chart__caption">
        <h2 [id]="titleId">Budget utilisation by department</h2>
        <ul class="legend" aria-label="Legend">
          <li><span class="swatch swatch--spent" aria-hidden="true"></span>Approved spend</li>
          <li><span class="swatch swatch--pending" aria-hidden="true"></span>Pending approval</li>
          <li><span class="swatch swatch--track" aria-hidden="true"></span>Remaining budget</li>
          <li><span class="swatch swatch--limit" aria-hidden="true"></span>Budget limit</li>
        </ul>
      </figcaption>

      <svg
        class="chart__svg"
        [attr.viewBox]="'0 0 ' + width + ' ' + height()"
        preserveAspectRatio="xMinYMin meet"
        role="group"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="hintId"
      >
        <g role="list">
          @for (row of rows(); track row.key; let i = $index) {
            <g
              #bar
              role="listitem"
              class="bar"
              [class.bar--active]="activeIndex() === i"
              [attr.tabindex]="i === focusIndex() ? 0 : -1"
              [attr.aria-label]="row.summary"
              (focus)="activate(i)"
              (blur)="activeIndex.set(null)"
              (mouseenter)="activeIndex.set(i)"
              (mouseleave)="activeIndex.set(null)"
              (keydown)="onKeydown($event, i)"
            >
              <rect class="bar__hit" x="0" [attr.y]="row.y - 6" [attr.width]="width" [attr.height]="rowHeight" />
              <text class="bar__label" x="0" [attr.y]="row.y + 12">{{ row.label }}</text>
              <rect
                class="bar__track"
                [attr.x]="labelWidth"
                [attr.y]="row.y"
                [attr.width]="plotWidth"
                [attr.height]="barHeight"
                rx="4"
              />
              @if (row.spentWidth > 0) {
                <rect
                  class="bar__spent"
                  [attr.x]="labelWidth"
                  [attr.y]="row.y"
                  [attr.width]="row.spentWidth"
                  [attr.height]="barHeight"
                  rx="4"
                />
              }
              @if (row.pendingWidth > 0) {
                <rect
                  class="bar__pending"
                  [attr.x]="row.pendingX"
                  [attr.y]="row.y"
                  [attr.width]="row.pendingWidth"
                  [attr.height]="barHeight"
                  rx="4"
                />
              }
              <line
                class="bar__limit"
                [attr.x1]="row.allocatedX"
                [attr.x2]="row.allocatedX"
                [attr.y1]="row.y - 4"
                [attr.y2]="row.y + barHeight + 4"
              />
              <text class="bar__value" [attr.x]="width" [attr.y]="row.y + 12" text-anchor="end">
                {{ row.over ? '⚠ ' : '' }}{{ row.valueLabel }}
              </text>
            </g>
          }
        </g>
      </svg>

      <p class="chart__detail" aria-live="polite">{{ detail() }}</p>
      <p class="visually-hidden" [id]="hintId">Use arrow keys to move between departments.</p>

      <details class="chart__table">
        <summary>Show data table</summary>
        <table class="data-table">
          <caption class="visually-hidden">
            Budget by department
          </caption>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col" class="num">Allocated</th>
              <th scope="col" class="num">Approved</th>
              <th scope="col" class="num">Pending</th>
            </tr>
          </thead>
          <tbody>
            @for (d of data(); track d.department) {
              <tr>
                <th scope="row">{{ d.department }}</th>
                <td class="num">{{ eur(d.allocated) }}</td>
                <td class="num">{{ eur(d.spent) }}</td>
                <td class="num">{{ eur(d.pending) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </details>
    </figure>
  `,
  styleUrl: './department-bar-chart.component.scss',
})
export class DepartmentBarChartComponent {
  private static nextId = 0;

  readonly data = input.required<readonly BudgetSummary[]>();

  protected readonly width = WIDTH;
  protected readonly labelWidth = LABEL_WIDTH;
  protected readonly plotWidth = PLOT_WIDTH;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly titleId = `bar-chart-title-${DepartmentBarChartComponent.nextId}`;
  protected readonly hintId = `bar-chart-hint-${DepartmentBarChartComponent.nextId++}`;

  protected readonly activeIndex = signal<number | null>(null);
  protected readonly focusIndex = signal(0);
  private readonly bars = viewChildren<ElementRef<SVGGElement>>('bar');

  protected readonly height = computed(() => Math.max(1, this.data().length) * ROW_HEIGHT + 8);

  protected readonly rows = computed<readonly BarRow[]>(() => {
    const data = this.data();
    const max = Math.max(1, ...data.map((d) => Math.max(d.allocated, d.spent + d.pending)));
    const scale = (v: number): number => (v / max) * PLOT_WIDTH;
    return data.map((d, i) => {
      const spentWidth = scale(d.spent);
      const pendingWidth = Math.max(0, scale(d.pending) - (d.spent > 0 ? GAP : 0));
      const committed = d.spent + d.pending;
      const pct = d.allocated === 0 ? 0 : Math.round((committed / d.allocated) * 100);
      return {
        key: d.department,
        label: titleCase(d.department),
        y: i * ROW_HEIGHT + 12,
        spentWidth,
        pendingX: LABEL_WIDTH + spentWidth + (d.spent > 0 ? GAP : 0),
        pendingWidth,
        allocatedX: LABEL_WIDTH + scale(d.allocated),
        over: committed > d.allocated,
        valueLabel: `${pct}%`,
        summary: `${titleCase(d.department)}: ${formatEur(d.spent)} approved and ${formatEur(d.pending)} pending of ${formatEur(d.allocated)} budget, ${pct}% committed${committed > d.allocated ? ', over budget' : ''}.`,
      };
    });
  });

  protected readonly detail = computed(() => {
    const index = this.activeIndex();
    const row = index === null ? undefined : this.rows()[index];
    return row?.summary ?? 'Hover or focus a department to see details.';
  });

  protected eur(amount: number): string {
    return formatEurCompact(amount);
  }

  protected activate(index: number): void {
    this.activeIndex.set(index);
    this.focusIndex.set(index);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.rows().length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? Math.min(last, index + 1)
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    this.focusIndex.set(next);
    this.bars()[next]?.nativeElement.focus();
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
