/**
 * PII / secret masking applied to every audit log entry (Web A09).
 * Order matters: the most specific patterns run first.
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, '[IBAN]'],
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[CARD]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID]'],
  [/\b[0-9a-f]{32,}\b/gi, '[TOKEN]'],
];

const MAX_LENGTH = 300;

export function maskSensitive(input: string): string {
  const masked = RULES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
  // Strip control characters to prevent log forging, then cap length.
  const clean = masked.replace(/\p{Cc}/gu, ' ');
  return clean.length > MAX_LENGTH ? `${clean.slice(0, MAX_LENGTH)}…` : clean;
}
