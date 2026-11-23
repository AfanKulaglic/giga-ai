'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Bot, Calculator, MessageSquareText, Settings2, X } from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/components/workspace/workspace-context';
import { SessionHeader } from '@/components/workspace/session-header';
import { CustomerPanel } from '@/components/workspace/customer-panel';
import { AssistantPanel } from '@/components/workspace/assistant-panel';
import { ContextRail } from '@/components/workspace/context-rail';
import { OrderModal } from '@/components/workspace/order-modal';
import { Tabs } from '@/components/ui/tabs';
import { Button, Spinner } from '@/components/ui/primitives';
import { useMediaQuery } from '@/lib/client/use-media-query';
import { cn } from '@/lib/utils';

function ConfigStrip() {
  const { bootstrap } = useWorkspace();
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    setDismissed(window.localStorage.getItem('giga-config-strip-dismissed') === '1');
  }, []);

  if (!bootstrap) return null;
  const problems: { text: string; href: string }[] = [];
  if (!bootstrap.config.ai) {
    problems.push({ text: `AI nije konfiguriran (${bootstrap.config.aiKeyEnv ?? 'AI ključ'}). Chat i generisanje odgovora su onemogućeni.`, href: '/settings?tab=ai' });
  }
  if (!bootstrap.config.signatureConfigured) {
    problems.push({ text: 'Potpis nije konfiguriran — poruke kupcu neće imati potpis.', href: '/settings?tab=signature' });
  }
  if (!bootstrap.config.deliveryConfigured) {
    problems.push({ text: 'Pravila dostave nisu konfigurirana — kalkulator traži ručnu potvrdu.', href: '/settings?tab=calculator' });
  }
  if (!problems.length || dismissed) return null;

  return (
    <div className="flex items-start gap-2 border-b border-[hsl(var(--warning)/0.25)] bg-[hsl(var(--warning)/0.07)] px-3 py-2 sm:px-4">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]" />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] leading-relaxed text-[hsl(var(--warning))]">
        {problems.map((p) => (
          <Link key={p.href + p.text} href={p.href} className="underline decoration-current/40 underline-offset-2 hover:decoration-current">
            {p.text}
          </Link>
        ))}
      </div>
      <button
        className="rounded p-0.5 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning)/0.12)]"
        aria-label="Sakrij obavještenje"
        onClick={() => {
          window.localStorage.setItem('giga-config-strip-dismissed', '1');
          setDismissed(true);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Skeleton radnog prostora — iste kartice, kolone i visine kao pravi sadržaj. */
function WorkspaceSkeleton({ label }: { label: string }) {
  const block = 'animate-pulse rounded-md bg-muted';
  const panel = (span: string, rows: number, footer: boolean) => (
    <div className={cn('flex h-full min-h-0 flex-col', span)}>
      <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-[57px] items-center gap-2 border-b px-3.5">
          <div className={cn(block, 'h-4 w-28')} />
          <div className={cn(block, 'ml-auto h-5 w-16')} />
        </div>
        <div className="flex-1 space-y-2 px-3.5 py-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className={cn(block, 'h-2.5', i % 3 === 0 ? 'w-20' : 'w-14')} />
              <div className={cn(block, 'h-3', i % 2 === 0 ? 'w-full' : 'w-4/5')} />
            </div>
          ))}
        </div>
        {footer ? (
          <div className="border-t px-3 py-2">
            <div className={cn(block, 'h-[46px] w-full')} />
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className="relative flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {/* traka sesije: red sa selektorom + red sa brzim odgovorima (kao u pravoj) */}
      <div className="border-b bg-background/80 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className={cn(block, 'h-9 w-[240px]')} />
          <div className={cn(block, 'hidden h-9 w-[120px] sm:block')} />
          <div className={cn(block, 'ml-auto h-9 w-[92px]')} />
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <div className={cn(block, 'hidden h-7 w-7 shrink-0 sm:block')} />
          <div className="flex flex-1 gap-1 overflow-hidden rounded-lg border bg-muted/40 px-1 py-1">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className={cn(block, 'h-7 w-[86px] shrink-0')} />
            ))}
          </div>
          <div className={cn(block, 'hidden h-7 w-16 shrink-0 md:block')} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className="hidden h-full min-h-0 grid-cols-12 gap-2 p-2 lg:grid">
          {panel('col-span-4', 7, true)}
          {panel('col-span-5', 6, true)}
          {panel('col-span-3', 5, false)}
        </div>
        <div className="flex h-full min-h-0 flex-col gap-2 p-2 lg:hidden">
          <div className={cn(block, 'h-8 w-full max-w-[280px] self-center')} />
          {panel('', 7, true)}
        </div>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Spinner className="h-3.5 w-3.5" /> {label}
      </p>
    </div>
  );
}

function Workspace() {
  const { ready, error, refreshBootstrap, sessions, bootstrap, loadingSession, detail } = useWorkspace();
  const [orderOpen, setOrderOpen] = React.useState(false);
  const [mobileTab, setMobileTab] = React.useState('customer');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const params = useSearchParams();
  const requestedSession = params.get('session');
  const { openSession, activeSessionId } = useWorkspace();

  React.useEffect(() => {
    if (requestedSession && bootstrap?.sessions.some((s) => s.id === requestedSession) && requestedSession !== activeSessionId) {
      void openSession(requestedSession);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSession, bootstrap?.sessions.length]);

  if (!ready) {
    return <WorkspaceSkeleton label="Učitavam radni prostor…" />;
  }

  if (error) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-danger/25 bg-danger/[0.04] p-5 text-center">
        <p className="text-sm font-medium text-danger">Podaci nisu učitani</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{error}</p>
        <Button className="mt-3" size="sm" onClick={() => refreshBootstrap()}>
          Pokušaj ponovo
        </Button>
      </div>
    );
  }

  if (loadingSession && !detail) {
    return <WorkspaceSkeleton label="Učitavam sesiju…" />;
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden">
      <SessionHeader />
      <ConfigStrip />
      <div className="flex min-h-0 flex-1 flex-col">
        {isDesktop ? (
          <div className="grid min-h-0 flex-1 grid-cols-12 gap-2 p-2">
            <div className="col-span-4 flex h-full min-h-0 flex-col">
              <CustomerPanel />
            </div>
            <div className="col-span-5 flex h-full min-h-0 flex-col">
              <AssistantPanel />
            </div>
            <div className="col-span-3 flex h-full min-h-0 flex-col">
              <ContextRail onOpenOrder={() => setOrderOpen(true)} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-2 pt-2">
              <Tabs
                items={[
                  { id: 'customer', label: 'Kupac', icon: <MessageSquareText className="h-3.5 w-3.5" /> },
                  { id: 'assistant', label: 'AI', icon: <Bot className="h-3.5 w-3.5" /> },
                  { id: 'context', label: 'Kalkulator', icon: <Calculator className="h-3.5 w-3.5" /> },
                ]}
                value={mobileTab}
                onValueChange={setMobileTab}
                className="w-full justify-center"
              />
            </div>
            <div className={cn('min-h-0 flex-1 p-2', mobileTab !== 'customer' && 'hidden')}>
              <CustomerPanel />
            </div>
            <div className={cn('min-h-0 flex-1 p-2', mobileTab !== 'assistant' && 'hidden')}>
              <AssistantPanel />
            </div>
            <div className={cn('min-h-0 flex-1 p-2', mobileTab !== 'context' && 'hidden')}>
              <ContextRail onOpenOrder={() => setOrderOpen(true)} />
            </div>
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-[11.5px] shadow-soft">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            Nemate sesija. Kliknite „Nova sesija” iznad da započnete razgovor.
          </div>
        </div>
      ) : null}

      <OrderModal open={orderOpen} onOpenChange={setOrderOpen} />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <React.Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><Spinner /></div>}>
      <WorkspaceProvider>
        <Workspace />
      </WorkspaceProvider>
    </React.Suspense>
  );
}
