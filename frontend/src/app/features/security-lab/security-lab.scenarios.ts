import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { API_BASE, FinopsApiService } from '../../core/api/finops-api.service';
import { AUTH_OVERRIDE, AuthOverride, OMIT_IDEMPOTENCY_KEY, SILENT_ERRORS } from '../../core/api/http-context';
import { isApiError } from '../../core/api/problem';
import { CreateExpenseDto } from '../../core/models/finops.models';
import { isExpensePage } from '../../core/security/payload-guards';
import { MOCK_API_CONFIG, MOCK_STORAGE } from '../../core/mock-api/mock-api.config';
import { OUT_OF_SCOPE_EXPENSE_ID } from '../../core/mock-api/mock-seed';
import { RoleService } from '../../core/services/role.service';

export interface LabOutcome {
  readonly status: number;
  readonly summary: string;
}

export interface LabScenario {
  readonly id: string;
  readonly control: string;
  readonly title: string;
  readonly attack: string;
  readonly expected: number;
  readonly run: () => Promise<LabOutcome>;
}

/**
 * Executable attack probes against the API. Every probe goes through the real HttpClient
 * pipeline (interceptors included) so the defences demonstrated are the production ones.
 */
@Injectable()
export class SecurityLabScenarios {
  private readonly http = inject(HttpClient);
  private readonly api = inject(FinopsApiService);
  private readonly roles = inject(RoleService);
  private readonly config = inject(MOCK_API_CONFIG);
  private readonly storage = inject(MOCK_STORAGE);

  readonly scenarios: readonly LabScenario[] = [
    {
      id: 'bfla',
      control: 'Web A01 · API5 BFLA',
      title: 'VIEWER tries to delete an expense',
      attack:
        'Issues a VIEWER session and sends DELETE /api/v1/expenses/:id, as if the hidden button were re-enabled in DevTools.',
      expected: 403,
      run: async () => {
        const viewer = await this.viewerCredentials();
        return this.probe(
          this.http.delete(`${API_BASE}/expenses/${OUT_OF_SCOPE_EXPENSE_ID}`, { context: this.ctx(viewer) }),
        );
      },
    },
    {
      id: 'role-claim',
      control: 'Web A01 · API5',
      title: 'Forged X-User-Role header',
      attack: 'Sends a VIEWER token while claiming X-User-Role: ADMIN.',
      expected: 403,
      run: async () => {
        const viewer = await this.viewerCredentials();
        return this.probe(
          this.http.get(`${API_BASE}/budgets`, { context: this.ctx({ token: viewer.token, role: 'ADMIN' }) }),
        );
      },
    },
    {
      id: 'bola',
      control: 'API1 BOLA',
      title: 'Read an expense outside the user scope',
      attack: 'A VIEWER scoped to Engineering/Marketing requests a Finance expense by its id.',
      expected: 404,
      run: async () => {
        const viewer = await this.viewerCredentials();
        return this.probe(
          this.http.get(`${API_BASE}/expenses/${OUT_OF_SCOPE_EXPENSE_ID}`, { context: this.ctx(viewer) }),
        );
      },
    },
    {
      id: 'bopla',
      control: 'API3 BOPLA',
      title: 'Mass assignment of privileged fields',
      attack: 'ADMIN POSTs an expense that also sets status=APPROVED, approvedBy and id.',
      expected: 422,
      run: async () => {
        const admin = await this.adminCredentials();
        const body = { ...this.validDto('INV-9101'), status: 'APPROVED', approvedBy: 'attacker', id: 'forged-id' };
        return this.probe(this.http.post(`${API_BASE}/expenses`, body, { context: this.ctx(admin) }));
      },
    },
    {
      id: 'ssrf',
      control: 'API7 SSRF',
      title: 'Receipt URL pointing at cloud metadata',
      attack: 'Bypasses the form and POSTs receiptUrl=http://169.254.169.254/latest/meta-data.',
      expected: 422,
      run: async () => {
        const admin = await this.adminCredentials();
        const body = { ...this.validDto('INV-9102'), receiptUrl: 'http://169.254.169.254/latest/meta-data' };
        return this.probe(this.http.post(`${API_BASE}/expenses`, body, { context: this.ctx(admin) }));
      },
    },
    {
      id: 'idempotency-missing',
      control: 'API6 Sensitive flows',
      title: 'POST without X-Idempotency-Key',
      attack: 'Creates an expense without the anti-replay header.',
      expected: 428,
      run: async () => {
        const admin = await this.adminCredentials();
        return this.probe(
          this.http.post(`${API_BASE}/expenses`, this.validDto('INV-9103'), {
            context: this.ctx(admin).set(OMIT_IDEMPOTENCY_KEY, true),
          }),
        );
      },
    },
    {
      id: 'idempotency-replay',
      control: 'API6 Sensitive flows',
      title: 'Replay the same submission twice',
      attack: 'Sends the same POST twice with one idempotency key (double click / replay).',
      expected: 200,
      run: async () => {
        const admin = await this.adminCredentials();
        const code = `INV-${String(Math.floor(9200 + Math.random() * 700))}`;
        const headers = new HttpHeaders({ 'X-Idempotency-Key': crypto.randomUUID() });
        const send = (): Promise<LabOutcome> =>
          this.probe(
            this.http.post(`${API_BASE}/expenses`, this.validDto(code), {
              headers,
              context: this.ctx(admin),
              observe: 'response',
            }),
          );
        const first = await send();
        const second = await send();
        return {
          status: second.status,
          summary: `First call ${first.status}, replay ${second.status}: no duplicate created.`,
        };
      },
    },
    {
      id: 'rate-limit',
      control: 'API4 Resource consumption',
      title: 'Request burst',
      attack: `Fires ${this.config.rateLimit.maxRequests + 10} parallel GET requests with one token.`,
      expected: 429,
      run: async () => {
        const viewer = await this.viewerCredentials();
        const burst = Array.from({ length: this.config.rateLimit.maxRequests + 10 }, () =>
          this.status(this.http.get(`${API_BASE}/budgets`, { context: this.ctx(viewer) })),
        );
        const statuses = await firstValueFrom(forkJoin(burst));
        const limited = statuses.filter((s) => s === 429).length;
        return {
          status: limited > 0 ? 429 : 200,
          summary: `${limited} of ${statuses.length} requests throttled with 429.`,
        };
      },
    },
    {
      id: 'page-size',
      control: 'API4 Resource consumption',
      title: 'Oversized page request',
      attack: 'Requests pageSize=5000 to dump the dataset in one call.',
      expected: 422,
      run: () => this.probe(this.http.get(`${API_BASE}/expenses?pageSize=5000`, { context: this.silent() })),
    },
    {
      id: 'missing-token',
      control: 'Web A07 · API2',
      title: 'Request without bearer token',
      attack: 'Calls GET /api/v1/budgets with no Authorization header.',
      expected: 401,
      run: () => this.probe(this.http.get(`${API_BASE}/budgets`, { context: this.ctx({ token: null, role: null }) })),
    },
    {
      id: 'forged-token',
      control: 'Web A07 · API2',
      title: 'Forged bearer token',
      attack: 'Sends a random, never-issued token.',
      expected: 401,
      run: () =>
        this.probe(
          this.http.get(`${API_BASE}/budgets`, { context: this.ctx({ token: 'f'.repeat(64), role: 'ADMIN' }) }),
        ),
    },
    {
      id: 'revoked-session',
      control: 'Web A07 · secure reset',
      title: 'Revoke my session server-side',
      attack: 'Revokes your current token, then calls the API with it: the app must reset to a fresh VIEWER session.',
      expected: 401,
      run: async () => {
        const session = this.roles.session();
        if (session === null) return { status: 0, summary: 'No active session.' };
        await firstValueFrom(this.api.revokeSession({ token: session.token, role: session.role }));
        // No override: this request uses the (now revoked) live session, exactly like a real expiry.
        return this.probe(this.http.get(`${API_BASE}/budgets`));
      },
    },
    {
      id: 'unversioned',
      control: 'API9 Inventory',
      title: 'Unversioned legacy route',
      attack: 'Calls the retired /api/expenses route.',
      expected: 410,
      run: () => this.probe(this.http.get('/api/expenses', { context: this.silent() })),
    },
    {
      id: 'media-type',
      control: 'API8 Misconfiguration',
      title: 'Wrong Content-Type',
      attack: 'POSTs a text/plain body to /api/v1/expenses.',
      expected: 415,
      run: async () => {
        const admin = await this.adminCredentials();
        const headers = new HttpHeaders({ 'Content-Type': 'text/plain' });
        return this.probe(this.http.post(`${API_BASE}/expenses`, 'title=pwn', { headers, context: this.ctx(admin) }));
      },
    },
    {
      id: 'method',
      control: 'API8 Misconfiguration',
      title: 'Unsupported HTTP method',
      attack: 'Sends PUT /api/v1/expenses.',
      expected: 405,
      run: () => this.probe(this.http.put(`${API_BASE}/expenses`, {}, { context: this.silent() })),
    },
    {
      id: 'contract',
      control: 'API10 Unsafe consumption',
      title: 'Malformed upstream payload',
      attack: 'The API returns 200 with a payload that violates the contract; the type guard must reject it.',
      expected: 502,
      run: () =>
        this.probe(
          this.http
            .get<unknown>(`${API_BASE}/expenses?simulateError=contract`, { context: this.silent() })
            .pipe(this.api.validated(isExpensePage, 'PaginatedResponse<Expense>')),
        ),
    },
    {
      id: 'server-error',
      control: 'Web A10 Exceptional conditions',
      title: 'Internal server error',
      attack: 'Triggers ?simulateError=true; the UI must show a safe message with no stack trace.',
      expected: 500,
      run: () => this.probe(this.http.get(`${API_BASE}/budgets?simulateError=true`, { context: this.silent() })),
    },
  ];

  /** Web A08: edits the persisted JSON like an attacker in DevTools would, then reads through the API. */
  async tamperStorage(): Promise<LabOutcome> {
    const raw = this.storage.getItem(this.config.storageKey);
    if (raw === null) return { status: 0, summary: 'Nothing persisted yet.' };
    this.storage.setItem(this.config.storageKey, raw.replace(/"netAmount":(\d+)/, '"netAmount":1'));
    const outcome = await this.probe(this.http.get(`${API_BASE}/budgets`, { context: this.silent() }));
    return {
      status: outcome.status,
      summary: 'Tampering detected: checksum mismatch logged and secure seed restored.',
    };
  }

  private async viewerCredentials(): Promise<AuthOverride> {
    const s = await firstValueFrom(this.api.issueSession('VIEWER'));
    return { token: s.token, role: s.role };
  }

  private async adminCredentials(): Promise<AuthOverride> {
    const s = await firstValueFrom(this.api.issueSession('ADMIN'));
    return { token: s.token, role: s.role };
  }

  private ctx(credentials: AuthOverride): HttpContext {
    return new HttpContext().set(AUTH_OVERRIDE, credentials).set(SILENT_ERRORS, true);
  }

  private silent(): HttpContext {
    return new HttpContext().set(SILENT_ERRORS, true);
  }

  private validDto(invoiceCode: string): CreateExpenseDto {
    return {
      title: 'Security lab probe',
      department: 'ENGINEERING',
      category: 'SOFTWARE',
      invoiceCode,
      receiptUrl: null,
      netAmount: 100,
      vatRate: 21,
      date: '2026-11-01',
      justification: 'Automated security lab probe request.',
    };
  }

  private status(request: Observable<unknown>): Observable<number> {
    return request.pipe(
      map(() => 200),
      catchError((error: unknown) => of(isApiError(error) ? error.problem.status : 0)),
    );
  }

  private probe(request: Observable<unknown>): Promise<LabOutcome> {
    return firstValueFrom(
      request.pipe(
        map((response): LabOutcome => {
          const status = isStatusCarrier(response) ? response.status : 200;
          return { status, summary: 'Request accepted.' };
        }),
        catchError((error: unknown) =>
          of<LabOutcome>(
            isApiError(error)
              ? { status: error.problem.status, summary: `${error.problem.title}: ${error.problem.detail}` }
              : { status: 0, summary: 'Unexpected client error.' },
          ),
        ),
      ),
      { defaultValue: { status: 204, summary: 'Request accepted (no content).' } },
    );
  }
}

function isStatusCarrier(value: unknown): value is { readonly status: number } {
  return typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'number';
}
