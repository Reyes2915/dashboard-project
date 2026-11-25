import { TestBed } from '@angular/core/testing';
import { canTransition, isTerminal } from '../domain/expense-state-machine';
import { computeTotal, computeVat } from '../domain/money';
import { buildSeed } from '../mock-api/mock-seed';
import { SecurityAuditService } from '../services/security-audit.service';
import { escapeCsvCell, toCsv } from './csv';
import { IntegrityService } from './integrity.service';
import { isBudgetOverview, isExpense, isExpensePage, isProblemDetail, isSessionInfo } from './payload-guards';
import { maskSensitive } from './pii-masking';

describe('CSV export (Web A05 formula injection)', () => {
  it.each(['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('neutralises %s', (payload) => {
    expect(escapeCsvCell(payload).startsWith(`"'`)).toBe(true);
  });

  it('quotes cells per RFC 4180 and keeps numbers numeric', () => {
    expect(escapeCsvCell('He said "hi", twice')).toBe('"He said ""hi"", twice"');
    expect(escapeCsvCell(-42.5)).toBe('-42.5');
    expect(escapeCsvCell(Number.NaN)).toBe('');
    expect(escapeCsvCell(null)).toBe('');
  });

  it('builds CRLF separated documents', () => {
    expect(toCsv(['a', 'b'], [['=1', 2]])).toBe(`"a","b"\r\n"'=1",2`);
  });
});

describe('IntegrityService (Web A08, Web Crypto SHA-256)', () => {
  let integrity: IntegrityService;
  beforeEach(() => (integrity = TestBed.inject(IntegrityService)));

  it('produces the known SHA-256 digest', async () => {
    expect(await integrity.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is stable regardless of key order and detects any mutation', async () => {
    const checksum = await integrity.sign({ b: 1, a: [{ y: 2, x: 1 }] });
    expect(await integrity.verify({ a: [{ x: 1, y: 2 }], b: 1 }, checksum)).toBe(true);
    expect(await integrity.verify({ a: [{ x: 1, y: 3 }], b: 1 }, checksum)).toBe(false);
  });

  it('generates RFC 4122 v4 identifiers', () => {
    expect(integrity.newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('payload guards (API10)', () => {
  const expense = buildSeed()[0]!;

  it('accepts valid payloads', () => {
    expect(isExpense(expense)).toBe(true);
    expect(isExpensePage({ items: [expense], page: 1, pageSize: 10, total: 1, totalPages: 1 })).toBe(true);
    expect(isProblemDetail({ type: 't', title: 'T', status: 400, detail: 'd', errors: { a: 'b' } })).toBe(true);
  });

  it.each([
    ['unknown status', { ...expense, status: 'PAID' }],
    ['string amount', { ...expense, totalAmount: '100' }],
    ['missing field', { ...expense, id: undefined }],
    ['injected department', { ...expense, department: '<script>' }],
  ])('rejects an expense with %s', (_label, payload) => {
    expect(isExpense(payload)).toBe(false);
  });

  it('rejects malformed envelopes and weak session tokens', () => {
    expect(isExpensePage({ items: 'not-an-array', page: 1, pageSize: 10, total: 0, totalPages: 1 })).toBe(false);
    expect(isBudgetOverview({ departments: [], categories: [], statusCounts: { PENDING: 1 }, generatedAt: 'x' })).toBe(
      false,
    );
    expect(
      isSessionInfo({ token: 'short', role: 'ADMIN', userId: 'u', displayName: 'd', scope: [], expiresAt: 1 }),
    ).toBe(false);
  });
});

describe('PII masking and SecurityAuditService (Web A09)', () => {
  it('masks tokens, emails, IBANs, card numbers and UUIDs', () => {
    const masked = maskSensitive(
      'Bearer abc.def-123 by jane.doe@corp.com IBAN ES9121000418450200051332 card 4111 1111 1111 1111 id 5f0c1a2e-4b1d-4c8e-9a01-0e1f2a3b4c01',
    );
    expect(masked).toBe('Bearer [REDACTED] by [EMAIL] IBAN [IBAN] card [CARD] id [UUID]');
  });

  it('strips control characters to prevent log forging and caps length', () => {
    expect(maskSensitive('line1\nFAKE ENTRY')).toBe('line1 FAKE ENTRY');
    expect(maskSensitive('x'.repeat(500))).toHaveLength(301);
  });

  it('stores masked events newest first in a bounded buffer', () => {
    const audit = TestBed.inject(SecurityAuditService);
    for (let i = 0; i < 205; i++) audit.record('RATE_LIMITED', 'WARNING', `event ${i} for ops@corp.com`);
    expect(audit.events()).toHaveLength(200);
    expect(audit.events()[0]?.message).toBe('event 204 for [EMAIL]');
    expect(audit.unseenCount()).toBe(205);
    audit.markSeen();
    expect(audit.unseenCount()).toBe(0);
  });
});

describe('domain rules', () => {
  it('only allows PENDING -> APPROVED | REJECTED', () => {
    expect(canTransition('PENDING', 'APPROVED')).toBe(true);
    expect(canTransition('PENDING', 'REJECTED')).toBe(true);
    expect(canTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(canTransition('REJECTED', 'PENDING')).toBe(false);
    expect(isTerminal('APPROVED')).toBe(true);
  });

  it('computes VAT in cents without floating point drift', () => {
    expect(computeVat(0.1 + 0.2, 21)).toBe(0.06);
    expect(computeTotal(19.99, 21)).toBe(24.19);
  });
});
