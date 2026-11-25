import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LabOutcome, LabScenario, SecurityLabScenarios } from './security-lab.scenarios';

interface ResultState {
  readonly running: boolean;
  readonly outcome: LabOutcome | null;
  readonly passed: boolean | null;
}

const IDLE: ResultState = { running: false, outcome: null, passed: null };

/**
 * Interactive OWASP verification console for live demos and interviews.
 * Each card fires a real attack through the HTTP pipeline and shows the defensive response;
 * the Security audit log (header button) records the server-side view of the same event.
 */
@Component({
  selector: 'app-security-lab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SecurityLabScenarios],
  template: `
    <section class="page" aria-labelledby="lab-title">
      <header class="page-header">
        <div>
          <h1 id="lab-title">Security lab</h1>
          <p>
            Run real attacks against the API and verify each OWASP Top 10 Web &amp; API defence. Open the audit log to
            see what the server recorded.
          </p>
        </div>
        <button type="button" class="btn btn--primary" [disabled]="runningAll()" (click)="runAll()">
          {{ runningAll() ? 'Running…' : 'Run all probes' }}
        </button>
      </header>

      <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>

      <ul class="lab-grid">
        @for (scenario of lab.scenarios; track scenario.id) {
          @let state = results()[scenario.id] ?? idle;
          <li class="card probe" [attr.data-result]="state.passed === null ? 'idle' : state.passed ? 'pass' : 'fail'">
            <p class="probe__control">{{ scenario.control }}</p>
            <h2 class="probe__title">{{ scenario.title }}</h2>
            <p class="probe__attack">{{ scenario.attack }}</p>
            <p class="probe__expected">
              Expected: <strong>HTTP {{ scenario.expected }}</strong>
            </p>
            @if (state.outcome; as outcome) {
              <p class="probe__outcome">
                <span aria-hidden="true">{{ state.passed ? '✓' : '✕' }}</span>
                <strong>{{ state.passed ? 'Blocked as expected' : 'Unexpected result' }}</strong>
                — HTTP {{ outcome.status }}. {{ outcome.summary }}
              </p>
            }
            <button type="button" class="btn btn--sm" [disabled]="state.running" (click)="run(scenario)">
              {{ state.running ? 'Running…' : 'Run probe' }}<span class="visually-hidden">: {{ scenario.title }}</span>
            </button>
          </li>
        }

        @let tamper = results()['tamper'] ?? idle;
        <li class="card probe" [attr.data-result]="tamper.passed === null ? 'idle' : tamper.passed ? 'pass' : 'fail'">
          <p class="probe__control">Web A08 Data integrity</p>
          <h2 class="probe__title">Tamper with persisted state</h2>
          <p class="probe__attack">
            Edits the signed JSON in localStorage (like DevTools would) and reads through the API.
          </p>
          <p class="probe__expected">Expected: <strong>tampering detected, seed restored</strong></p>
          @if (tamper.outcome; as outcome) {
            <p class="probe__outcome">
              <span aria-hidden="true">{{ tamper.passed ? '✓' : '✕' }}</span> {{ outcome.summary }}
            </p>
          }
          <button type="button" class="btn btn--sm" [disabled]="tamper.running" (click)="runTamper()">
            Run probe<span class="visually-hidden">: tamper with persisted state</span>
          </button>
        </li>
      </ul>
    </section>
  `,
  styles: `
    .lab-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
      gap: var(--space-4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .probe {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      border-inline-start: 4px solid var(--color-border-strong);
    }
    .probe[data-result='pass'] {
      border-inline-start-color: var(--color-success);
    }
    .probe[data-result='fail'] {
      border-inline-start-color: var(--color-danger);
    }
    .probe > * {
      margin: 0;
    }
    .probe__control {
      font-size: var(--text-xs);
      font-weight: 700;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .probe__title {
      font-size: var(--text-md);
    }
    .probe__attack,
    .probe__expected {
      font-size: var(--text-sm);
      color: var(--color-text-secondary);
    }
    .probe__outcome {
      font-size: var(--text-sm);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--color-surface-2);
      overflow-wrap: anywhere;
    }
    .probe .btn {
      margin-block-start: auto;
      align-self: flex-start;
    }
  `,
})
export class SecurityLabComponent {
  protected readonly lab = inject(SecurityLabScenarios);
  protected readonly idle = IDLE;
  protected readonly results = signal<Readonly<Record<string, ResultState>>>({});
  protected readonly runningAll = signal(false);
  protected readonly announcement = signal('');

  protected async run(scenario: LabScenario): Promise<void> {
    this.patch(scenario.id, { running: true, outcome: null, passed: null });
    const outcome = await scenario.run();
    const passed = outcome.status === scenario.expected;
    this.patch(scenario.id, { running: false, outcome, passed });
    this.announcement.set(
      `${scenario.title}: HTTP ${outcome.status}, ${passed ? 'blocked as expected' : 'unexpected result'}.`,
    );
  }

  protected async runTamper(): Promise<void> {
    this.patch('tamper', { running: true, outcome: null, passed: null });
    const outcome = await this.lab.tamperStorage();
    this.patch('tamper', { running: false, outcome, passed: outcome.status === 200 });
    this.announcement.set(outcome.summary);
  }

  protected async runAll(): Promise<void> {
    this.runningAll.set(true);
    // Sequential on purpose: the rate-limit probe must not starve the others.
    for (const scenario of this.lab.scenarios) await this.run(scenario);
    await this.runTamper();
    this.runningAll.set(false);
    const states = Object.values(this.results());
    this.announcement.set(
      `All probes finished: ${states.filter((s) => s.passed).length} of ${states.length} defences verified.`,
    );
  }

  private patch(id: string, state: ResultState): void {
    this.results.update((all) => ({ ...all, [id]: state }));
  }
}
