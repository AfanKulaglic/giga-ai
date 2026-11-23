'use client';

import * as React from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useSettings } from './settings-context';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, SectionHeader, Switch, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { CompanyProcedure, ProcedureTopic } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';

const TOPICS: { id: ProcedureTopic; label: string }[] = [
  { id: 'showroom', label: 'Salon / lokacija' },
  { id: 'delivery', label: 'Dostava' },
  { id: 'payment', label: 'Plaćanje' },
  { id: 'warranty', label: 'Garancija' },
  { id: 'returns', label: 'Povrat i povrat novca' },
  { id: 'complaints', label: 'Reklamacije' },
  { id: 'company_info', label: 'Informacije o firmi' },
  { id: 'other', label: 'Ostalo' },
];

function ProcedureCard({ procedure, onSave, onDelete }: {
  procedure: CompanyProcedure;
  onSave: (p: Partial<CompanyProcedure> & { id?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState(procedure);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(procedure);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{procedure.title || 'Nova procedura'}</CardTitle>
          <Badge tone={procedure.verified ? 'green' : 'amber'}>{procedure.verified ? 'verificirano' : 'nije konfigurisano'}</Badge>
        </div>
        <span className="text-[10.5px] text-muted-foreground">{formatDate(procedure.updatedAt)}</span>
      </CardHeader>
      <CardBody className="grid gap-3 md:grid-cols-2">
        <Field label="Tema">
          <select
            value={draft.topic}
            onChange={(e) => setDraft({ ...draft, topic: e.target.value as ProcedureTopic })}
            className="h-9 w-full rounded-[10px] border border-input bg-background px-3 text-sm"
          >
            {TOPICS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Naslov">
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="Ključne riječi" hint="odvojene zarezom" className="md:col-span-2">
          <Input
            value={draft.keywords.join(', ')}
            onChange={(e) => setDraft({ ...draft, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })}
            placeholder="dostava, isporuka, kurir"
          />
        </Field>
        <Field
          label="Odgovor / procedura"
          hint="AI koristi ovaj tekst za opšta pitanja — bez pretrage kataloga"
          className="md:col-span-2"
        >
          <Textarea rows={4} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 md:col-span-2">
          <span>
            <span className="block text-[12.5px] font-medium">Provjereno i tačno</span>
            <span className="block text-[11px] text-muted-foreground">
              Uključite samo kada je sadržaj potvrđen. Nekonfigurisane procedure AI prijavljuje agentu umjesto da izmišlja odgovor.
            </span>
          </span>
          <Switch
            checked={draft.verified}
            disabled={!draft.answer.trim()}
            onCheckedChange={(v) => setDraft({ ...draft, verified: v })}
          />
        </label>
        <div className="flex items-center justify-between md:col-span-2">
          <Button
            size="icon-sm"
            variant="ghost"
            loading={deleting}
            aria-label="Obriši proceduru"
            onClick={async () => {
              setDeleting(true);
              try {
                await onDelete(procedure.id);
                toast({ title: 'Procedura je obrisana' });
              } catch (err) {
                toast({ title: 'Brisanje nije uspjelo', description: (err as Error).message, tone: 'error' });
              } finally {
                setDeleting(false);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-danger/80" />
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={!dirty || !draft.title.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ ...draft, verified: draft.verified && Boolean(draft.answer.trim()) });
                toast({ title: 'Procedura je sačuvana' });
              } catch (err) {
                toast({ title: 'Čuvanje nije uspjelo', description: (err as Error).message, tone: 'error' });
              } finally {
                setSaving(false);
              }
            }}
          >
            <Check className="h-3.5 w-3.5" /> Sačuvaj
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function ProceduresSection() {
  const { procedures, saveProcedure, deleteProcedure } = useSettings();
  const { toast } = useToast();
  const blank: CompanyProcedure = React.useMemo(
    () => ({
      id: '',
      userId: 'local',
      topic: 'other',
      title: '',
      keywords: [],
      answer: '',
      verified: false,
      updatedAt: new Date().toISOString(),
    }),
    [],
  );
  const [newProcedure, setNewProcedure] = React.useState<CompanyProcedure | null>(null);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Procedure firme"
        description="Odgovori na opšta pitanja (salon, dostava, plaćanje, garancija, povrat, reklamacije). AI ih koristi direktno i ne pretražuje katalog za ovakva pitanja."
        action={
          <Button size="sm" variant="secondary" onClick={() => setNewProcedure(blank)}>
            <Plus className="h-3.5 w-3.5" /> Nova procedura
          </Button>
        }
      />

      <div className="rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        Salaš / salon: jedino pravilo koje je unaprijed potvrđeno je da GIGA.ba posluje online, bez fizičkog salona. Ostale
        procedure su prazne dok ih vi ne unesete — AI ih tada neće izmišljati.
      </div>

      {newProcedure ? (
        <ProcedureCard
          procedure={newProcedure}
          onSave={async (p) => {
            await saveProcedure(p);
            setNewProcedure(null);
          }}
          onDelete={async () => setNewProcedure(null)}
        />
      ) : null}

      <div className="grid gap-3">
        {procedures.map((p) => (
          <ProcedureCard key={p.id} procedure={p} onSave={saveProcedure} onDelete={deleteProcedure} />
        ))}
        {procedures.length === 0 && !newProcedure ? (
          <div className="rounded-2xl border bg-surface p-6 text-center text-[12.5px] text-muted-foreground">
            Nema procedura. Dodajte ih ručno kako bi AI mogao tačno odgovarati na opšta pitanja.
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Savjet: unesite tačne rokove i uslove onako kako ih firma zaista primjenjuje. Aplikacija ne popunjava ove sadržaje.
      </p>
    </div>
  );
}
