'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, tone = 'success' }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = ++counter.current;
      setItems((prev) => [...prev.slice(-2), { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 6500 : 3800);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-background/95 px-3.5 py-3 shadow-lift backdrop-blur animate-in',
              item.tone === 'error' && 'border-danger/30',
              item.tone === 'success' && 'border-[hsl(var(--success)/0.3)]',
            )}
          >
            {item.tone === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            ) : item.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(item.id)}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Zatvori obavještenje"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast mora biti unutar ToastProvider.');
  return ctx;
}
