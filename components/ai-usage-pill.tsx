'use client';

import * as React from 'react';
import Link from 'next/link';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIUsage {
  day: string;
  calls: number;
  /** Dnevni limit poziva; null znaci da model nema dnevni limit. */
  requestLimit?: number | null;
  /** Tacan postotak potrosenih poziva (null kada limita nema). */
  requestPercent?: number | null;
  hasLimit?: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  limit: number;
  percent: number;
  model: string;
  estimatedCostUsd: number;
  resetAt: string;
  resetInMinutes: number;
  byModel?: { model: string; calls: number; tokens: number }[];
}

function resetLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h` : `${m}min`;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

/**
 * Daily AI token spend in the navbar, so the Groq quota is never a surprise.
 * Refreshes every 30 s, when the tab regains focus, and after a custom
 * "giga:ai-usage" event fired by the workspace when a model call finishes.
 */
export function AIUsagePill() {
  const [usage, setUsage] = React.useState<AIUsage | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/ai-usage', { cache: 'no-store' });
      if (!res.ok) return;
      setUsage((await res.json()) as AIUsage);
    } catch {
      // Offline or signed out — keep the last known value.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    const onFocus = () => void load();
    const onUsage = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('giga:ai-usage', onUsage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('giga:ai-usage', onUsage);
    };
  }, [load]);

  if (!usage) return null;

  const requestLimit = usage.requestLimit ?? null;
  const requestPercent = usage.requestPercent ?? null;
  const hasLimit = usage.hasLimit ?? requestLimit !== null;
  const remaining = Math.max(0, usage.limit - usage.totalTokens);
  const tone = !hasLimit
    ? 'text-muted-foreground'
    : (requestPercent ?? 0) >= 90
      ? 'text-danger'
      : (requestPercent ?? 0) >= 60
        ? 'text-[hsl(var(--warning))]'
        : 'text-muted-foreground';
  const title = [
    hasLimit
      ? `Danas: ${usage.calls} od ${requestLimit} poziva (${requestPercent}%)`
      : `Danas: ${usage.calls} AI poziva — model nema dnevni limit`,
    `Tokena ukupno: ${usage.totalTokens.toLocaleString('bs-BA')}`,
    ...(usage.byModel ?? []).map(
      (entry) => `  • ${entry.model}: ${entry.tokens.toLocaleString('bs-BA')} tokena (${entry.calls} poziva)`,
    ),
    hasLimit && requestLimit
      ? `Preostalo poziva: ${Math.max(0, requestLimit - usage.calls)} od ${requestLimit}`
      : null,
    `Tokena do budžeta: ${remaining.toLocaleString('bs-BA')} od ${usage.limit.toLocaleString('bs-BA')}`,
    `Model: ${usage.model}`,
    usage.estimatedCostUsd > 0 ? `Procjena troška: $${usage.estimatedCostUsd.toFixed(3)}` : null,
    `Reset kvote: ${new Date(usage.resetAt).toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' })} (za ${resetLabel(usage.resetInMinutes)})`,
    usage.day,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <Link
      href="/settings"
      title={title}
      aria-label={
        hasLimit
          ? `Potrošnja AI danas: ${usage.calls} od ${requestLimit} poziva (${requestPercent}%)`
          : `Potrošnja AI danas: ${usage.calls} poziva, bez dnevnog limita`
      }
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2 text-[11.5px] font-medium tabular-nums transition-colors hover:bg-muted/60',
        tone,
      )}
    >
      <Coins className="h-3.5 w-3.5" />
      {hasLimit ? (
        <>
          <span>{usage.calls}</span>
          <span className="text-muted-foreground/70">/ {requestLimit}</span>
          <span className="font-semibold">{requestPercent}%</span>
        </>
      ) : (
        <>
          <span>{usage.calls}</span>
          <span className="text-[10px] font-normal text-muted-foreground/60 sm:inline">poziva</span>
          <span className="text-muted-foreground/70">· bez limita</span>
        </>
      )}
      <span className="hidden text-[10px] font-normal text-muted-foreground/60 sm:inline">
        reset {resetLabel(usage.resetInMinutes)}
      </span>
    </Link>
  );
}
