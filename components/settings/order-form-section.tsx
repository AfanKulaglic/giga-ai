'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSettings } from './settings-context';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  SectionHeader,
  Switch,
} from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { OrderFieldSource, OrderFieldType, OrderFormField } from '@/lib/domain/types';

const SOURCES: { id: OrderFieldSource; label: string }[] = [
  { id: 'customer.name', label: 'Ime kupca' },
  { id: 'customer.phone', label: 'Telefon kupca' },
  { id: 'customer.email', label: 'Email kupca' },
  { id: 'customer.address', label: 'Adresa kupca' },
  { id: 'customer.city', label: 'Grad kupca' },
  { id: 'customer.postalCode', label: 'Poštanski broj' },
  { id: 'order.products', label: 'Lista proizvoda' },
  { id: 'order.itemsBreakdown', label: 'Detaljna stavka po stavka' },
  { id: 'order.itemsTotal', label: 'Cijena proizvoda (bez dostave)' },
  { id: 'order.total', label: 'Ukupan iznos (sa dostavom)' },
  { id: 'order.delivery', label: 'Dostava' },
  { id: 'order.discount', label: 'Popust' },
  { id: 'order.note', label: 'Napomena' },
  { id: 'manual', label: 'Ručni unos (prazno)' },
];

const TYPES: { id: OrderFieldType; label: string }[] = [
  { id: 'text', label: 'Tekst' },
  { id: 'multiline', label: 'Više redova' },
  { id: 'number', label: 'Broj' },
  { id: 'tel', label: 'Telefon' },
  { id: 'email', label: 'Email' },
  { id: 'select', label: 'Izbor' },
];

const uid = () => `field_${Math.random().toString(36).slice(2, 9)}`;

export function OrderFormSection() {
  const { settings, updateSettings, save, dirty, saving } = useSettings();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<OrderFormField | null>(null);

  if (!settings) return null;
  const fields = [...settings.orderForm.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  const write = (next: OrderFormField[]) =>
    updateSettings((prev) => ({
      ...prev,
      orderForm: { fields: next.map((f, i) => ({ ...f, sortOrder: (i + 1) * 10 })), updatedAt: new Date().toISOString() },
    }));

  const move = (index: number, direction: -1 | 1) => {
    const next = [...fields];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    write(next);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="GigaHub obrazac"
        description="Definišite polja i njihov redoslijed. Modal prikazuje vrijednosti tačno ovim redom, svako polje ima svoje dugme za kopiranje. Aplikacija ništa ne upisuje u GigaHub."
        action={
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setEditing({
                  id: uid(),
                  key: `field_${fields.length + 1}`,
                  label: 'Novo polje',
                  type: 'text',
                  required: false,
                  sortOrder: (fields.length + 1) * 10,
                  source: 'manual',
                  defaultValue: null,
                  placeholder: null,
                  validation: null,
                  provisional: true,
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Dodaj polje
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              disabled={!dirty}
              onClick={async () => {
                try {
                  await save();
                  toast({ title: 'Obrazac je sačuvan' });
                } catch (err) {
                  toast({ title: 'Čuvanje nije uspjelo', description: (err as Error).message, tone: 'error' });
                }
              }}
            >
              <Check className="h-3.5 w-3.5" /> Sačuvaj
            </Button>
          </div>
        }
      />

      {fields.some((f) => f.provisional) ? (
        <p className="rounded-xl border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.06)] px-3 py-2 text-[11.5px] leading-relaxed text-[hsl(var(--warning))]">
          Neka polja su privremena i nisu potvrđeni GigaHub raspored. Kada dobijete tačnu šemu, uredite labele, redoslijed i
          obaveznost. Ovdje nema izmišljenih obaveznih polja iz GigaHuba.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Polja obrasca ({fields.length})</CardTitle>
          <Badge tone="neutral">redoslijed = redoslijed kopiranja</Badge>
        </CardHeader>
        <CardBody className="p-0">
          <ul className="divide-y">
            {fields.map((field, index) => (
              <li key={field.id} className="flex items-center gap-2 px-3.5 py-2">
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] font-medium">{field.label}</span>
                    <Badge tone="neutral">{field.key}</Badge>
                    {field.required ? <Badge tone="blue">obavezno</Badge> : null}
                    {field.provisional ? <Badge tone="amber">privremeno</Badge> : null}
                  </div>
                  <p className="text-[10.5px] text-muted-foreground">
                    {TYPES.find((t) => t.id === field.type)?.label} · izvor: {SOURCES.find((s) => s.id === field.source)?.label}
                    {field.validation?.pattern ? ' · validacija' : ''}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label="Gore" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Dolje" disabled={index === fields.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Uredi" onClick={() => setEditing(field)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Obriši"
                  onClick={() => write(fields.filter((f) => f.id !== field.id))}
                >
                  <Trash2 className="h-3 w-3 text-danger/80" />
                </Button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent wide>
          <DialogHeader title="Uredi polje obrasca" description="Mapiranje određuje odakle se vrijednost puni. „Ručni unos” ostaje prazan." />
          <DialogBody className="space-y-3">
            {editing ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Naziv polja (label)">
                    <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                  </Field>
                  <Field label="Interni ključ">
                    <Input value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} className="font-mono text-[12px]" />
                  </Field>
                  <Field label="Tip polja">
                    <select
                      value={editing.type}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value as OrderFieldType })}
                      className="h-9 w-full rounded-[10px] border border-input bg-background px-3 text-sm"
                    >
                      {TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Izvor vrijednosti">
                    <select
                      value={editing.source}
                      onChange={(e) => setEditing({ ...editing, source: e.target.value as OrderFieldSource })}
                      className="h-9 w-full rounded-[10px] border border-input bg-background px-3 text-sm"
                    >
                      {SOURCES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Podrazumijevana vrijednost">
                    <Input
                      value={editing.defaultValue ?? ''}
                      onChange={(e) => setEditing({ ...editing, defaultValue: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Placeholder">
                    <Input
                      value={editing.placeholder ?? ''}
                      onChange={(e) => setEditing({ ...editing, placeholder: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Regex validacija" hint="opciono">
                    <Input
                      value={editing.validation?.pattern ?? ''}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          validation: { ...(editing.validation ?? {}), pattern: e.target.value || null },
                        })
                      }
                      placeholder="npr. ^\\d{5}$"
                      className="font-mono text-[12px]"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Min dužina">
                      <Input
                        type="number"
                        min={0}
                        value={editing.validation?.minLength ?? ''}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            validation: { ...(editing.validation ?? {}), minLength: e.target.value === '' ? null : Number(e.target.value) },
                          })
                        }
                      />
                    </Field>
                    <Field label="Maks dužina">
                      <Input
                        type="number"
                        min={0}
                        value={editing.validation?.maxLength ?? ''}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            validation: { ...(editing.validation ?? {}), maxLength: e.target.value === '' ? null : Number(e.target.value) },
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-[12.5px]">
                    <Switch checked={editing.required} onCheckedChange={(v) => setEditing({ ...editing, required: v })} />
                    Obavezno polje
                  </label>
                  <label className="flex items-center gap-2 text-[12.5px]">
                    <Switch checked={editing.provisional} onCheckedChange={(v) => setEditing({ ...editing, provisional: v })} />
                    Privremeno (nije potvrđeno)
                  </label>
                </div>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Odustani
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!editing?.label?.trim()}
              onClick={() => {
                if (!editing) return;
                const exists = fields.some((f) => f.id === editing.id);
                write(exists ? fields.map((f) => (f.id === editing.id ? editing : f)) : [...fields, editing]);
                setEditing(null);
              }}
            >
              <Check className="h-3.5 w-3.5" /> Primijeni
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
