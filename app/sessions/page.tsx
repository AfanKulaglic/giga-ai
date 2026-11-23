'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ArrowRight, MessagesSquare, Plus, Search, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { BootstrapResponse } from '@/lib/client/types';
import type { CustomerSession } from '@/lib/domain/types';
import { Badge, Button, EmptyState, Input, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { formatDate, relativeTime } from '@/lib/utils';

export default function SessionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [sessions, setSessions] = React.useState<CustomerSession[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [showArchived, setShowArchived] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<CustomerSession | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<{ sessions: CustomerSession[] }>('/api/sessions');
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = (sessions ?? []).filter((s) => {
    const matchesQuery =
      !query.trim() ||
      s.label.toLowerCase().includes(query.toLowerCase()) ||
      s.context.customer.name?.toLowerCase().includes(query.toLowerCase());
    const matchesArchive = showArchived ? s.status === 'archived' : s.status === 'active';
    return matchesQuery && matchesArchive;
  });

  const act = async (id: string, action: 'archive' | 'restore' | 'delete') => {
    try {
      if (action === 'delete') await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      else
        await apiFetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: action === 'archive' ? 'archived' : 'active' }),
        });
      await load();
      toast({ title: action === 'delete' ? 'Sesija je obrisana' : action === 'archive' ? 'Sesija je arhivirana' : 'Sesija je vraćena' });
    } catch (err) {
      toast({ title: 'Radnja nije uspjela', description: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em]">Sesije kupaca</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Svaka sesija čuva razgovor, strukturirani kontekst, proizvode i nacrte odgovora. Sesije su potpuno izolovane.
          </p>
        </div>
        <Button
          variant="primary"
          loading={creating}
          onClick={async () => {
            setCreating(true);
            try {
              const data = await apiFetch<{ session: CustomerSession }>('/api/sessions', {
                method: 'POST',
                body: JSON.stringify({}),
              });
              router.push(`/?session=${data.session.id}`);
            } catch (err) {
              toast({ title: 'Sesija nije kreirana', description: (err as Error).message, tone: 'error' });
            } finally {
              setCreating(false);
            }
          }}
        >
          <Plus className="h-4 w-4" /> Nova sesija
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Traži sesiju…" className="pl-8" />
        </div>
        <Button variant={showArchived ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowArchived((v) => !v)}>
          <Archive className="h-3.5 w-3.5" /> {showArchived ? 'Prikaži aktivne' : 'Prikaži arhivu'}
        </Button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.05] px-3 py-2 text-[12.5px] text-danger">{error}</p>
      ) : null}

      {!sessions ? (
        <div className="mt-16 flex justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-10 rounded-2xl border bg-surface">
          <EmptyState
            icon={<MessagesSquare className="h-7 w-7" />}
            title={showArchived ? 'Nema arhiviranih sesija' : 'Još nema sesija'}
            description={showArchived ? 'Arhivirane sesije se ovdje mogu vratiti u aktivne.' : 'Kreirajte sesiju i zalijepite prvu poruku kupca u radnom prostoru.'}
            action={
              !showArchived ? (
                <Button size="sm" variant="primary" onClick={async () => {
                  const data = await apiFetch<{ session: CustomerSession }>('/api/sessions', { method: 'POST', body: JSON.stringify({}) });
                  router.push(`/?session=${data.session.id}`);
                }}>
                  <Plus className="h-3.5 w-3.5" /> Započni razgovor
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-2">
          {filtered.map((s) => (
            <li key={s.id} className="group flex items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3 transition-colors hover:border-foreground/15">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/?session=${s.id}`} className="truncate text-[14px] font-medium hover:underline">
                    {s.label}
                  </Link>
                  {s.context.orderIntent.value === 'confirmed' ? <Badge tone="green">narudžba</Badge> : null}
                  {s.context.products.length ? <Badge tone="blue">{s.context.products.length} proizvod(a)</Badge> : null}
                  {s.status === 'archived' ? <Badge tone="neutral">arhiva</Badge> : null}
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {s.messageCount} poruka · kreirano {formatDate(s.createdAt)} · zadnja aktivnost {relativeTime(s.lastMessageAt ?? s.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link href={`/?session=${s.id}`}>
                  <Button size="sm" variant="secondary">
                    Otvori <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={s.status === 'archived' ? 'Vrati' : 'Arhiviraj'}
                  onClick={() => act(s.id, s.status === 'archived' ? 'restore' : 'archive')}
                >
                  {s.status === 'archived' ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Obriši" onClick={() => setConfirmDelete(s)}>
                  <Trash2 className="h-3.5 w-3.5 text-danger/80" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader
            title="Obrisati sesiju?"
            description={`„${confirmDelete?.label ?? ''}” i sve njene poruke, kontekst i nacrti biće trajno obrisani.`}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Odustani
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (confirmDelete) await act(confirmDelete.id, 'delete');
                setConfirmDelete(null);
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
