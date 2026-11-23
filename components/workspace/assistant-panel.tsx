'use client';

import * as React from 'react';
import {
  ArrowUp,
  ClipboardCopy,
  BookOpen,
  Bot,
  Check,
  ExternalLink,
  Minus,
  Package,
  Pencil,
  Plus,
  Send,
  Settings2,
  Trash2,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRound,
} from 'lucide-react';
import { useWorkspace } from './workspace-context';
import { Badge, Button, EmptyState, Spinner, Textarea } from '@/components/ui/primitives';
import { CopyButton } from '@/components/ui/copy-button';
import { useToast } from '@/components/ui/toast';
import type { AiCitation, AssistantTurn } from '@/lib/domain/types';
import { cn, relativeTime } from '@/lib/utils';
import { splitAssistantTurn } from '@/lib/domain/text';
import { copyText } from '@/lib/clipboard';

const SUGGESTIONS = [
  'Kupac pita ima li ovaj proizvod na stanju. Provjeri katalog i reci mi šta je sigurno, a šta nije.',
  'Sastavi kratak odgovor na zadnju poruku kupca u imenu firme.',
  'Šta još nedostaje da bismo potvrdili narudžbu iz ovog razgovora?',
];

/**
 * Upute koje agent najčešće piše. Klik = uputa je u polju, pa se šalje odmah
 * (Enter) — nema više kucanja iste rečenice za svakog kupca.
 */
const PRESET_KEY = 'giga:ai-presets';
const BUILTIN_PRESETS = [
  'Sastavi odgovor kupcu na zadnju poruku.',
  'Kupac pita šta sve imamo — pošalji link kategorije i zamoli ga da izabere model.',
  'Pitaj kupca koja mu dimenzija treba i navedi sve dostupne sa cijenama.',
  'Traži podatke za narudžbu: ime i prezime, telefon, adresa, grad i poštanski broj.',
  'Provjeri ima li proizvod na stanju i reci mi šta je sigurno.',
];

function loadPresets(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function citationIcon(kind: AiCitation['kind']) {
  if (kind === 'product') return <Package className="h-2.5 w-2.5" />;
  if (kind === 'procedure') return <BookOpen className="h-2.5 w-2.5" />;
  if (kind === 'additional_data') return <Sparkles className="h-2.5 w-2.5" />;
  if (kind === 'session') return <UserRound className="h-2.5 w-2.5" />;
  return <Settings2 className="h-2.5 w-2.5" />;
}

function CitationChip({ citation }: { citation: AiCitation }) {
  const content = (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
      title={[citation.detail, citation.updatedAt ? `ažurirano ${relativeTime(citation.updatedAt)}` : null]
        .filter(Boolean)
        .join(' · ')}
    >
      {citationIcon(citation.kind)}
      <span className="truncate">{citation.label}</span>
      {citation.url ? <ExternalLink className="h-2.5 w-2.5 opacity-60" /> : null}
    </span>
  );
  return citation.url ? (
    <a href={citation.url} target="_blank" rel="noreferrer noopener" className="min-w-0">
      {content}
    </a>
  ) : (
    content
  );
}

function Turn({ turn, isLatest }: { turn: AssistantTurn; isLatest?: boolean }) {
  const { deleteTurn, detail, editTurn, sendMessage } = useWorkspace();
  const replies = detail?.replies ?? [];
  const { toast } = useToast();
  const latestReply = replies[replies.length - 1] ?? null;
  const [editingCustomer, setEditingCustomer] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const saveCustomer = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      // Čuvamo interni dio razgovora, mijenja se samo poruka za kupca.
      const { internal } = splitAssistantTurn(turn.content);
      const nextContent = internal.trim() ? `${internal.trim()}

Poruka kupcu
${draft.trim()}` : draft.trim();
      await editTurn(turn.id, nextContent);
      setEditingCustomer(false);
      toast({ title: 'Poruka je sačuvana' });
    } catch (err) {
      toast({ title: 'Izmjena nije sačuvana', description: (err as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const removeTurn = async () => {
    if (!window.confirm('Obrisati ovu poruku iz razgovora sa asistentom?')) return;
    try {
      await deleteTurn(turn.id);
    } catch (err) {
      toast({ title: 'Poruka nije obrisana', description: (err as Error).message, tone: 'error' });
    }
  };

  if (turn.error) {
    return (
      <div className="rounded-xl border border-danger/25 bg-danger/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold text-danger">AI zahtjev nije uspio</p>
          <button
            type="button"
            title="Obriši"
            aria-label="Obriši"
            onClick={removeTurn}
            className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground/80">{turn.error}</p>
      </div>
    );
  }

  if (turn.role === 'user') {
    return (
      <div className="flex animate-in flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 pr-1">
          <span className="text-[10.5px] font-medium text-muted-foreground">Vi · {relativeTime(turn.createdAt)}</span>
          <button
            type="button"
            title="Obriši"
            aria-label="Obriši"
            onClick={removeTurn}
            className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <div className="prose-chat max-w-[92%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-3.5 py-2.5 text-[13px] leading-relaxed">
          {turn.content}
        </div>
      </div>
    );
  }

  const { internal, customer } = splitAssistantTurn(turn.content);

  return (
    <div className="flex animate-in flex-col items-start gap-1.5">
      {internal ? (
        <>
          <div className="flex items-center gap-1.5 pl-1">
            <Bot className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10.5px] font-medium text-muted-foreground">AI → ti · interno</span>
            <CopyButton text={internal} label="Kopiraj" size="sm" variant="ghost" iconOnly className="h-5 w-5" />
            <button
              type="button"
              title="Obriši ovaj odgovor asistenta"
              aria-label="Obriši ovaj odgovor asistenta"
              onClick={async () => {
                if (!window.confirm('Obrisati ovaj odgovor asistenta iz razgovora?')) return;
                try {
                  await deleteTurn(turn.id);
                } catch (err) {
                  toast({ title: 'Odgovor nije obrisan', description: (err as Error).message, tone: 'error' });
                }
              }}
              className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="prose-chat max-w-[95%] rounded-2xl rounded-bl-md border border-dashed bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed">
            {internal}
          </div>
        </>
      ) : null}

      {customer ? (
        <>
          <div className="mt-1 flex items-center gap-0.5 pl-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">za kupca</span>
            <button
              type="button"
              title="Kopiraj tekst poruke"
              onClick={async () => {
                const ok = await copyText(customer);
                toast({
                  title: ok ? 'Tekst je kopiran' : 'Kopiranje nije uspjelo',
                  description: ok ? 'Zalijepite ga u Instagram ili Facebook.' : 'Označite tekst i kopirajte ručno.',
                  tone: ok ? 'success' : 'error',
                });
              }}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ClipboardCopy className="h-3 w-3" /> Kopiraj tekst
            </button>
            {isLatest ? (
              <button
                type="button"
                title="Uredi poruku"
                  aria-label="Uredi poruku"
                  onClick={() => {
                    setDraft(customer);
                    setEditingCustomer((v) => !v);
                  }}
                  className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                <Pencil className="h-3 w-3" />
              </button>
            ) : null}
            {isLatest ? (
              <button
                type="button"
                title="Pošalji u chat kao našu poruku (bez kopiranja)"
                aria-label="Pošalji u chat"
                onClick={async () => {
                  if (!detail) return;
                  try {
                    // Poruka ide u razgovor sa desne strane, kao da smo je mi poslali.
                    await sendMessage(latestReply?.fullText ?? customer, 'agent');
                    toast({ title: 'Poslano u chat', description: 'Poruka je u razgovoru, na našoj strani.', tone: 'success' });
                  } catch (err) {
                    toast({ title: 'Nije poslano u chat', description: (err as Error).message, tone: 'error' });
                  }
                }}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-success transition-colors hover:bg-success/10"
              >
                <Send className="h-3 w-3" /> Pošalji u chat
              </button>
            ) : null}
          </div>
          {editingCustomer && isLatest ? (
            <div className="w-full max-w-[95%] space-y-1.5">
              <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="max-h-52 text-[13px]" />
              <div className="flex items-center gap-1">
                <Button size="sm" variant="primary" onClick={saveCustomer} loading={saving} disabled={!draft.trim()}>
                  Sačuvaj
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingCustomer(false)}>
                  Otkaži
                </Button>
              </div>
            </div>
          ) : (
            <div className="prose-chat max-w-[95%] rounded-2xl rounded-bl-md border border-success/35 bg-success/[0.07] px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[inset_3px_0_0_0_hsl(var(--success))]">
              {customer}
            </div>
          )}
        </>
      ) : null}
      {turn.citations.length ? (
        <div className="flex max-w-full flex-wrap gap-1 pl-1">
          {turn.citations.map((c, i) => (
            <CitationChip key={i} citation={c} />
          ))}
        </div>
      ) : null}
      {turn.toolCalls.length ? (
        <details className="w-full pl-1">
          <summary className="cursor-pointer select-none text-[10.5px] text-muted-foreground hover:text-foreground">
            <Terminal className="mr-1 inline h-2.5 w-2.5" />
            Alati ({turn.toolCalls.length}) — {turn.toolCalls.map((t) => t.name).join(', ')}
          </summary>
          <ul className="mt-1 space-y-0.5 rounded-lg border bg-background/60 p-1.5">
            {turn.toolCalls.map((t, i) => (
              <li key={i} className="text-[10.5px] text-muted-foreground">
                <span className={cn('font-mono', t.ok ? 'text-foreground/80' : 'text-danger')}>{t.name}</span> — {t.summary}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function AssistantPanel() {
  const { detail, askAssistant, generateReply, aiBusy, replyBusy, bootstrap, replyNotes } = useWorkspace();
  const { toast } = useToast();
  const [text, setText] = React.useState('');
  const [myPresets, setMyPresets] = React.useState<string[]>([]);
  React.useEffect(() => setMyPresets(loadPresets()), []);

  const savePreset = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    const next = Array.from(new Set([clean, ...myPresets])).slice(0, 8);
    setMyPresets(next);
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    } catch {
      /* privatni način rada — preset ostaje samo u sesiji */
    }
    toast({ title: 'Uputa je sačuvana', description: 'Sada je iznad polja, jedan klik.', tone: 'success' });
  };
  const listRef = React.useRef<HTMLDivElement>(null);
  const turns = detail?.turns ?? [];
  const lastAssistantIndex = turns.reduce((last, t, index) => (t.role === 'assistant' ? index : last), -1);
  const replies = detail?.replies ?? [];
  const aiConfigured = Boolean(bootstrap?.config.ai);
  const signatureConfigured = Boolean(bootstrap?.config.signatureConfigured);

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, aiBusy, detail?.session.id]);

  const send = async () => {
    if (!text.trim() || !detail) return;
    const message = text.trim();
    setText('');
    try {
      await askAssistant(message);
    } catch (err) {
      toast({ title: 'AI nije odgovorio', description: (err as Error).message, tone: 'error' });
    }
  };

  const generate = async (tone: 'concise' | 'balanced' | 'detailed') => {
    if (!detail) return;
    try {
      const reply = await generateReply({ tone });
      if (reply) toast({ title: 'Nacrt odgovora je spreman', tone: 'success' });
    } catch (err) {
      toast({ title: 'Odgovor nije generisan', description: (err as Error).message, tone: 'error' });
    }
  };

  if (!detail) {
    return (
      <section className="panel flex min-h-[320px] items-center justify-center">
        <EmptyState icon={<Bot className="h-7 w-7" />} title="AI asistent" description="Odaberite sesiju da biste započeli privatni razgovor sa asistentom." />
      </section>
    );
  }

  return (
    <section className="panel flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Nema zaglavlja: razgovor ispod već pokazuje sve. Ostaje samo tiha
          napomena kada AI nije konfiguriran. */}
      {!aiConfigured ? (
        <div className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] text-[hsl(var(--warning))]">
          <ShieldCheck className="h-3 w-3" /> AI nije konfiguriran — dodajte ključ u .env.local
        </div>
      ) : null}

      <div className="space-y-2 border-b px-3 py-2 empty:hidden">
        {replyNotes.length ? (
          <div className="rounded-xl border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[hsl(var(--warning))]">
            <p className="flex items-center gap-1 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" /> AI nema ove podatke — dopunite ih prije slanja
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {replyNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div ref={listRef} className="flex-1 space-y-3.5 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 ? (
          <div className="space-y-2.5">
            <EmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title="Pitajte asistenta"
              description="Ovo je vaš privatni razgovor. Ovdje možete prepričati šta kupac pita, tražiti provjeru proizvoda ili pomoć u sastavljanju odgovora."
              className="py-6"
            />
            <div className="space-y-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setText(s)}
                  className="w-full rounded-lg border border-dashed px-2.5 py-1.5 text-left text-[11.5px] leading-snug text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, index) => (
            <Turn key={turn.id} turn={turn} isLatest={index === lastAssistantIndex} />
          ))
        )}
        {aiBusy ? (
          <div className="flex items-center gap-2 pl-1 text-[11.5px] text-muted-foreground">
            <Spinner /> provjeravam podatke i sastavljam odgovor…
          </div>
        ) : null}
      </div>

      <div className="border-t bg-surface/60 px-3 pb-2.5 pt-2">
        {/* Upute koje se najčešće koriste: jedan klik i poruka je u polju. */}
        <div className="scrollbar-thin -mx-1 mb-1.5 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {[...myPresets, ...BUILTIN_PRESETS.filter((preset) => !myPresets.includes(preset))].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setText(preset);
                void (async () => {
                  try {
                    await askAssistant(preset);
                    setText('');
                  } catch (err) {
                    toast({ title: 'AI nije odgovorio', description: (err as Error).message, tone: 'error' });
                  }
                })();
              }}
              title={preset}
              className="shrink-0 whitespace-nowrap rounded-full border border-dashed px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {preset.length > 38 ? `${preset.slice(0, 36)}…` : preset}
            </button>
          ))}
          {text.trim() ? (
            <button
              type="button"
              onClick={() => savePreset(text)}
              title="Sačuvaj ovu uputu za sljedeći put"
              className="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              + sačuvaj uputu
            </button>
          ) : null}
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border bg-background p-1.5 shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-ring/50">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Npr. „Kupac pita ima li ovaj frižider No Frost.” ili „Sastavi ljubazniji odgovor.”"
            className="max-h-40 min-h-[42px] border-0 bg-transparent px-1.5 py-1 text-[13px] shadow-none focus-visible:ring-0"
            disabled={!aiConfigured}
          />
          <Button
            variant="primary"
            size="icon"
            onClick={send}
            loading={aiBusy}
            disabled={!aiConfigured || !text.trim()}
            aria-label="Pošalji asistentu"
            className="mb-0.5 shrink-0 rounded-lg"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-0.5 px-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[10.5px] text-muted-foreground"
            onClick={() => void generate('balanced')}
            loading={replyBusy}
            disabled={!aiConfigured}
            title="Predloži odgovor kupcu"
          >
            <Sparkles className="h-3 w-3" /> Predloži
          </Button>
          {replies.length ? (
            <>
              <Button size="icon-sm" variant="ghost" className="h-6 w-6" onClick={() => void generate('concise')} loading={replyBusy} disabled={!aiConfigured} title="Kraća poruka" aria-label="Kraća poruka">
                <Minus className="h-3 w-3" />
              </Button>
              <Button size="icon-sm" variant="ghost" className="h-6 w-6" onClick={() => void generate('detailed')} loading={replyBusy} disabled={!aiConfigured} title="Detaljnija poruka" aria-label="Detaljnija poruka">
                <Plus className="h-3 w-3" />
              </Button>
            </>
          ) : null}
          <span className="ml-auto truncate pl-1 text-[10.5px] text-muted-foreground">
          {aiConfigured
            ? 'AI koristi samo provjerene podatke i konfigurisane procedure. Izvori su vidljivi uz odgovor.'
            : `Dodajte ${bootstrap?.config.aiKeyEnv ?? 'AI_API_KEY'} u .env.local i restartujte aplikaciju da biste uključili AI (${bootstrap?.config.aiProviderLabel ?? 'provajder'}).`}
          </span>
        </div>
      </div>
    </section>
  );
}
