'use client';

import * as React from 'react';
import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KeyInfo {
  index: number;
  label: string;
  usableInMs: number;
  preferred: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

function waitLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
  }
  return `${minutes}min`;
}

/**
 * AI ključevi u navbaru: vidiš sva tri, koji je aktivan i koji je potrošen,
 * i jednim klikom prebaciš na drugi. Osvježava se svakih 30 s.
 */
export function AIKeysPill() {
  const [keys, setKeys] = React.useState<KeyInfo[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/ai-keys', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { keys?: KeyInfo[] };
      setKeys(data.keys ?? []);
    } catch {
      // Offline or signed out — keep the last known state.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    const onUsage = () => void load();
    window.addEventListener('giga:ai-usage', onUsage);
    window.addEventListener('focus', onUsage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('giga:ai-usage', onUsage);
      window.removeEventListener('focus', onUsage);
    };
  }, [load]);

  const choose = async (index: number) => {
    setBusy(true);
    try {
      const res = await fetch('/api/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      const data = (await res.json().catch(() => ({}))) as { keys?: KeyInfo[]; error?: string };
      if (!res.ok) {
        window.alert(data.error ?? `Ključ ${index + 1} nije dostupan.`);
      } else {
        setKeys(data.keys ?? []);
      }
    } finally {
      setBusy(false);
      void load();
    }
  };

  if (keys.length < 2) return null;

  const activeIndex = (keys.find((key) => key.preferred) ?? keys[0])?.index ?? 0;

  return (
    <div
      className="inline-flex h-8 items-center gap-1 rounded-lg border bg-background px-1.5 text-[11.5px] font-medium"
      title={`AI ključevi: ${keys
        .map(
          (key) =>
            `${key.index + 1} (${key.label}) — ${
              key.usableInMs > 0 ? `potrošen, slobodan za ${waitLabel(key.usableInMs)}` : 'spreman'
            }${key.preferred ? ', aktivan' : ''}`,
        )
        .join('\n')}`}
    >
      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
      {keys.map((key) => {
        const busyKey = key.usableInMs > 0;
        return (
          <button
            key={key.index}
            type="button"
            disabled={busy || busyKey || key.disabled}
            onClick={() => void choose(key.index)}
            aria-label={`AI ključ ${key.index + 1}${key.disabled ? ' (neupotrebljiv)' : busyKey ? ' (potrošen)' : ''}${key.preferred ? ' — aktivan' : ''}`}
            title={
              key.disabled
                ? `Ključ ${key.index + 1} je trajno isključen — ${key.disabledReason ?? 'odbijen je'}.`
                : busyKey
                  ? `Ključ ${key.index + 1} je potrošen — slobodan za ${waitLabel(key.usableInMs)}`
                  : `Prebaci na ključ ${key.index + 1}`
            }
            className={cn(
              'inline-flex h-5 min-w-[16px] items-center justify-center rounded px-1 text-[10.5px] font-semibold tabular-nums transition-colors',
              // Trajno isključen ključ ima crvenu crtu — nije „potrošen do sutra”.
              key.disabled
                ? 'cursor-not-allowed bg-[hsl(var(--danger)/0.12)] text-[hsl(var(--danger))] line-through'
                : busyKey
                  ? 'cursor-not-allowed bg-muted text-muted-foreground/50 line-through'
                  : key.preferred
                    ? 'bg-[hsl(var(--success))] text-white'
                    : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {key.index + 1}
          </button>
        );
      })}
      <span className="hidden text-[10px] font-normal text-muted-foreground/70 sm:inline">ključ {activeIndex + 1}</span>
    </div>
  );
}
