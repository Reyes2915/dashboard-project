import { ChangeDetectionStrategy, Component, ElementRef, computed, input, signal, viewChildren } from '@angular/core';
import { formatEur, formatEurCompact } from '../../../../core/domain/money';
import { CategorySpend, EXPENSE_CATEGORIES } from '../../../../core/models/finops.models';

interface Segment {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly dashArray: string;
  readonly dashOffset: number;
  readonly share: number;
  readonly amount: number;
  readonly summary: string;
}

const RADIUS = 70;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2;

/**
 * Committed spend by category as an SVG donut. Colour follows the category (fixed order),
 * never its rank, and identity is always repeated in text (legend with values + data table).
 */
@Component({
  selector: 'app-category-donut-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="donut">
      <figcaption><h2 [id]="titleId">Committed spend by category</h2></figcaption>

      <div class="donut__body">
        <svg class="donut__svg" viewBox="0 0 200 200" role="group" [attr.aria-labelledby]="titleId">
          <g role="list" transform="rotate(-90 100 100)">
            @for (s of segments(); track s.key; let i = $index) {
              <circle
                #segment
                role="listitem"
                class="segment"
                [class.segment--active]="activeIndex() === i"
                cx="100"
                cy="100"
                [attr.r]="radius"
                [attr.stroke]="s.color"
                [attr.stroke-width]="activeIndex() === i ? stroke + 6 : stroke"
                [attr.stroke-dasharray]="s.dashArray"
                [attr.stroke-dashoffset]="s.dashOffset"
                [attr.tabindex]="i === focusIndex() ? 0 : -1"
                [attr.aria-label]="s.summary"
                (focus)="activate(i)"
                (blur)="activeIndex.set(null)"
                (mouseenter)="activeIndex.set(i)"
                (mouseleave)="activeIndex.set(null)"
                (keydown)="onKeydown($event, i)"
              />
            }
          </g>
          <text class="donut__center-value" x="100" y="98" text-anchor="middle">{{ centerValue() }}</text>
          <text class="donut__center-label" x="100" y="118" text-anchor="middle">{{ centerLabel() }}</text>
        </svg>

        <ul class="legend" aria-label="Categories">
          @for (s of segments(); track s.key; let i = $index) {
            <li [class.legend__item--active]="activeIndex() === i">
              <span class="swatch" aria-hidden="true" [style.background]="s.color"></span>
              <span class="legend__label">{{ s.label }}</span>
              <span class="legend__value">{{ s.share }}%</span>
            </li>
          }
        </ul>
      </div>
      <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>

      <details class="donut__table">
        <summary>Show data table</summary>
        <table class="data-table">
          <caption class="visually-hidden">
            Committed spend by category
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" class="num">Amount</th>
              <th scope="col" class="num">Share</th>
            </tr>
          </thead>
          <tbody>
            @for (s of segments(); track s.key) {
              <tr>
                <th scope="row">{{ s.label }}</th>
                <td class="num">{{ eur(s.amount) }}</td>
                <td class="num">{{ s.share }}%</td>
              </tr>
            }
          </tbody>
        </table>
      </details>
    </figure>
  `,
  styleUrl: './category-donut-chart.component.scss',
})
export class CategoryDonutChartComponent {
  private static nextId = 0;

  readonly data = input.required<readonly CategorySpend[]>();

  protected readonly radius = RADIUS;
  protected readonly stroke = STROKE;
  protected readonly titleId = `donut-title-${CategoryDonutChartComponent.nextId++}`;
  protected readonly activeIndex = signal<number | null>(null);
  protected readonly focusIndex = signal(0);
  private readonly segmentRefs = viewChildren<ElementRef<SVGCircleElement>>('segment');

  private readonly total = computed(() => this.data().reduce((acc, c) => acc + c.amount, 0));

  protected readonly segments = computed<readonly Segment[]>(() => {
    const total = this.total();
    let offset = 0;
    return this.data().map((c) => {
      const length = total === 0 ? 0 : (c.amount / total) * CIRCUMFERENCE;
      const visible = Math.max(0, length - GAP);
      const share = total === 0 ? 0 : Math.round((c.amount / total) * 1000) / 10;
      const label = c.category.charAt(0) + c.category.slice(1).toLowerCase();
      const segment: Segment = {
        key: c.category,
        label,
        color: `var(--viz-series-${EXPENSE_CATEGORIES.indexOf(c.category) + 1})`,
        dashArray: `${visible} ${CIRCUMFERENCE - visible}`,
        dashOffset: -offset,
        share,
        amount: c.amount,
        summary: `${label}: ${formatEur(c.amount)}, ${share}% of committed spend.`,
      };
      offset += length;
      return segment;
    });
  });

  private readonly active = computed(() => {
    const index = this.activeIndex();
    return index === null ? undefined : this.segments()[index];
  });

  protected readonly centerValue = computed(() => formatEurCompact(this.active()?.amount ?? this.total()));
  protected readonly centerLabel = computed(() => this.active()?.label ?? 'Total committed');
  protected readonly announcement = computed(() => this.active()?.summary ?? '');

  protected eur(amount: number): string {
    return formatEur(amount);
  }

  protected activate(index: number): void {
    this.activeIndex.set(index);
    this.focusIndex.set(index);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const count = this.segments().length;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % count
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    this.focusIndex.set(next);
    this.segmentRefs()[next]?.nativeElement.focus();
  }
}
