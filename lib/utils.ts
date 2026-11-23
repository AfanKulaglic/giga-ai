import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Seed data uses epoch 0 as "never confirmed"; never show that as a date. */
function isPlaceholderDate(d: Date): boolean {
  return d.getTime() < Date.UTC(2000, 0, 1);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (isPlaceholderDate(d)) return 'nije potvrđeno';
  return d.toLocaleString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'nije provjereno';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()) || isPlaceholderDate(parsed)) return 'nije potvrđeno';
  const d = parsed.getTime();
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'upravo sada';
  if (min < 60) return `prije ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `prije ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `prije ${days} d`;
  return new Date(iso).toLocaleDateString('bs-BA');
}

export function initials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
