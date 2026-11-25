/** Money helpers. Amounts are handled in integer cents to avoid floating point drift. */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function computeVat(netAmount: number, vatRate: number): number {
  return toCents(netAmount * (vatRate / 100)) / 100;
}

export function computeTotal(netAmount: number, vatRate: number): number {
  return (toCents(netAmount) + toCents(computeVat(netAmount, vatRate))) / 100;
}

const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const EUR_COMPACT = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatEur(amount: number): string {
  return EUR.format(amount);
}

export function formatEurCompact(amount: number): string {
  return EUR_COMPACT.format(amount);
}
