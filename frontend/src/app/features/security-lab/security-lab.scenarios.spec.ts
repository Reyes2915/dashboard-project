import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { MemoryStorage } from '../../../testing/memory-storage';
import { authSecurityInterceptor } from '../../core/interceptors/auth-security.interceptor';
import { httpErrorInterceptor } from '../../core/interceptors/http-error.interceptor';
import { mockApiInterceptor } from '../../core/interceptors/mock-api.interceptor';
import { DEFAULT_MOCK_API_CONFIG, MOCK_API_CONFIG, MOCK_STORAGE } from '../../core/mock-api/mock-api.config';
import { RoleService } from '../../core/services/role.service';
import { SecurityAuditService } from '../../core/services/security-audit.service';
import { SecurityLabScenarios } from './security-lab.scenarios';

/**
 * End-to-end verification of every OWASP probe through the real interceptor chain
 * (error boundary -> credentials/timeout -> simulated API), exactly as the Security Lab runs them.
 */
describe('Security Lab probes (full HTTP pipeline)', () => {
  let lab: SecurityLabScenarios;
  let roles: RoleService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        SecurityLabScenarios,
        provideHttpClient(withInterceptors([httpErrorInterceptor, authSecurityInterceptor, mockApiInterceptor])),
        { provide: MOCK_API_CONFIG, useValue: { ...DEFAULT_MOCK_API_CONFIG, latencyMs: 0 } },
        { provide: MOCK_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    lab = TestBed.inject(SecurityLabScenarios);
    roles = TestBed.inject(RoleService);
    await firstValueFrom(roles.startSession('ADMIN'));
  });

  it('defines a probe for every OWASP API control', () => {
    const controls = lab.scenarios.map((s) => s.control).join(' ');
    for (const id of ['API1', 'API2', 'API3', 'API4', 'API5', 'API6', 'API7', 'API8', 'API9', 'API10']) {
      expect(controls).toContain(id);
    }
  });

  it.each(
    // Resolved lazily: the list is built per test from the injected service.
    [
      'bfla',
      'role-claim',
      'bola',
      'bopla',
      'ssrf',
      'idempotency-missing',
      'idempotency-replay',
      'rate-limit',
      'page-size',
      'missing-token',
      'forged-token',
      'unversioned',
      'media-type',
      'method',
      'contract',
      'server-error',
    ],
  )('probe "%s" is blocked with the expected status', async (id) => {
    const scenario = lab.scenarios.find((s) => s.id === id);
    expect(scenario).toBeDefined();
    if (scenario === undefined) return;
    const outcome = await scenario.run();
    expect(outcome.status).toBe(scenario.expected);
  });

  it('revoking the live session triggers a secure reset to a fresh VIEWER session', async () => {
    const before = roles.session()?.token;
    const scenario = lab.scenarios.find((s) => s.id === 'revoked-session');
    const outcome = await scenario?.run();
    expect(outcome?.status).toBe(401);
    await vi.waitFor(() => expect(roles.session()?.role).toBe('VIEWER'));
    expect(roles.session()?.token).not.toBe(before);
    expect(
      TestBed.inject(SecurityAuditService)
        .events()
        .some((e) => e.type === 'SESSION_RESET'),
    ).toBe(true);
  });

  it('detects storage tampering and restores the seed', async () => {
    const outcome = await lab.tamperStorage();
    expect(outcome.status).toBe(200);
    expect(
      TestBed.inject(SecurityAuditService)
        .events()
        .some((e) => e.type === 'INTEGRITY_VIOLATION'),
    ).toBe(true);
  });
});
