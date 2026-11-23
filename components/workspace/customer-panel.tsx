'use client';

import * as React from 'react';
import { ArrowUp, Eye, EyeOff, MessageSquareText, Sparkles, UserRound, Wand2 } from 'lucide-react';
import { useWorkspace } from './workspace-context';
import { MessageBubble } from './message-bubble';
import { Badge, Button, EmptyState, Spinner, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { SenderType } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const TYPES: { id: SenderType; label: string; hint: string }[] = [
  { id: 'customer', label: 'Kupac', hint: 'Poruka kupca (šalje se u kontekst)' },
  { id: 'agent', label: 'Mi', hint: 'Poruka koju smo mi poslali kupcu' },
  { id: 'note', label: 'Interna', hint: 'Bilješka — nikad se ne šalje kupcu' },
  { id: 'instruction', label: 'Uputa AI', hint: 'Kontekst ili instrukcija za AI' },
];

export function CustomerPanel() {
  const { detail, sendMessage, deleteMessage, classify, messageBusy } = useWorkspace();
  const { toast } = useToast();
  const [text, setText] = React.useState('');
  const [type, setType] = React.useState<SenderType>('customer');
  const [showInternal, setShowInternal] = React.useState(true);
  const [suggestion, setSuggestion] = React.useState<{ type: SenderType; confidence: number; rationale?: string } | null>(null);
  const [classifying, setClassifying] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  const messages = detail?.messages ?? [];
  const visible = showInternal ? messages : messages.filter((m) => m.senderType === 'customer' || m.senderType === 'agent');

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, detail?.session.id]);

  const submit = async () => {
    if (!text.trim() || !detail) return;
    try {
      await sendMessage(text.trim(), type);
      setText('');
      setSuggestion(null);
    } catch (err) {
      toast({ title: 'Poruka nije sačuvana', description: (err as Error).message, tone: 'error' });
    }
  };

  const suggestType = async () => {
    if (!text.trim()) {
      toast({ title: 'Unesite tekst poruke prvo', tone: 'info' });
      return;
    }
    setClassifying(true);
    try {
      const result = await classify(text);
      setSuggestion({ type: result.suggestedType, confidence: result.confidence, rationale: result.rationale });
    } catch (err) {
      toast({ title: 'Klasifikacija nije uspjela', description: (err as Error).message, tone: 'error' });
    } finally {
      setClassifying(false);
    }
  };

  if (!detail) {
    return (
      <section className="panel flex h-full min-h-[320px] flex-1 flex-col items-center justify-center">
        <EmptyState
          icon={<MessageSquareText className="h-7 w-7" />}
          title="Nema odabrane sesije"
          description="Odaberite sesiju kupca na vrhu ili kreirajte novu i zalijepite prvu poruku kupca."
        />
      </section>
    );
  }

  return (
    <section className="panel flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-muted text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em]">Razgovor s kupcem</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {messages.length} {messages.length === 1 ? 'poruka' : 'poruka'} · simulacija Instagram / Facebook
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowInternal((v) => !v)}
            title={showInternal ? 'Sakrij interne poruke' : 'Prikaži interne poruke'}
            aria-label="Prikaži interne poruke"
          >
            {showInternal ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {visible.length === 0 ? (
          <EmptyState
            icon={<MessageSquareText className="h-6 w-6" />}
            title="Razgovor je prazan"
            description="Zalijepite prvu poruku kupca ispod. Tip poruke birate vi — AI ga može samo predložiti."
          />
        ) : (
          visible.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onDelete={async (id) => {
                try {
                  await deleteMessage(id);
                } catch (err) {
                  toast({ title: 'Poruka nije obrisana', description: (err as Error).message, tone: 'error' });
                }
              }}
            />
          ))
        )}
      </div>

      <div className="border-t bg-surface/60 px-3 pb-2.5 pt-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              title={t.hint}
              className={cn(
                'rounded-full border px-2 py-[3px] text-[11px] font-medium transition-colors',
                type === t.id
                  ? t.id === 'customer'
                    ? 'border-foreground/15 bg-foreground text-background'
                    : t.id === 'agent'
                      ? 'border-primary/25 bg-primary/15 text-primary'
                      : 'border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={suggestType} loading={classifying} className="h-6 px-1.5 text-[11px]">
              <Wand2 className="h-3 w-3" /> Predloži tip
            </Button>
          </div>
        </div>

        {suggestion ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-2 py-1.5 text-[11.5px]">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>
              Prijedlog: <strong>{TYPES.find((t) => t.id === suggestion.type)?.label}</strong> ·{' '}
              {Math.round(suggestion.confidence * 100)}%
            </span>
            {suggestion.rationale ? <span className="text-muted-foreground">— {suggestion.rationale}</span> : null}
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[11px]"
                onClick={() => {
                  setType(suggestion.type);
                  setSuggestion(null);
                }}
              >
                Primijeni
              </Button>
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[11px]" onClick={() => setSuggestion(null)}>
                Odbaci
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-end gap-1.5 rounded-xl border bg-background p-1.5 shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-ring/50">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={
              type === 'customer'
                ? 'Zalijepite poruku kupca…'
                : type === 'agent'
                  ? 'Poruka koju ste poslali kupcu…'
                  : type === 'note'
                    ? 'Interna bilješka…'
                    : 'Uputa AI asistentu…'
            }
            className="max-h-40 min-h-[42px] border-0 bg-transparent px-1.5 py-1 text-[13px] shadow-none focus-visible:ring-0"
          />
          <Button
            variant="primary"
            size="icon"
            onClick={submit}
            loading={messageBusy}
            disabled={!text.trim()}
            aria-label="Dodaj poruku"
            className="mb-0.5 shrink-0 rounded-lg"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 px-1 text-[10.5px] text-muted-foreground">
          {TYPES.find((t) => t.id === type)?.hint} · Enter dodaje, Shift+Enter novi red.
        </p>
      </div>
    </section>
  );
}
