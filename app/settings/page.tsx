'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  Calculator,
  ClipboardList,
  MessageSquareText,
  Package,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { SettingsProvider, useSettings } from '@/components/settings/settings-context';
import { SignatureSection, AISection } from '@/components/settings/basic-sections';
import { CalculatorSection } from '@/components/settings/calculator-section';
import { ProceduresSection } from '@/components/settings/procedures-section';
import { QuickRepliesSection } from '@/components/settings/quick-replies-section';
import { OrderFormSection } from '@/components/settings/order-form-section';
import { ProductsSection } from '@/components/settings/products-section';
import { SyncSection, storageLabel } from '@/components/settings/sync-section';
import { Badge, Button, Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'quick-replies', label: 'Brzi odgovori', icon: MessageSquareText },
  { id: 'signature', label: 'Potpis', icon: PenLine },
  { id: 'procedures', label: 'Procedure', icon: ShieldCheck },
  { id: 'calculator', label: 'Popusti i dostava', icon: Calculator },
  { id: 'order-form', label: 'GigaHub obrazac', icon: ClipboardList },
  { id: 'products', label: 'Specifikacije', icon: Package },
  { id: 'ai', label: 'AI upute', icon: Bot },
  { id: 'sync', label: 'Katalog', icon: RefreshCw },
] as const;

type TabId = (typeof TABS)[number]['id'];

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { loading, error, refresh, settings, quickReplies, procedures, config, scraper } = useSettings();

  const initial = (params.get('tab') as TabId) || 'quick-replies';
  const [tab, setTab] = React.useState<TabId>(TABS.some((t) => t.id === initial) ? initial : 'quick-replies');

  React.useEffect(() => {
    const next = params.get('tab') as TabId | null;
    if (next && TABS.some((t) => t.id === next)) setTab(next);
  }, [params]);

  const change = (id: string) => {
    setTab(id as TabId);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-3 py-5 sm:px-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Postavke</h1>
          </div>
          <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            Sve što asistent zna o firmi dolazi odavde. Ništa se ne popunjava automatski — nepotvrđene stavke su jasno označene i AI ih
            ne smije izmišljati.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={config?.storage === 'rtdb' || config?.storage === 'firestore' ? 'green' : 'amber'}>
            {storageLabel(config?.storage)}
          </Badge>
          <Badge tone={config?.ai ? 'green' : 'red'}>{config?.ai ? config.aiModel : 'AI nije povezan'}</Badge>
          {settings ? <Badge tone="neutral">{quickReplies.length} odgovora · {procedures.length} procedura</Badge> : null}
        </div>
      </header>

      <nav className="mb-4 -mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => change(t.id)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors',
              tab === t.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.id === 'sync' && scraper ? (
              <span className="rounded-full bg-background/20 px-1.5 text-[10px] tabular-nums">{scraper.totalProducts}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.05] px-3 py-2.5 text-[12px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Postavke nisu učitane</p>
            <p className="text-danger/80">{error}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Pokušaj ponovo
          </Button>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <>
          {tab === 'quick-replies' ? <QuickRepliesSection /> : null}
          {tab === 'signature' ? <SignatureSection /> : null}
          {tab === 'procedures' ? <ProceduresSection /> : null}
          {tab === 'calculator' ? <CalculatorSection /> : null}
          {tab === 'order-form' ? <OrderFormSection /> : null}
          {tab === 'products' ? <ProductsSection /> : null}
          {tab === 'ai' ? <AISection /> : null}
          {tab === 'sync' ? <SyncSection /> : null}
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <SettingsProvider>
      <React.Suspense
        fallback={
          <div className="flex justify-center py-20">
            <Spinner className="h-5 w-5" />
          </div>
        }
      >
        <SettingsInner />
      </React.Suspense>
    </SettingsProvider>
  );
}
