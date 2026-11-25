import { HttpClient, HttpErrorResponse, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { MemoryStorage } from '../../../testing/memory-storage';
import { DEFAULT_MOCK_API_CONFIG, MOCK_API_CONFIG, MOCK_STORAGE, MockApiConfig } from '../mock-api/mock-api.config';
import { OUT_OF_SCOPE_EXPENSE_ID } from '../mock-api/mock-seed';
import { CreateExpenseDto, UserRole } from '../models/finops.models';
import { isExpense, isExpensePage, isProblemDetail, isSessionInfo } from '../security/payload-guards';
import { SecurityAuditService } from '../services/security-audit.service';
import { mockApiInterceptor } from './mock-api.interceptor';

interface Reply {
  readonly status: number;
  readonly body: unknown;
  readonly headers: HttpHeaders;
}

interface CallOptions {
  readonly token?: string | null;
  readonly role?: string | null;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

const ENGINEERING_EXPENSE_ID = '5f0c1a2e-4b1d-4c8e-9a01-0e1f2a3b4c03'; // PENDING
const APPROVED_EXPENSE_ID = '5f0c1a2e-4b1d-4c8e-9a01-0e1f2a3b4c01';

const VALID_DTO: CreateExpenseDto = {
  title: 'Unit test licence',
  department: 'ENGINEERING',
  category: 'SOFTWARE',
  invoiceCode: 'INV-7001',
  receiptUrl: 'https://vendor.example.com/r/7001.pdf',
  netAmount: 1000,
  vatRate: 21,
  date: '2026-11-01',
  justification: 'Required for the unit test suite.',
};

describe('MockApiInterceptor (simulated /api/v1 server)', () => {
  let http: HttpClient;
  let storage: MemoryStorage;
  let audit: SecurityAuditService;
  let clock: number;

  function setup(overrides: Partial<MockApiConfig> = {}): void {
    clock = Date.UTC(2026, 10, 18, 9, 0, 0);
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([mockApiInterceptor])),
        {
          provide: MOCK_API_CONFIG,
          useValue: {
            ...DEFAULT_MOCK_API_CONFIG,
            latencyMs: 0,
            rateLimit: { maxRequests: 1000, windowMs: 10_000 },
            now: () => clock,
            ...overrides,
          } satisfies MockApiConfig,
        },
        { provide: MOCK_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpClient);
    audit = TestBed.inject(SecurityAuditService);
  }

  async function call(method: string, url: string, options: CallOptions = {}): Promise<Reply> {
    let headers = new HttpHeaders(options.headers ?? {});
    if (options.token) headers = headers.set('Authorization', `Bearer ${options.token}`);
    if (options.role) headers = headers.set('X-User-Role', options.role);
    if (options.body !== undefined && !headers.has('Content-Type'))
      headers = headers.set('Content-Type', 'application/json');
    try {
      const res = await firstValueFrom(http.request(method, url, { body: options.body, headers, observe: 'response' }));
      return { status: res.status, body: res.body, headers: res.headers };
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse)
        return { status: error.status, body: error.error, headers: error.headers };
      throw error;
    }
  }

  async function login(role: UserRole): Promise<string> {
    const reply = await call('POST', '/api/v1/auth/session', { body: { role } });
    expect(reply.status).toBe(201);
    if (!isSessionInfo(reply.body)) throw new Error('invalid session payload');
    return reply.body.token;
  }

  function post(token: string, body: unknown, key: string | null = crypto.randomUUID()): Promise<Reply> {
    return call('POST', '/api/v1/expenses', {
      token,
      role: 'ADMIN',
      body,
      headers: key === null ? {} : { 'X-Idempotency-Key': key },
    });
  }

  function auditTypes(): string[] {
    return audit.events().map((e) => e.type);
  }

  beforeEach(() => setup());

  describe('happy path', () => {
    it('lists the seeded expenses for an ADMIN with pagination metadata', async () => {
      const admin = await login('ADMIN');
      const reply = await call('GET', '/api/v1/expenses?page=1&pageSize=10', { token: admin, role: 'ADMIN' });
      expect(reply.status).toBe(200);
      expect(isExpensePage(reply.body)).toBe(true);
      if (!isExpensePage(reply.body)) return;
      expect(reply.body.total).toBeGreaterThanOrEqual(18);
      expect(reply.body.items).toHaveLength(10);
      expect(reply.body.totalPages).toBe(Math.ceil(reply.body.total / 10));
    });

    it('filters, searches and sorts server-side', async () => {
      const admin = await login('ADMIN');
      const reply = await call('GET', '/api/v1/expenses?status=APPROVED&sortBy=totalAmount&sortDir=asc&pageSize=50', {
        token: admin,
        role: 'ADMIN',
      });
      if (!isExpensePage(reply.body)) throw new Error('bad page');
      const amounts = reply.body.items.map((e) => e.totalAmount);
      expect(reply.body.items.every((e) => e.status === 'APPROVED')).toBe(true);
      expect(amounts).toEqual([...amounts].sort((a, b) => a - b));

      const search = await call('GET', '/api/v1/expenses?search=aws', { token: admin, role: 'ADMIN' });
      if (!isExpensePage(search.body)) throw new Error('bad page');
      expect(search.body.items.map((e) => e.invoiceCode)).toEqual(['INV-1001']);
    });

    it('creates a PENDING expense with a server-computed total and creator', async () => {
      const admin = await login('ADMIN');
      const reply = await post(admin, VALID_DTO);
      expect(reply.status).toBe(201);
      expect(isExpense(reply.body)).toBe(true);
      if (!isExpense(reply.body)) return;
      expect(reply.body.status).toBe('PENDING');
      expect(reply.body.totalAmount).toBe(1210);
      expect(reply.body.createdBy).toBe('u-admin');
      expect(reply.body.approvedBy).toBeNull();
    });

    it('approves a pending expense and persists a signed envelope', async () => {
      const admin = await login('ADMIN');
      const reply = await call('PATCH', `/api/v1/expenses/${ENGINEERING_EXPENSE_ID}`, {
        token: admin,
        role: 'ADMIN',
        body: { status: 'APPROVED' },
      });
      expect(reply.status).toBe(200);
      const persisted: unknown = JSON.parse(storage.getItem(DEFAULT_MOCK_API_CONFIG.storageKey) ?? '{}');
      expect(persisted).toMatchObject({ schemaVersion: 1, checksum: expect.stringMatching(/^[0-9a-f]{64}$/) });
    });
  });

  describe('Web A06 · finite state machine', () => {
    it('rejects a second decision on a terminal expense with 409', async () => {
      const admin = await login('ADMIN');
      const reply = await call('PATCH', `/api/v1/expenses/${APPROVED_EXPENSE_ID}`, {
        token: admin,
        role: 'ADMIN',
        body: { status: 'REJECTED' },
      });
      expect(reply.status).toBe(409);
      expect(isProblemDetail(reply.body)).toBe(true);
    });

    it('refuses to delete approved financial records', async () => {
      const admin = await login('ADMIN');
      const reply = await call('DELETE', `/api/v1/expenses/${APPROVED_EXPENSE_ID}`, { token: admin, role: 'ADMIN' });
      expect(reply.status).toBe(409);
    });
  });

  describe('Web A07 / API2 · authentication', () => {
    it('returns 401 when the bearer token is missing', async () => {
      const reply = await call('GET', '/api/v1/expenses');
      expect(reply.status).toBe(401);
      expect(reply.headers.get('WWW-Authenticate')).toContain('Bearer');
      expect(auditTypes()).toContain('AUTHN_FAILURE');
    });

    it('returns 401 for a forged token', async () => {
      const reply = await call('GET', '/api/v1/expenses', { token: 'a'.repeat(64) });
      expect(reply.status).toBe(401);
    });

    it('returns 401 once the session has expired', async () => {
      const viewer = await login('VIEWER');
      clock += DEFAULT_MOCK_API_CONFIG.sessionTtlMs + 1;
      const reply = await call('GET', '/api/v1/budgets', { token: viewer, role: 'VIEWER' });
      expect(reply.status).toBe(401);
      expect(reply.body).toMatchObject({ type: expect.stringContaining('session-expired') });
    });

    it('returns 401 for a revoked token', async () => {
      const viewer = await login('VIEWER');
      expect((await call('DELETE', '/api/v1/auth/session', { token: viewer, role: 'VIEWER' })).status).toBe(204);
      expect((await call('GET', '/api/v1/budgets', { token: viewer, role: 'VIEWER' })).status).toBe(401);
    });
  });

  describe('Web A01 / API5 · function-level authorization', () => {
    it.each([
      ['DELETE', `/api/v1/expenses/${ENGINEERING_EXPENSE_ID}`, undefined],
      ['PATCH', `/api/v1/expenses/${ENGINEERING_EXPENSE_ID}`, { status: 'APPROVED' }],
      ['POST', '/api/v1/expenses', VALID_DTO],
    ])('blocks VIEWER %s with 403 even if the UI is bypassed', async (method, url, body) => {
      const viewer = await login('VIEWER');
      const reply = await call(method, url, {
        token: viewer,
        role: 'VIEWER',
        body,
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      expect(reply.status).toBe(403);
      expect(audit.events()[0]).toMatchObject({ type: 'AUTHZ_DENIED', source: 'API_GATEWAY' });
    });

    it('blocks a forged X-User-Role claim with 403', async () => {
      const viewer = await login('VIEWER');
      const reply = await call('GET', '/api/v1/budgets', { token: viewer, role: 'ADMIN' });
      expect(reply.status).toBe(403);
      expect(audit.events()[0]?.severity).toBe('CRITICAL');
    });
  });

  describe('API1 · object-level authorization (BOLA)', () => {
    it('hides out-of-scope expenses with 404', async () => {
      const viewer = await login('VIEWER');
      const reply = await call('GET', `/api/v1/expenses/${OUT_OF_SCOPE_EXPENSE_ID}`, { token: viewer, role: 'VIEWER' });
      expect(reply.status).toBe(404);
    });

    it('scopes collection reads to the session departments', async () => {
      const viewer = await login('VIEWER');
      const reply = await call('GET', '/api/v1/expenses?pageSize=50', { token: viewer, role: 'VIEWER' });
      if (!isExpensePage(reply.body)) throw new Error('bad page');
      expect(reply.body.items.every((e) => e.department === 'ENGINEERING' || e.department === 'MARKETING')).toBe(true);
    });
  });

  describe('API3 · property-level authorization (BOPLA / mass assignment)', () => {
    it('rejects privileged properties on POST with 422', async () => {
      const admin = await login('ADMIN');
      const reply = await post(admin, { ...VALID_DTO, status: 'APPROVED', approvedBy: 'attacker', id: 'x' });
      expect(reply.status).toBe(422);
      expect(reply.body).toMatchObject({
        errors: { status: expect.any(String), approvedBy: expect.any(String), id: expect.any(String) },
      });
      expect(audit.events()[0]).toMatchObject({ type: 'VALIDATION_REJECTED', severity: 'CRITICAL' });
    });

    it('only accepts { status } on PATCH', async () => {
      const admin = await login('ADMIN');
      const reply = await call('PATCH', `/api/v1/expenses/${ENGINEERING_EXPENSE_ID}`, {
        token: admin,
        role: 'ADMIN',
        body: { status: 'APPROVED', netAmount: 1 },
      });
      expect(reply.status).toBe(422);
    });
  });

  describe('API7 · SSRF', () => {
    it.each([
      'http://example.com/r.pdf',
      'https://127.0.0.1/r',
      'https://169.254.169.254/latest',
      'file:///etc/passwd',
    ])('rejects receiptUrl %s with 422', async (receiptUrl) => {
      const admin = await login('ADMIN');
      const reply = await post(admin, { ...VALID_DTO, receiptUrl });
      expect(reply.status).toBe(422);
      expect(reply.body).toMatchObject({ errors: { receiptUrl: expect.any(String) } });
    });
  });

  describe('API6 · idempotency', () => {
    it('requires X-Idempotency-Key (428)', async () => {
      const admin = await login('ADMIN');
      expect((await post(admin, VALID_DTO, null)).status).toBe(428);
    });

    it('replays the original result instead of creating a duplicate', async () => {
      const admin = await login('ADMIN');
      const key = crypto.randomUUID();
      const first = await post(admin, VALID_DTO, key);
      const second = await post(admin, VALID_DTO, key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.headers.get('Idempotent-Replayed')).toBe('true');
      expect(isExpense(second.body) && isExpense(first.body) && second.body.id === first.body.id).toBe(true);
    });

    it('rejects key reuse with a different payload (409)', async () => {
      const admin = await login('ADMIN');
      const key = crypto.randomUUID();
      await post(admin, VALID_DTO, key);
      expect((await post(admin, { ...VALID_DTO, netAmount: 5 }, key)).status).toBe(409);
    });
  });

  describe('API4 · resource consumption', () => {
    it('rejects pageSize above 50 with 422', async () => {
      const admin = await login('ADMIN');
      expect((await call('GET', '/api/v1/expenses?pageSize=51', { token: admin, role: 'ADMIN' })).status).toBe(422);
    });

    it('rejects over-long search terms with 422', async () => {
      const admin = await login('ADMIN');
      const reply = await call('GET', `/api/v1/expenses?search=${'a'.repeat(101)}`, { token: admin, role: 'ADMIN' });
      expect(reply.status).toBe(422);
    });

    it('throttles bursts with 429 and Retry-After', async () => {
      TestBed.resetTestingModule();
      setup({ rateLimit: { maxRequests: 5, windowMs: 10_000 } });
      const viewer = await login('VIEWER');
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++)
        statuses.push((await call('GET', '/api/v1/budgets', { token: viewer, role: 'VIEWER' })).status);
      expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
      const limited = await call('GET', '/api/v1/budgets', { token: viewer, role: 'VIEWER' });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toBe('10');
      expect(auditTypes()).toContain('RATE_LIMITED');

      clock += 10_000;
      expect((await call('GET', '/api/v1/budgets', { token: viewer, role: 'VIEWER' })).status).toBe(200);
    });
  });

  describe('API8 / API9 · misconfiguration and inventory', () => {
    it('answers 410 for unversioned routes and 404 for unknown versions', async () => {
      expect((await call('GET', '/api/expenses')).status).toBe(410);
      expect((await call('GET', '/api/v2/expenses')).status).toBe(404);
    });

    it('answers 405 with an Allow header for unsupported methods', async () => {
      const admin = await login('ADMIN');
      const reply = await call('PUT', '/api/v1/expenses', { token: admin, role: 'ADMIN', body: {} });
      expect(reply.status).toBe(405);
      expect(reply.headers.get('Allow')).toBe('GET, POST');
    });

    it('answers 415 for non-JSON bodies', async () => {
      const admin = await login('ADMIN');
      const reply = await call('POST', '/api/v1/expenses', {
        token: admin,
        role: 'ADMIN',
        body: 'title=x',
        headers: { 'Content-Type': 'text/plain', 'X-Idempotency-Key': crypto.randomUUID() },
      });
      expect(reply.status).toBe(415);
    });

    it('serves simulated failures as RFC 7807 without internals', async () => {
      const reply = await call('GET', '/api/v1/budgets?simulateError=true');
      expect(reply.status).toBe(500);
      expect(isProblemDetail(reply.body)).toBe(true);
      expect(JSON.stringify(reply.body)).not.toMatch(/stack|at \w+ \(/i);
      expect((await call('GET', '/api/v1/budgets?simulateError=unavailable')).status).toBe(503);
    });
  });

  describe('Web A08 · persisted state integrity (SHA-256)', () => {
    it('detects DevTools tampering, raises a critical alert and restores the secure seed', async () => {
      const admin = await login('ADMIN');
      await call('GET', '/api/v1/budgets', { token: admin, role: 'ADMIN' }); // hydrate + persist

      const key = DEFAULT_MOCK_API_CONFIG.storageKey;
      const raw = storage.getItem(key) ?? '';
      storage.setItem(key, raw.replace('"netAmount":24500', '"netAmount":1'));

      const reply = await call('GET', '/api/v1/expenses?search=aws', { token: admin, role: 'ADMIN' });
      if (!isExpensePage(reply.body)) throw new Error('bad page');
      expect(reply.body.items[0]?.netAmount).toBe(24_500);
      expect(audit.events().some((e) => e.type === 'INTEGRITY_VIOLATION' && e.severity === 'CRITICAL')).toBe(true);
    });

    it('restores the seed when the stored JSON is not even parseable', async () => {
      storage.setItem(DEFAULT_MOCK_API_CONFIG.storageKey, '{not json');
      const admin = await login('ADMIN');
      const reply = await call('GET', '/api/v1/expenses', { token: admin, role: 'ADMIN' });
      expect(reply.status).toBe(200);
      expect(auditTypes()).toContain('INTEGRITY_VIOLATION');
    });
  });
});
