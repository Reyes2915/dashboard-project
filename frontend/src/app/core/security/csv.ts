/**
 * CSV serialisation hardened against CSV/Formula Injection (Web A05).
 * Cells starting with a formula trigger (= + - @ TAB CR) are prefixed with a single quote
 * so spreadsheet software treats them as text, then RFC 4180 quoting is applied.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export type CsvCell = string | number | boolean | null;

export function escapeCsvCell(value: CsvCell): string {
  if (value === null) return '';
  // Numbers are emitted raw only when finite; negative numbers stay numeric (not a formula).
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const neutralised = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(escapeCsvCell), ...rows.map((row) => row.map(escapeCsvCell))];
  return lines.map((cells) => cells.join(',')).join('\r\n');
}

/** Triggers a client-side download through a Blob URL (no server round trip, no data: URLs). */
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
