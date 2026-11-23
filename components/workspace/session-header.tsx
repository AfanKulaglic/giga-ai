'use client';

import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useWorkspace } from './workspace-context';
import { QuickRepliesBar } from './quick-replies';
import { Badge, Button, Input } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cn, relativeTime } from '@/lib/utils';

export function SessionHeader() {
  const { sessions, activeSessionId, detail, openSession, createSession, renameSession, setSessionStatus, deleteSession } =
    useWorkspace();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState<{ id: string; label: string } | null>(null);

  const active = detail?.session ?? sessions.find((s) => s.id === activeSessionId) ?? null;

  React.useEffect(() => {
    if (active) setLabel(active.label);
  }, [active?.id, active?.label]);

  const filtered = sessions.filter(
    (s) =>
      !query.trim() ||
      s.label.toLowerCase().includes(query.toLowerCase()) ||
      s.context.customer.name?.toLowerCase().includes(query.toLowerCase()),
  );
  const archived = filtered.filter((s) => s.status === 'archived');
  const activeList = filtered.filter((s) => s.status === 'active');

  return (
    <div className="border-b bg-background/80 px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPickerOpen(true)}
          className="h-9 max-w-[min(420px,60vw)] justify-between gap-2 rounded-xl px-3"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-[13px] font-medium">{active?.label ?? 'Odaberite sesiju'}</span>
            {active?.status === 'archived' ? <Badge tone="neutral">arhiva</Badge> : null}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
        <DialogContent>
          <DialogHeader
            title="Sesije kupaca"
            description="Svaka sesija je izolovan razgovor. Podaci se nikada ne miješaju između kupaca."
          />
          <DialogBody className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Traži po nazivu ili kupcu…"
                  className="pl-8"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  try {
                    await createSession();
                    setPickerOpen(false);
                    toast({ title: 'Nova sesija je kreirana' });
                  } catch (err) {
                    toast({ title: 'Greška', description: (err as Error).message, tone: 'error' });
                  }
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Nova
              </Button>
            </div>

            <div className="max-h-[45vh] space-y-1 overflow-y-auto">
              {activeList.length === 0 ? (
                <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">Nema aktivnih sesija.</p>
              ) : null}
              {activeList.map((s) => (
                <button
                  key={s.id}
                  onClick={async () => {
                    setPickerOpen(false);
                    await openSession(s.id);
                  }}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted',
                    s.id === activeSessionId && 'border-border bg-muted/70',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{s.label}</span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {s.messageCount} poruka · {relativeTime(s.updatedAt)}
                      {s.context.products.length ? ` · ${s.context.products.length} proizvod(a)` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {s.context.orderIntent.value === 'confirmed' ? <Badge tone="green">narudžba</Badge> : null}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Obriši sesiju ${s.label}`}
                      title="Obriši sesiju"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({ id: s.id, label: s.label });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          setConfirmDelete({ id: s.id, label: s.label });
                        }
                      }}
                      className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </span>
                </button>
              ))}
              {archived.length ? (
                <p className="px-1 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Arhivirano</p>
              ) : null}
              {archived.map((s) => (
                <button
                  key={s.id}
                  onClick={async () => {
                    setPickerOpen(false);
                    await openSession(s.id);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left opacity-70 hover:bg-muted"
                >
                  <span className="truncate text-[13px]">{s.label}</span>
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
              Zatvori
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {active ? (
        editing ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && label.trim()) {
                  await renameSession(label.trim());
                  setEditing(false);
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-9 w-[240px]"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Sačuvaj naziv"
              onClick={async () => {
                if (label.trim()) await renameSession(label.trim());
                setEditing(false);
              }}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Otkaži" onClick={() => setEditing(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Preimenuj sesiju"
          >
            preimenuj
          </button>
        )
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        {active ? (
          <span className="hidden text-[11.5px] text-muted-foreground sm:inline">
            zadnja aktivnost {relativeTime(active.lastMessageAt ?? active.updatedAt)}
          </span>
        ) : null}
        {active ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title={active.status === 'archived' ? 'Vrati u aktivne' : 'Arhiviraj sesiju'}
              aria-label="Arhiviraj"
              onClick={async () => {
                const next = active.status === 'archived' ? 'active' : 'archived';
                await setSessionStatus(next);
                toast({ title: next === 'archived' ? 'Sesija je arhivirana' : 'Sesija je vraćena u aktivne' });
              }}
            >
              {active.status === 'archived' ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Obriši sesiju"
              aria-label="Obriši sesiju"
              onClick={() => active && setConfirmDelete({ id: active.id, label: active.label })}
            >
              <Trash2 className="h-3.5 w-3.5 text-danger/80" />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => createSession()}>
            <Plus className="h-3.5 w-3.5" /> Nova sesija
          </Button>
        )}
      </div>

      </div>

      <QuickRepliesBar />

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader
            title="Obrisati sesiju?"
            description={`„${confirmDelete?.label ?? ''}” — trajno se brišu poruke, AI razgovor i nacrti odgovora. Ova radnja se ne može poništiti.`}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Odustani
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (!target) return;
                setPickerOpen(false);
                await deleteSession(target.id);
                toast({ title: 'Sesija je obrisana' });
              }}
            >
              Obriši trajno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
