import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Loading placeholder. Announced once via role="status"; the shimmer itself is hidden from AT. */
@Component({
  selector: 'app-skeleton-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skeleton" role="status" [style.--skeleton-height]="height()">
      <span class="visually-hidden">{{ label() }}</span>
      @for (row of rowList(); track row) {
        <span class="skeleton__bar" aria-hidden="true" [style.inline-size.%]="row"></span>
      }
    </div>
  `,
  styles: `
    .skeleton {
      display: grid;
      gap: var(--space-3);
      min-block-size: var(--skeleton-height, auto);
      align-content: start;
    }
    .skeleton__bar {
      display: block;
      block-size: 0.9rem;
      border-radius: var(--radius-sm);
      background: linear-gradient(
        90deg,
        var(--color-surface-2) 25%,
        var(--color-border) 50%,
        var(--color-surface-2) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer {
      from {
        background-position: 200% 0;
      }
      to {
        background-position: -200% 0;
      }
    }
  `,
})
export class SkeletonLoaderComponent {
  readonly rows = input(4);
  readonly height = input('auto');
  readonly label = input('Loading content…');

  /** Deterministic varied widths so layout does not jump between renders. */
  protected readonly rowList = computed(() =>
    Array.from({ length: Math.max(1, this.rows()) }, (_, i) => 100 - ((i * 17) % 45)),
  );
}
