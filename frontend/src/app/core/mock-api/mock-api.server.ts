import { HttpErrorResponse, HttpEvent, HttpHeaders, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, defer, delay, from, identity, mergeMap, of, throwError } from 'rxjs';
import { problem } from '../api/problem';
import { canTransition } from '../domain/expense-state-machine';
import { computeTotal } from '../domain/money';
import {
  BudgetOverview,
  CreateExpenseDto,
  DEPARTMENTS,
  EXPENSE_CATEGORIES,
  EXPENSE_SORT_FIELDS,
  EXPENSE_STATUSES,
  Expense,
  ExpenseQuery,
  PaginatedResponse,
  ProblemDetail,
  SessionInfo,
  UserRole,
} from '../models/finops.models';
import { IntegrityService } from '../security/integrity.service';
import {
  isArrayOf,
  isDepartment,
  isExpense,
  isExpenseCategory,
  isRecord,
  isUserRole,
  isVatRate,
} from '../security/payload-guards';
import { INVOICE_CODE_PATTERN, isSafeText, isValidIsoDate } from '../security/text-policy';
import { checkUrlPolicy } from '../security/url-policy';
import { SecurityAuditService } from '../services/security-audit.service';
import { BUDGET_ALLOCATIONS, MOCK_API_CONFIG, MOCK_STORAGE } from './mock-api.config';
import { buildSeed } from './mock-seed';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type RouteKey = 'auth/session' | 'expenses' | 'expenses/:id' | 'budgets' | 'invoice-codes/:code';
type Access = readonly UserRole[] | 'PUBLIC';

/**
 * API5 BFLA: explicit, deny-by-default role/endpoint matrix.
 * Any method not listed for a route answers 405; any role not listed answers 403.
 */
export const ACCESS_MATRIX: Readonly<Record<RouteKey, Partial<Record<HttpMethod, Access>>>> = {
  'auth/session': { POST: 'PUBLIC', DELETE: ['ADMIN', 'VIEWER'] },
  expenses: { GET: ['ADMIN', 'VIEWER'], POST: ['ADMIN'] },
  'expenses/:id': { GET: ['ADMIN', 'VIEWER'], PATCH: ['ADMIN'], DELETE: ['ADMIN'] },
  budgets: { GET: ['ADMIN', 'VIEWER'] },
  'invoice-codes/:code': { GET: ['ADMIN'] },
};

const ROUTES: readonly (readonly [RouteKey, RegExp])[] = [
  ['auth/session', /^\/api\/v1\/auth\/session$/],
  ['expenses', /^\/api\/v1\/expenses$/],
  ['expenses/:id', /^\/api\/v1\/expenses\/([^/]+)$/],
  ['budgets', /^\/api\/v1\/budgets$/],
  ['invoice-codes/:code', /^\/api\/v1\/invoice-codes\/([^/]+)$/],
];

/** API3 BOPLA: properties a client may never set. */
const PRIVILEGED_PROPERTIES = ['id', 'status', 'approvedBy', 'createdBy', 'createdAt', 'totalAmount'] as const;
const CREATE_PROPERTIES: readonly (keyof CreateExpenseDto)[] = [
  'title',
  'department',
  'category',
  'invoiceCode',
  'receiptUrl',
  'netAmount',
  'vatRate',
  'date',
  'justification',
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NET_AMOUNT = 1_000_000;
const MAX_SESSIONS = 200;
const MAX_IDEMPOTENCY_KEYS = 1000;

interface ServerSession extends SessionInfo {
  readonly createdAt: number;
}

interface PersistedEnvelope {
  readonly schemaVersion: 1;
  readonly checksum: string;
  readonly data: { readonly expenses: readonly Expense[] };
}

interface MockResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly result: MockResult };

function pickOrAll<T extends string>(raw: string | null, allowed: readonly T[]): T | 'ALL' | undefined {
  if (raw === null || raw === 'ALL') return 'ALL';
  return allowed.find((value) => value === raw);
}

interface RequestContext {
  readonly req: HttpRequest<unknown>;
  readonly url: URL;
  readonly session: ServerSession;
  readonly param: string;
}

const PROFILES: Readonly<Record<UserRole, Pick<SessionInfo, 'userId' | 'displayName' | 'scope'>>> = {
  ADMIN: { userId: 'u-admin', displayName: 'Alex Morgan · Finance Admin', scope: DEPARTMENTS },
  VIEWER: { userId: 'u-viewer', displayName: 'Jamie Lee · Department Viewer', scope: ['ENGINEERING', 'MARKETING'] },
};

/**
 * In-memory REST server behind `/api/v1/*`. It is the authoritative security barrier of the demo:
 * the UI may hide buttons, but every rule below is enforced here regardless of the DOM state.
 * Requests are processed serially (single-threaded server semantics) to keep persistence consistent.
 */
@Injectable({ providedIn: 'root' })
export class MockApiServer {
  private readonly config = inject(MOCK_API_CONFIG);
  private readonly storage = inject(MOCK_STORAGE);
  private readonly integrity = inject(IntegrityService);
  private readonly audit = inject(SecurityAuditService);

  private expenses: Expense[] = [];
  private hydrated = false;
  private lastPersisted: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessions = new Map<string, ServerSession>();
  private readonly idempotency = new Map<string, { readonly fingerprint: string; readonly expenseId: string }>();
  private readonly rateWindows = new Map<string, { windowStart: number; count: number }>();

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    const latency = this.config.latencyMs > 0 ? delay<MockResult>(this.config.latencyMs) : identity;
    return defer(() => from(this.enqueue(req))).pipe(
      latency,
      mergeMap((result) => {
        const headers = new HttpHeaders({ 'Content-Type': 'application/json', ...result.headers });
        if (result.status < 400) {
          return of(new HttpResponse({ status: result.status, body: result.body, headers, url: req.url }));
        }
        return throwError(
          () => new HttpErrorResponse({ status: result.status, error: result.body, headers, url: req.url }),
        );
      }),
    );
  }

  private enqueue(req: HttpRequest<unknown>): Promise<MockResult> {
    const run = this.queue.then(() => this.process(req));
    this.queue = run.catch(() => undefined);
    return run.catch(() => this.fail(500, 'internal', 'An internal error occurred.'));
  }

  // ---------------------------------------------------------------- pipeline

  private async process(req: HttpRequest<unknown>): Promise<MockResult> {
    const url = new URL(req.urlWithParams, 'https://mock.invalid');
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method.toUpperCase();

    // API9: explicit versioning. Unversioned routes are retired, unknown versions do not exist.
    if (/^\/api(\/(?!v\d+(\/|$))|$)/.test(path)) {
      return this.fail(410, 'api-version-required', 'Unversioned API routes are retired. Use /api/v1.');
    }
    if (!/^\/api\/v1(\/|$)/.test(path)) {
      return this.fail(404, 'api-version-unknown', 'This API version does not exist.');
    }

    // API4: rate limiting runs before authentication so it also throttles credential stuffing.
    const token = this.bearerToken(req);
    if (!this.consumeRateLimit(token ?? 'anonymous')) {
      this.audit.record('RATE_LIMITED', 'WARNING', `Rate limit exceeded on ${method} ${path}`, 'API_GATEWAY');
      return this.fail(429, 'rate-limited', 'Too many requests. Slow down and retry later.', {
        'Retry-After': String(Math.ceil(this.config.rateLimit.windowMs / 1000)),
      });
    }

    const simulated = url.searchParams.get('simulateError');
    if (simulated === 'true') return this.fail(500, 'simulated-failure', 'A simulated internal failure occurred.');
    if (simulated === 'unavailable')
      return this.fail(503, 'simulated-outage', 'The service is temporarily unavailable.');
    if (simulated === 'contract') return { status: 200, body: { items: 'not-an-array', injected: '<script>' } };

    await this.ensureIntegrity();

    // Routing (404 / 405).
    const route = ROUTES.find(([, pattern]) => pattern.test(path));
    if (route === undefined) return this.fail(404, 'not-found', 'Resource not found.');
    const [routeKey, pattern] = route;
    const rules = ACCESS_MATRIX[routeKey];
    const access = rules[method as HttpMethod];
    if (access === undefined) {
      return this.fail(405, 'method-not-allowed', `Method ${method} is not allowed on this resource.`, {
        Allow: Object.keys(rules).join(', '),
      });
    }

    // API8: strict media type on requests carrying a body.
    if (method === 'POST' || method === 'PATCH') {
      const contentType = req.headers.get('Content-Type') ?? '';
      if (!/^application\/json(;|$)/i.test(contentType)) {
        this.audit.record('VALIDATION_REJECTED', 'WARNING', `Unsupported media type "${contentType}"`, 'API_GATEWAY');
        return this.fail(415, 'unsupported-media-type', 'Only application/json request bodies are accepted.');
      }
    }

    const param = decodeURIComponent(pattern.exec(path)?.[1] ?? '');

    if (access === 'PUBLIC') {
      return routeKey === 'auth/session' ? this.createSession(req.body) : this.fail(404, 'not-found', 'Not found.');
    }

    // API2: authentication.
    const session = this.authenticate(token, method, path);
    if ('status' in session) return session;

    // Role claim must match the server-side session: a tampered X-User-Role header is an attack signal.
    const claimedRole = req.headers.get('X-User-Role');
    if (claimedRole !== null && claimedRole !== session.role) {
      this.audit.record(
        'AUTHZ_DENIED',
        'CRITICAL',
        `Role claim tampering: header=${claimedRole} session=${session.role}`,
        'API_GATEWAY',
      );
      return this.fail(403, 'role-claim-mismatch', 'The role claim does not match the authenticated session.');
    }

    // API5: function-level authorization.
    if (!access.includes(session.role)) {
      this.audit.record(
        'AUTHZ_DENIED',
        'WARNING',
        `BFLA blocked: ${session.role} attempted ${method} ${path}`,
        'API_GATEWAY',
      );
      return this.fail(403, 'forbidden', `Role ${session.role} cannot perform ${method} on this resource.`);
    }

    const ctx: RequestContext = { req, url, session, param };
    switch (`${method} ${routeKey}`) {
      case 'DELETE auth/session':
        this.sessions.delete(session.token);
        return { status: 204, body: null };
      case 'GET expenses':
        return this.listExpenses(ctx);
      case 'POST expenses':
        return this.createExpense(ctx);
      case 'GET expenses/:id':
        return this.getExpense(ctx);
      case 'PATCH expenses/:id':
        return this.updateStatus(ctx);
      case 'DELETE expenses/:id':
        return this.deleteExpense(ctx);
      case 'GET budgets':
        return this.budgetOverview(ctx);
      case 'GET invoice-codes/:code':
        return this.invoiceAvailability(ctx);
      default:
        return this.fail(404, 'not-found', 'Resource not found.');
    }
  }

  // ---------------------------------------------------------------- authn / limits

  private bearerToken(req: HttpRequest<unknown>): string | null {
    const header = req.headers.get('Authorization');
    const match = header === null ? null : /^Bearer ([A-Za-z0-9._~-]{1,256})$/.exec(header);
    return match?.[1] ?? null;
  }

  private authenticate(token: string | null, method: string, path: string): ServerSession | MockResult {
    if (token === null) {
      this.audit.record('AUTHN_FAILURE', 'WARNING', `Missing bearer token on ${method} ${path}`, 'API_GATEWAY');
      return this.fail(401, 'unauthenticated', 'Authentication is required.', { 'WWW-Authenticate': 'Bearer' });
    }
    const session = this.sessions.get(token);
    if (session === undefined) {
      this.audit.record('AUTHN_FAILURE', 'WARNING', `Invalid or revoked token on ${method} ${path}`, 'API_GATEWAY');
      return this.fail(401, 'invalid-token', 'The session token is invalid or has been revoked.', {
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
    }
    if (this.config.now() >= session.expiresAt) {
      this.sessions.delete(token);
      this.audit.record('AUTHN_FAILURE', 'INFO', `Expired session used on ${method} ${path}`, 'API_GATEWAY');
      return this.fail(401, 'session-expired', 'The session has expired.', {
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
    }
    return session;
  }

  private consumeRateLimit(key: string): boolean {
    const now = this.config.now();
    const { maxRequests, windowMs } = this.config.rateLimit;
    const window = this.rateWindows.get(key);
    if (window === undefined || now - window.windowStart >= windowMs) {
      this.rateWindows.set(key, { windowStart: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= maxRequests;
  }

  private createSession(body: unknown): MockResult {
    if (!isRecord(body) || Object.keys(body).length !== 1 || !isUserRole(body['role'])) {
      return this.fail(422, 'validation', 'Body must be exactly { "role": "ADMIN" | "VIEWER" }.');
    }
    const role = body['role'];
    const now = this.config.now();
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    const session: ServerSession = {
      token,
      role,
      ...PROFILES[role],
      expiresAt: now + this.config.sessionTtlMs,
      createdAt: now,
    };
    this.pruneSessions(now);
    this.sessions.set(token, session);
    const publicSession: SessionInfo = {
      token,
      role,
      userId: session.userId,
      displayName: session.displayName,
      scope: session.scope,
      expiresAt: session.expiresAt,
    };
    return { status: 201, body: publicSession };
  }

  /** Bounded session store: expired sessions are dropped and the oldest evicted beyond the cap (API4). */
  private pruneSessions(now: number): void {
    for (const [token, session] of this.sessions) {
      if (now >= session.expiresAt) this.sessions.delete(token);
    }
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next();
      if (oldest.done === true) break;
      this.sessions.delete(oldest.value);
    }
  }

  // ---------------------------------------------------------------- handlers

  private listExpenses({ url, session }: RequestContext): MockResult {
    const parsed = this.parseQuery(url.searchParams);
    if (!parsed.ok) return parsed.result;
    const query = parsed.value;

    const term = query.search.toLowerCase();
    const filtered = this.scoped(session).filter(
      (e) =>
        (query.status === 'ALL' || e.status === query.status) &&
        (query.category === 'ALL' || e.category === query.category) &&
        (term === '' || `${e.title} ${e.invoiceCode} ${e.justification}`.toLowerCase().includes(term)),
    );

    const direction = query.sortDir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const left = a[query.sortBy];
      const right = b[query.sortBy];
      const cmp =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return cmp * direction;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / query.pageSize));
    const start = (query.page - 1) * query.pageSize;
    const body: PaginatedResponse<Expense> = {
      items: sorted.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: sorted.length,
      totalPages,
    };
    return { status: 200, body };
  }

  private parseQuery(params: URLSearchParams): Outcome<ExpenseQuery> {
    const errors: Record<string, string> = {};
    const int = (name: string, fallback: number): number => {
      const raw = params.get(name);
      if (raw === null) return fallback;
      if (!/^\d{1,6}$/.test(raw)) {
        errors[name] = 'Must be a positive integer.';
        return fallback;
      }
      return Number(raw);
    };
    const page = int('page', 1);
    const pageSize = int('pageSize', 10);
    if (page < 1) errors['page'] = 'Must be >= 1.';
    if (pageSize < 1 || pageSize > this.config.maxPageSize) {
      errors['pageSize'] = `Must be between 1 and ${this.config.maxPageSize}.`;
    }

    const search = (params.get('search') ?? '').trim();
    if (search.length > this.config.maxSearchLength) {
      errors['search'] = `Must be at most ${this.config.maxSearchLength} characters.`;
    }
    const status = pickOrAll(params.get('status'), EXPENSE_STATUSES);
    if (status === undefined) errors['status'] = 'Unknown status.';
    const category = pickOrAll(params.get('category'), EXPENSE_CATEGORIES);
    if (category === undefined) errors['category'] = 'Unknown category.';
    const sortBy = EXPENSE_SORT_FIELDS.find((f) => f === (params.get('sortBy') ?? 'date'));
    if (sortBy === undefined) errors['sortBy'] = 'Unknown sort field.';
    const rawDir = params.get('sortDir') ?? 'desc';
    const sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : undefined;
    if (sortDir === undefined) errors['sortDir'] = 'Must be asc or desc.';

    if (
      Object.keys(errors).length > 0 ||
      status === undefined ||
      category === undefined ||
      sortBy === undefined ||
      sortDir === undefined
    ) {
      this.audit.record(
        'VALIDATION_REJECTED',
        'WARNING',
        `Query rejected: ${Object.keys(errors).join(', ')}`,
        'API_GATEWAY',
      );
      return {
        ok: false,
        result: this.fail(422, 'invalid-query', 'One or more query parameters are invalid.', {}, errors),
      };
    }
    return { ok: true, value: { page, pageSize, search, status, category, sortBy, sortDir } };
  }

  private getExpense({ session, param }: RequestContext): MockResult {
    const found = this.findScoped(session, param, 'GET');
    return found.ok ? { status: 200, body: found.value } : found.result;
  }

  private async createExpense({ req, session }: RequestContext): Promise<MockResult> {
    // API6: anti-replay / duplicate-submission protection.
    const key = req.headers.get('X-Idempotency-Key');
    if (key === null) {
      this.audit.record('VALIDATION_REJECTED', 'WARNING', 'POST /expenses without X-Idempotency-Key', 'API_GATEWAY');
      return this.fail(428, 'idempotency-key-required', 'X-Idempotency-Key header is required for this operation.');
    }
    if (!UUID_PATTERN.test(key)) {
      return this.fail(400, 'idempotency-key-invalid', 'X-Idempotency-Key must be a UUID.');
    }

    const body = req.body;
    if (!isRecord(body)) return this.fail(422, 'validation', 'Request body must be a JSON object.');

    // API3: mass assignment is rejected explicitly, not silently dropped, so attacks are visible.
    const privileged = PRIVILEGED_PROPERTIES.filter((p) => p in body);
    const unknown = Object.keys(body).filter(
      (k) => !CREATE_PROPERTIES.some((p) => p === k) && !PRIVILEGED_PROPERTIES.some((p) => p === k),
    );
    if (privileged.length > 0 || unknown.length > 0) {
      const fields = [...privileged, ...unknown];
      this.audit.record(
        'VALIDATION_REJECTED',
        'CRITICAL',
        `Mass assignment blocked: ${fields.join(', ')}`,
        'API_GATEWAY',
      );
      return this.fail(
        422,
        'mass-assignment',
        'The request contains properties that cannot be set by clients.',
        {},
        Object.fromEntries(fields.map((f) => [f, 'This property is read-only or unknown.'])),
      );
    }

    const validation = validateCreateDto(body);
    if (!validation.ok) {
      this.audit.record(
        'VALIDATION_REJECTED',
        'WARNING',
        `Invalid expense: ${Object.keys(validation.errors).join(', ')}`,
        'API_GATEWAY',
      );
      return this.fail(422, 'validation', 'The expense is invalid.', {}, validation.errors);
    }
    const dto = validation.value;

    const scopedKey = `${session.userId}:${key}`;
    const fingerprint = await this.integrity.sign(dto);
    const previous = this.idempotency.get(scopedKey);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) {
        this.audit.record(
          'VALIDATION_REJECTED',
          'WARNING',
          'Idempotency key reused with a different payload',
          'API_GATEWAY',
        );
        return this.fail(
          409,
          'idempotency-conflict',
          'This idempotency key was already used with a different payload.',
        );
      }
      const original = this.expenses.find((e) => e.id === previous.expenseId);
      if (original !== undefined) return { status: 200, body: original, headers: { 'Idempotent-Replayed': 'true' } };
    }

    if (!session.scope.includes(dto.department)) {
      this.audit.record('AUTHZ_DENIED', 'WARNING', `BOLA blocked: create in ${dto.department}`, 'API_GATEWAY');
      return this.fail(403, 'forbidden', 'You cannot create expenses for this department.');
    }
    if (this.expenses.some((e) => e.invoiceCode === dto.invoiceCode)) {
      return this.fail(
        409,
        'duplicate-invoice',
        'An expense with this invoice code already exists.',
        {},
        {
          invoiceCode: 'Already registered.',
        },
      );
    }

    const expense: Expense = {
      ...dto,
      id: this.integrity.newId(),
      totalAmount: computeTotal(dto.netAmount, dto.vatRate),
      status: 'PENDING',
      createdBy: session.userId,
      approvedBy: null,
      createdAt: new Date(this.config.now()).toISOString(),
    };
    this.expenses = [expense, ...this.expenses];
    if (this.idempotency.size >= MAX_IDEMPOTENCY_KEYS) {
      const oldest = this.idempotency.keys().next();
      if (oldest.done !== true) this.idempotency.delete(oldest.value);
    }
    this.idempotency.set(scopedKey, { fingerprint, expenseId: expense.id });
    await this.persist();
    return { status: 201, body: expense, headers: { Location: `/api/v1/expenses/${expense.id}` } };
  }

  private async updateStatus({ req, session, param }: RequestContext): Promise<MockResult> {
    const body = req.body;
    if (
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      (body['status'] !== 'APPROVED' && body['status'] !== 'REJECTED')
    ) {
      this.audit.record(
        'VALIDATION_REJECTED',
        'WARNING',
        `PATCH rejected: only { status } transitions allowed`,
        'API_GATEWAY',
      );
      return this.fail(422, 'invalid-transition-payload', 'Only { "status": "APPROVED" | "REJECTED" } is accepted.');
    }
    const lookup = this.findScoped(session, param, 'PATCH');
    if (!lookup.ok) return lookup.result;
    const found = lookup.value;

    const target = body['status'];
    if (!canTransition(found.status, target)) {
      this.audit.record(
        'VALIDATION_REJECTED',
        'WARNING',
        `Illegal transition ${found.status} -> ${target}`,
        'API_GATEWAY',
      );
      return this.fail(409, 'invalid-transition', `An expense in status ${found.status} cannot become ${target}.`);
    }
    const updated: Expense = { ...found, status: target, approvedBy: session.userId };
    this.expenses = this.expenses.map((e) => (e.id === updated.id ? updated : e));
    await this.persist();
    return { status: 200, body: updated };
  }

  private async deleteExpense({ session, param }: RequestContext): Promise<MockResult> {
    const lookup = this.findScoped(session, param, 'DELETE');
    if (!lookup.ok) return lookup.result;
    const found = lookup.value;
    if (found.status === 'APPROVED') {
      return this.fail(409, 'immutable-record', 'Approved expenses are financial records and cannot be deleted.');
    }
    this.expenses = this.expenses.filter((e) => e.id !== found.id);
    await this.persist();
    return { status: 204, body: null };
  }

  private budgetOverview({ session }: RequestContext): MockResult {
    const visible = this.scoped(session);
    const sum = (list: readonly Expense[]): number =>
      Math.round(list.reduce((acc, e) => acc + e.totalAmount * 100, 0)) / 100;
    const body: BudgetOverview = {
      departments: session.scope.map((department) => {
        const own = visible.filter((e) => e.department === department);
        return {
          department,
          allocated: BUDGET_ALLOCATIONS[department],
          spent: sum(own.filter((e) => e.status === 'APPROVED')),
          pending: sum(own.filter((e) => e.status === 'PENDING')),
        };
      }),
      categories: EXPENSE_CATEGORIES.map((category) => ({
        category,
        amount: sum(visible.filter((e) => e.category === category && e.status !== 'REJECTED')),
      })),
      statusCounts: {
        PENDING: visible.filter((e) => e.status === 'PENDING').length,
        APPROVED: visible.filter((e) => e.status === 'APPROVED').length,
        REJECTED: visible.filter((e) => e.status === 'REJECTED').length,
      },
      generatedAt: new Date(this.config.now()).toISOString(),
    };
    return { status: 200, body };
  }

  private invoiceAvailability({ param }: RequestContext): MockResult {
    if (!INVOICE_CODE_PATTERN.test(param)) {
      return this.fail(422, 'validation', 'Invoice code must match INV-XXXX.');
    }
    return { status: 200, body: { code: param, available: !this.expenses.some((e) => e.invoiceCode === param) } };
  }

  // ---------------------------------------------------------------- object-level authorization

  private scoped(session: ServerSession): Expense[] {
    return this.expenses.filter((e) => session.scope.includes(e.department));
  }

  /** API1 BOLA: out-of-scope objects answer 404 so their existence is not disclosed. */
  private findScoped(session: ServerSession, id: string, method: string): Outcome<Expense> {
    const expense = this.expenses.find((e) => e.id === id);
    if (expense === undefined) return { ok: false, result: this.fail(404, 'not-found', 'Expense not found.') };
    if (!session.scope.includes(expense.department)) {
      this.audit.record(
        'AUTHZ_DENIED',
        'WARNING',
        `BOLA blocked: ${session.role} ${method} on out-of-scope expense`,
        'API_GATEWAY',
      );
      return { ok: false, result: this.fail(404, 'not-found', 'Expense not found.') };
    }
    return { ok: true, value: expense };
  }

  // ---------------------------------------------------------------- signed persistence (Web A08)

  private async ensureIntegrity(): Promise<void> {
    const raw = this.storage.getItem(this.config.storageKey);
    if (this.hydrated && raw === this.lastPersisted) return;

    if (raw === null) {
      if (this.hydrated) {
        this.audit.record(
          'INTEGRITY_VIOLATION',
          'WARNING',
          'Persisted state was deleted; secure seed restored',
          'API_GATEWAY',
        );
      }
      await this.restoreSeed();
      return;
    }

    const restored = await this.loadVerified(raw);
    if (!restored) {
      this.audit.record(
        'INTEGRITY_VIOLATION',
        'CRITICAL',
        'Persisted state failed schema/SHA-256 verification; secure seed restored',
        'API_GATEWAY',
      );
      await this.restoreSeed();
    }
  }

  private async loadVerified(raw: string): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!isEnvelope(parsed)) return false;
    if (!(await this.integrity.verify(parsed.data, parsed.checksum))) return false;
    this.expenses = [...parsed.data.expenses];
    this.lastPersisted = raw;
    this.hydrated = true;
    return true;
  }

  private async restoreSeed(): Promise<void> {
    this.expenses = buildSeed();
    this.hydrated = true;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const data = { expenses: this.expenses };
    const envelope: PersistedEnvelope = { schemaVersion: 1, checksum: await this.integrity.sign(data), data };
    const raw = JSON.stringify(envelope);
    try {
      this.storage.setItem(this.config.storageKey, raw);
      this.lastPersisted = raw;
    } catch {
      // Quota exceeded or storage disabled: keep serving from memory (fail-safe, not fail-open).
      this.lastPersisted = this.storage.getItem(this.config.storageKey);
    }
  }

  private fail(
    status: number,
    slug: string,
    detail: string,
    headers: Readonly<Record<string, string>> = {},
    errors?: Readonly<Record<string, string>>,
  ): MockResult {
    const body: ProblemDetail = problem(status, slug, detail, errors === undefined ? {} : { errors });
    return { status, body, headers: { ...headers, 'Content-Type': 'application/problem+json' } };
  }
}

function isEnvelope(value: unknown): value is PersistedEnvelope {
  return (
    isRecord(value) &&
    value['schemaVersion'] === 1 &&
    typeof value['checksum'] === 'string' &&
    /^[0-9a-f]{64}$/.test(value['checksum']) &&
    isRecord(value['data']) &&
    isArrayOf(isExpense)(value['data']['expenses'])
  );
}

type Validation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: Record<string, string> };

/** Authoritative server-side validation; the client validators mirror these rules for UX only. */
export function validateCreateDto(body: Record<string, unknown>): Validation<CreateExpenseDto> {
  const errors: Record<string, string> = {};
  const text = (name: string, min: number, max: number): string => {
    const value = body[name];
    if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
      errors[name] = `Must be ${min}-${max} characters.`;
      return '';
    }
    if (!isSafeText(value)) errors[name] = 'Contains characters that are not allowed.';
    return value.trim();
  };

  const title = text('title', 3, 80);
  const justification = text('justification', 10, 500);
  const department = body['department'];
  if (!isDepartment(department)) errors['department'] = 'Unknown department.';
  const category = body['category'];
  if (!isExpenseCategory(category)) errors['category'] = 'Unknown category.';
  const invoiceCode = body['invoiceCode'];
  if (typeof invoiceCode !== 'string' || !INVOICE_CODE_PATTERN.test(invoiceCode))
    errors['invoiceCode'] = 'Must match INV-XXXX.';

  const receiptUrl = body['receiptUrl'] ?? null;
  if (receiptUrl !== null) {
    const violation = typeof receiptUrl === 'string' ? checkUrlPolicy(receiptUrl) : 'MALFORMED';
    if (violation !== null) errors['receiptUrl'] = `Receipt URL rejected (${violation}).`;
  }

  const netAmount = body['netAmount'];
  if (typeof netAmount !== 'number' || !Number.isFinite(netAmount) || netAmount <= 0 || netAmount > MAX_NET_AMOUNT) {
    errors['netAmount'] = `Must be a number between 0.01 and ${MAX_NET_AMOUNT}.`;
  }
  const vatRate = body['vatRate'];
  if (!isVatRate(vatRate)) errors['vatRate'] = 'Unsupported VAT rate.';
  const date = body['date'];
  if (typeof date !== 'string' || !isValidIsoDate(date)) errors['date'] = 'Must be a valid YYYY-MM-DD date.';

  if (
    Object.keys(errors).length > 0 ||
    !isDepartment(department) ||
    !isExpenseCategory(category) ||
    typeof invoiceCode !== 'string' ||
    typeof netAmount !== 'number' ||
    !isVatRate(vatRate) ||
    typeof date !== 'string'
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title,
      department,
      category,
      invoiceCode,
      receiptUrl: typeof receiptUrl === 'string' ? receiptUrl.trim() : null,
      netAmount: Math.round(netAmount * 100) / 100,
      vatRate,
      date,
      justification,
    },
  };
}
