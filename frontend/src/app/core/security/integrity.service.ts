import { Injectable } from '@angular/core';

/**
 * Integrity primitives backed by the Web Crypto API (Web A04 / A08).
 *
 * Note: a plain SHA-256 detects accidental or naive tampering of persisted state.
 * A real backend would use an HMAC with a server-held key; a browser-only demo
 * cannot hold a secret, and this limitation is documented in the README.
 */
@Injectable({ providedIn: 'root' })
export class IntegrityService {
  async sha256Hex(input: string): Promise<string> {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Deterministic JSON: object keys are sorted so the checksum is stable across engines. */
  canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
  }

  sign(value: unknown): Promise<string> {
    return this.sha256Hex(this.canonicalJson(value));
  }

  async verify(value: unknown, expectedChecksum: string): Promise<boolean> {
    const actual = await this.sign(value);
    return timingSafeEqual(actual, expectedChecksum);
  }

  newId(): string {
    return crypto.randomUUID();
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
