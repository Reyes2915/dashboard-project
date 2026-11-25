import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AUTH_OVERRIDE, IDEMPOTENCY_KEY } from '../api/http-context';
import { ApiError } from '../api/problem';
import { SessionInfo } from '../models/finops.models';
import { NotificationService } from '../services/notification.service';
import { RoleService } from '../services/role.service';
import { REQUEST_TIMEOUT_MS, authSecurityInterceptor } from './auth-security.interceptor';
import { httpErrorInterceptor } from './http-error.interceptor';

const SESSION: SessionInfo = {
  token: 'a'.repeat(64),
  role: 'ADMIN',
  userId: 'u-admin',
  displayName: 'Admin',
  scope: ['ENGINEERING'],
  expiresAt: Date.now() + 60_000,
};

describe('HTTP security pipeline (auth + error interceptors)', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const resetSession = vi.fn();
  const notifications = { warning: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    resetSession.mockClear();
    notifications.warning.mockClear();
    notifications.error.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor, authSecurityInterceptor])),
        provideHttpClientTesting(),
        { provide: RoleService, useValue: { session: signal(SESSION), resetSession } },
        { provide: NotificationService, useValue: notifications },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    vi.useRealTimers();
  });

  it('attaches Authorization and X-User-Role to same-origin API calls', () => {
    http.get('/api/v1/budgets').subscribe();
    const req = backend.expectOne('/api/v1/budgets');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${SESSION.token}`);
    expect(req.request.headers.get('X-User-Role')).toBe('ADMIN');
    expect(req.request.headers.has('X-Idempotency-Key')).toBe(false);
    req.flush({});
  });

  it('never sends credentials to third-party origins', () => {
    http.get('https://cdn.example.com/data.json').subscribe();
    const req = backend.expectOne('https://cdn.example.com/data.json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('adds an explicit JSON content type and a UUID idempotency key to mutations (API6/API8)', () => {
    http.post('/api/v1/expenses', { a: 1 }).subscribe();
    const req = backend.expectOne('/api/v1/expenses');
    expect(req.request.headers.get('Content-Type')).toBe('application/json');
    expect(req.request.headers.get('X-Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({});
  });

  it('reuses a caller-provided idempotency key and honours credential overrides', () => {
    const context = new HttpContext().set(IDEMPOTENCY_KEY, 'fixed-key').set(AUTH_OVERRIDE, { token: null, role: null });
    http.post('/api/v1/expenses', {}, { context }).subscribe();
    const req = backend.expectOne('/api/v1/expenses');
    expect(req.request.headers.get('X-Idempotency-Key')).toBe('fixed-key');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('normalises errors into a ProblemDetail and resets the session on 401 (Web A07)', async () => {
    const result = firstValueFrom(http.get('/api/v1/budgets')).catch((e: unknown) => e);
    backend
      .expectOne('/api/v1/budgets')
      .flush(
        { type: 't', title: 'Unauthorized', status: 401, detail: 'Session expired.' },
        { status: 401, statusText: 'Unauthorized' },
      );
    const error = await result;
    expect(error).toBeInstanceOf(ApiError);
    expect(resetSession).toHaveBeenCalledWith('Session expired.');
  });

  it('does not reset the real session when a probe with overridden credentials gets 401', async () => {
    const context = new HttpContext().set(AUTH_OVERRIDE, { token: 'forged', role: 'ADMIN' });
    const result = firstValueFrom(http.get('/api/v1/budgets', { context })).catch((e: unknown) => e);
    backend.expectOne('/api/v1/budgets').flush(null, { status: 401, statusText: 'Unauthorized' });
    await result;
    expect(resetSession).not.toHaveBeenCalled();
  });

  it('never leaks raw server bodies or stack traces (fail-closed, Web A10)', async () => {
    const result = firstValueFrom(http.get('/api/v1/budgets')).catch((e: unknown) => e);
    backend.expectOne('/api/v1/budgets').flush('Error: boom\n    at Server.handle (server.js:10:5)', {
      status: 500,
      statusText: 'Internal Server Error',
    });
    const error = await result;
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.problem.detail).toBe('The request could not be completed.');
    expect(JSON.stringify(error.problem)).not.toContain('server.js');
    expect(notifications.error).toHaveBeenCalled();
  });

  it('times out after 8 seconds with a 504 ProblemDetail (API10)', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(http.get('/api/v1/budgets')).catch((e: unknown) => e);
    const req = backend.expectOne('/api/v1/budgets');
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    const error = await result;
    expect(req.cancelled).toBe(true);
    expect(error instanceof ApiError && error.problem.status).toBe(504);
  });
});
