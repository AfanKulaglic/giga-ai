// Integer-cent money helpers. All monetary maths in the app goes through these
// functions so results are deterministic and free of float drift.

export const CURRENCY = 'BAM';

export function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatMoney(value: number | null | undefined, currency = CURRENCY): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('bs-BA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Percent of a cent amount, rounded to the nearest cent (half away from zero). */
export function percentOfCents(cents: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const raw = (cents * percent) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

export function parseQuantity(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}
