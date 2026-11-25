import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type KpiTone = 'neutral' | 'positive' | 'warning' | 'critical';

/** Single headline metric. Tone is conveyed by text + icon, never by colour alone. */
@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="kpi" [attr.data-tone]="tone()" [attr.aria-labelledby]="labelId">
      <h3 class="kpi__label" [id]="labelId">{{ label() }}</h3>
      <p class="kpi__value">{{ value() }}</p>
      @if (hint()) {
        <p class="kpi__hint">
          @switch (tone()) {
            @case ('positive') {
              <span aria-hidden="true">▲</span>
            }
            @case ('warning') {
              <span aria-hidden="true">●</span>
            }
            @case ('critical') {
              <span aria-hidden="true">▼</span>
            }
          }
          {{ hint() }}
        </p>
      }
    </article>
  `,
  styles: `
    .kpi {
      display: grid;
      gap: var(--space-1);
      block-size: 100%;
      padding: var(--space-4) var(--space-5);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-inline-start: 4px solid var(--color-border-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-1);
    }
    .kpi[data-tone='positive'] {
      border-inline-start-color: var(--color-success);
    }
    .kpi[data-tone='warning'] {
      border-inline-start-color: var(--color-warning);
    }
    .kpi[data-tone='critical'] {
      border-inline-start-color: var(--color-danger);
    }
    .kpi__label {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-secondary);
      font-weight: 600;
    }
    .kpi__value {
      margin: 0;
      font-size: var(--text-2xl);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .kpi__hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }
  `,
})
export class KpiCardComponent {
  private static nextId = 0;

  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string>('');
  readonly tone = input<KpiTone>('neutral');

  protected readonly labelId = `kpi-label-${KpiCardComponent.nextId++}`;
}
