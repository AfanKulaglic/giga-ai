'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, ChevronRight, Search, Settings2, Zap } from 'lucide-react';
import { useWorkspace } from './workspace-context';
import { Badge, Button, EmptyState, Input, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * Brzi odgovori u traci za odabir sesija: jedna vodoravna, skrolabilna linija
 * istog dizajna kao ostale kontrole u aplikaciji (h-7, rounded-lg, muted hover).
 * Klik na odgovor odmah kopira kompletnu poruku — nikad ne šalje sam.
 */
export function QuickRepliesBar() {
  const { quickReplies } = useWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const measure = React.useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    setEdges({
      left: strip.scrollLeft > 2,
      right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2,
    });
  }, []);

  React.useEffect(() => {
    measure();
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measure, quickReplies.length]);

  const scrollBy = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({ left: direction * Math.max(180, strip.clientWidth * 0.7), behavior: 'smooth' });
  };

  const copy = async (label: string, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: `„${label}” kopirano`, description: 'Zalijepite u Instagram ili Facebook.' });
    } catch {
      toast({ title: 'Kopiranje nije uspjelo', description: 'Otvori „Svi” i kopiraj dugmetom.', tone: 'error' });
    }
  };

  return (
    <>
      <div className="mt-1.5 flex items-center gap-1">
        <Zap className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="hidden shrink-0 pr-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:inline">
          Brzi
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => scrollBy(-1)}
          disabled={!edges.left}
          aria-label="Pomakni brze odgovore lijevo"
          title="Lijevo"
          className="shrink-0"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        <div
          ref={stripRef}
          onScroll={measure}
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg border bg-muted/40 px-1 py-1"
        >
          {quickReplies.length === 0 ? (
            <span className="px-1.5 text-[12px] text-muted-foreground">Nema brzih odgovora — dodajte ih u Postavkama.</span>
          ) : (
            quickReplies.map((q) => (
              <button
                key={q.id}
                onClick={() => copy(q.label, q.message)}
                title={`${q.category} — klik kopira kompletnu poruku`}
                className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent bg-background px-2.5 text-[12px] font-medium shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-border hover:bg-muted"
              >
                {q.requiresReview ? <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-hidden /> : null}
                {q.label}
              </button>
            ))
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => scrollBy(1)}
          disabled={!edges.right}
          aria-label="Pomakni brze odgovore desno"
          title="Desno"
          className="shrink-0"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          title="Svi brzi odgovori (traži, filtriraj, kopiraj)"
          aria-label="Svi brzi odgovori"
          className="shrink-0"
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <Link href="/settings?tab=quick-replies" className="shrink-0">
          <Button variant="ghost" size="icon-sm" title="Uredi brze odgovore" aria-label="Uredi brze odgovore">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
      <QuickRepliesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function QuickRepliesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { quickReplies } = useWorkspace();
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<string | null>(null);

  const categories = React.useMemo(
    () => [...new Set(quickReplies.map((q) => q.category))].sort((a, b) => a.localeCompare(b)),
    [quickReplies],
  );

  const filtered = quickReplies.filter((q) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      !needle ||
      (q.code ?? '').toLowerCase().includes(needle) ||
      q.label.toLowerCase().includes(needle) ||
      q.message.toLowerCase().includes(needle);
    const matchesCategory = !category || q.category === category;
    return matchesQuery && matchesCategory;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader
          title="Brzi odgovori"
          description="Kliknite „Kopiraj” i zalijepite kompletnu poruku u Instagram ili Facebook. Tekstovi se uređuju u Postavkama."
        />
        <DialogBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Traži brzi odgovor…"
                className="pl-8"
              />
            </div>
            <Link href="/settings?tab=quick-replies" onClick={() => onOpenChange(false)}>
              <Button variant="ghost" size="sm">
                <Settings2 className="h-3.5 w-3.5" /> Uredi
              </Button>
            </Link>
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setCategory(null)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                !category ? 'border-foreground/20 bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Sve
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c === category ? null : c)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                  category === c
                    ? 'border-foreground/20 bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {c}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Zap className="h-6 w-6" />}
              title="Nema brzih odgovora"
              description="Dodajte ih u Postavkama → Brzi odgovori. Sadržaj poruka u potpunosti određuje agent."
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((q) => (
                <li key={q.id} className="rounded-xl border bg-background p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <p className="text-[13px] font-semibold">{q.label}</p>
                      <Badge tone="neutral">{q.category}</Badge>
                      {q.requiresReview ? (
                        <Badge tone="amber" title="Zadržan je početni tekst — provjerite prije slanja.">
                          <AlertTriangle className="h-3 w-3" /> provjeri tekst
                        </Badge>
                      ) : null}
                    </div>
                    <CopyButton text={q.message} label="Kopiraj" toastLabel={`„${q.label}” kopirano`} />
                  </div>
                  <p className="prose-chat mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                    {q.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
