'use client';

import * as React from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useSettings } from './settings-context';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  SectionHeader,
  Switch,
  Textarea,
} from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { QuickReply } from '@/lib/domain/types';

const blank = (): Partial<QuickReply> & { id?: string } => ({
  code: '',
  label: '',
  category: 'Opšte',
  message: '',
  requiresReview: false,
});

export function QuickRepliesSection() {
  const { quickReplies, saveQuickReply, deleteQuickReply } = useSettings();
  const { toast } = useToast();
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState<(Partial<QuickReply> & { id?: string }) | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<QuickReply | null>(null);
  const [saving, setSaving] = React.useState(false);

  const filtered = quickReplies.filter(
    (q) =>
      !query.trim() ||
      (q.code ?? '').toLowerCase().includes(query.toLowerCase()) ||
      q.label.toLowerCase().includes(query.toLowerCase()) ||
      q.category.toLowerCase().includes(query.toLowerCase()),
  );

  const move = async (reply: QuickReply, direction: -1 | 1) => {
    const sorted = [...quickReplies].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = sorted.findIndex((r) => r.id === reply.id);
    const swapWith = sorted[index + direction];
    if (!swapWith) return;
    try {
      await saveQuickReply({ ...reply, sortOrder: swapWith.sortOrder });
      await saveQuickReply({ ...swapWith, sortOrder: reply.sortOrder });
    } catch (err) {
      toast({ title: 'Redoslijed nije sačuvan', description: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Brzi odgovori"
        description="Vidljiva dugmad u traci za sesije. Klik kopira kompletan tekst koji odmah lijepite u Instagram ili Facebook. Šifra (npr. hhh) je kratka oznaka radi brzog prepoznavanja."
        action={
          <Button size="sm" variant="primary" onClick={() => setEditing(blank())}>
            <Plus className="h-3.5 w-3.5" /> Novi odgovor
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Traži odgovor…" className="pl-8" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-surface">
          <EmptyState title="Nema brzih odgovora" description="Dodajte prvi odgovor i on će se odmah pojaviti u radnom prostoru." />
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((q, index) => (
            <li key={q.id} className="rounded-2xl border bg-surface px-3.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-[13.5px] font-semibold">{q.label}</span>
                  <Badge tone="neutral">{q.category}</Badge>
                  {q.requiresReview ? (
                    <Badge tone="amber">
                      <AlertTriangle className="h-3 w-3" /> provjeri tekst
                    </Badge>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="icon-sm" variant="ghost" aria-label="Gore" disabled={index === 0} onClick={() => move(q, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Dolje" disabled={index === filtered.length - 1} onClick={() => move(q, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Uredi" onClick={() => setEditing(q)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Obriši" onClick={() => setConfirmDelete(q)}>
                    <Trash2 className="h-3 w-3 text-danger/80" />
                  </Button>
                </div>
              </div>
              <p className="prose-chat mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
                {q.message}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent wide>
          <DialogHeader
            title={editing?.id ? 'Uredi brzi odgovor' : 'Novi brzi odgovor'}
            description="Ovo je kompletan tekst koji se kopira. Provjerite da sadrži tačne, potvrđene informacije firme."
          />
          <DialogBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Šifra (samo za traženje)" hint="ne prikazuje se kupcu">
                <Input
                  value={editing?.code ?? ''}
                  onChange={(e) =>
                    setEditing((prev) => ({ ...prev, code: e.target.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() }))
                  }
                  placeholder="hhh"
                  className="font-mono"
                  maxLength={12}
                />
              </Field>
              <Field label="Naziv dugmeta" hint="kratko i prepoznatljivo">
                <Input
                  value={editing?.label ?? ''}
                  onChange={(e) => setEditing((prev) => ({ ...prev, label: e.target.value }))}
                  placeholder="npr. Informacije o dostavi"
                />
              </Field>
              <Field label="Kategorija">
                <Input
                  value={editing?.category ?? ''}
                  onChange={(e) => setEditing((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="Dostava"
                />
              </Field>
            </div>
            <Field label="Poruka" hint={`${editing?.message?.length ?? 0} znakova`}>
              <Textarea
                rows={7}
                value={editing?.message ?? ''}
                onChange={(e) => setEditing((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Kompletan tekst poruke…"
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2">
              <span>
                <span className="block text-[12.5px] font-medium">Označi kao „provjeri tekst”</span>
                <span className="block text-[11px] text-muted-foreground">
                  Uključeno za početne primjere. Isključite kada potvrdite sadržaj.
                </span>
              </span>
              <Switch
                checked={editing?.requiresReview ?? false}
                onCheckedChange={(v) => setEditing((prev) => ({ ...prev, requiresReview: v }))}
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Odustani
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!editing?.label?.trim() || !editing?.message?.trim()}
              onClick={async () => {
                if (!editing) return;
                setSaving(true);
                try {
                  await saveQuickReply(editing);
                  setEditing(null);
                  toast({ title: 'Brzi odgovor je sačuvan' });
                } catch (err) {
                  toast({ title: 'Čuvanje nije uspjelo', description: (err as Error).message, tone: 'error' });
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Check className="h-3.5 w-3.5" /> Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader title="Obrisati brzi odgovor?" description={`„${confirmDelete?.label ?? ''}” će biti uklonjen iz radnog prostora.`} />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Odustani
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await deleteQuickReply(confirmDelete.id);
                  toast({ title: 'Brzi odgovor je obrisan' });
                } catch (err) {
                  toast({ title: 'Brisanje nije uspjelo', description: (err as Error).message, tone: 'error' });
                } finally {
                  setConfirmDelete(null);
                }
              }}
            >
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
