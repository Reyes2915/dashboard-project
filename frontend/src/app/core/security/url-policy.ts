/**
 * Outbound URL allow-list policy (API7 SSRF).
 * Shared by the form validator (UX barrier) and the mock API (authoritative barrier).
 * Only absolute https:// URLs to public hostnames are accepted.
 */

const MAX_URL_LENGTH = 2048;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

export type UrlPolicyViolation =
  'TOO_LONG' | 'MALFORMED' | 'SCHEME_NOT_ALLOWED' | 'CREDENTIALS_NOT_ALLOWED' | 'PORT_NOT_ALLOWED' | 'PRIVATE_HOST';

export function checkUrlPolicy(raw: string): UrlPolicyViolation | null {
  const value = raw.trim();
  if (value.length > MAX_URL_LENGTH) return 'TOO_LONG';
  // Reject control characters and whitespace that URL parsers silently strip.
  if (/[\s\\]|\p{Cc}/u.test(value)) return 'MALFORMED';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'MALFORMED';
  }

  if (url.protocol !== 'https:') return 'SCHEME_NOT_ALLOWED';
  if (url.username !== '' || url.password !== '') return 'CREDENTIALS_NOT_ALLOWED';
  if (url.port !== '' && url.port !== '443') return 'PORT_NOT_ALLOWED';

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || isPrivateHost(host)) return 'PRIVATE_HOST';
  return null;
}

export function isSafeHttpsUrl(raw: string): boolean {
  return checkUrlPolicy(raw) === null;
}

function isPrivateHost(host: string): boolean {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // Any IPv6 literal is rejected: public receipts are never served from raw IPv6 addresses.
  if (host.startsWith('[')) return true;
  // Single-label hosts (intranet names) are rejected.
  if (!host.includes('.')) return true;

  const ipv4 = parseIpv4(host);
  if (ipv4 === null) {
    // A purely numeric/hex host that is not a dotted quad is an obfuscated IP: reject.
    return /^[0-9x.]+$/i.test(host);
  }
  return isPrivateIpv4(ipv4);
}

function parseIpv4(host: string): readonly [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return null;
  const [a, b, c, d] = [match[1], match[2], match[3], match[4]].map(Number);
  if ([a, b, c, d].some((n) => n === undefined || Number.isNaN(n) || n > 255)) return null;
  return [a ?? 0, b ?? 0, c ?? 0, d ?? 0];
}

function isPrivateIpv4([a, b]: readonly [number, number, number, number]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}
