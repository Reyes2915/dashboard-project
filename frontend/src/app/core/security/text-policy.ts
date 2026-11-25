/**
 * Allow-list text policy (Web A05 Injection). Angular already escapes output contextually;
 * this is defence in depth on input so stored data never contains markup or control chars.
 */

/** Letters (any script), digits, spaces and a small set of business punctuation. */
const SAFE_TEXT = /^[\p{L}\p{N} .,;:()'"&/%€$#+\-_!?\u2013\u2014\u2019]*$/u;
export const INVOICE_CODE_PATTERN = /^INV-\d{4}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isSafeText(value: string): boolean {
  return SAFE_TEXT.test(value);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
