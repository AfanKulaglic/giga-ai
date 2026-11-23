'use client';

import * as React from 'react';
import { AlertTriangle, ClipboardCopy, Info, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { CalculationResult } from '@/lib/domain/calculator';
import type { OrderFormField } from '@/lib/domain/types';
import { Badge, Button, Input, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { CopyButton, useCopy } from '@/components/ui/copy-button';
import { useWorkspace } from './workspace-context';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/domain/money';

interface PreparedValue {
  field: OrderFormField;
  value: string;
  provenance: string;
  missing: boolean;
  validationError: string | null;
}

interface PrepareResponse {
  calculation: CalculationResult;
  values: PreparedValue[];
  missingRequired: string[];
  formConfigured: boolean;
  provisional: boolean;
  /** Šta se na giga.ba promijenilo u momentu pripreme narudžbe. */
  liveNotes?: string[];
}

export function OrderModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { detail, calculation, manualDiscount, catalog, updateQuantity, refreshProduct } = useWorkspace();
  const { toast } = useToast();
  const { copy } = useCopy();
  const [prepared, setPrepared] = React.useState<PrepareResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const products = detail?.session.context.products ?? [];
  // Koji proizvodi idu u narudžbu i s kojom količinom — agent to potvrdi ovdje,
  // jer iz razgovora nekad nije jasno koja je tačno dimenzija naručena.
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [weightDraft, setWeightDraft] = React.useState<Record<string, string>>({});
  const [savingWeight, setSavingWeight] = React.useState<string | null>(null);
  const preparedValues = Array.isArray(prepared?.values) ? prepared.values : [];
  const missingQuantity = products.filter(
    (p) => p.quantity === null || p.quantity === undefined || !Number.isFinite(Number(p.quantity)),
  );
  const missingWeight = (prepared?.calculation?.lines ?? []).filter((line) => line.weightKg === null);
  const deliveryIssue = prepared?.calculation?.issues.find((issue) => issue.code === 'WEIGHT_MISSING');
  const weightRulesMissing = prepared?.calculation?.issues.some(
    (issue) => issue.code === 'DELIVERY_WEIGHT_NOT_CONFIGURED',
  );

  const prepare = React.useCallback(async () => {
    if (!detail) return;
    const items = products
      .filter((p) => selected[p.productId] !== false)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        sku: p.sku,
        // Session context can round-trip values as strings; the API expects numbers.
        unitPrice: p.unitPrice === null ? null : Number(p.unitPrice),
        quantity: p.quantity === null ? null : Number(p.quantity),
      }))
      .filter(
        (p) =>
          p.unitPrice !== null &&
          p.quantity !== null &&
          Number.isFinite(p.unitPrice) &&
          Number.isFinite(p.quantity) &&
          p.quantity > 0,
      );
    if (!items.length) {
      setPrepared(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<PrepareResponse>('/api/order-form/prepare', {
        method: 'POST',
        body: JSON.stringify({ sessionId: detail.session.id, items, manualDiscountPercent: manualDiscount }),
      });
      setPrepared(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [detail, products, manualDiscount, selected]);

  React.useEffect(() => {
    if (!open) return;
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of products) {
        next[p.productId] = prev[p.productId] ?? true;
      }
      return next;
    });
  }, [open, products]);

  const saveWeight = async (productId: string) => {
    const raw = (weightDraft[productId] ?? '').replace(',', '.').trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value <= 0)) return;
    const current = catalog[productId]?.additional;
    setSavingWeight(productId);
    try {
      await apiFetch(`/api/products/${encodeURIComponent(productId)}/additional`, {
        method: 'PATCH',
        body: JSON.stringify({
          weightKg: value,
          dimensionsCm: current?.dimensionsCm ?? null,
        }),
      });
      await refreshProduct(productId);
      setWeightDraft((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      setPrepared(null);
      toast({ title: value === null ? 'Kilaža je obrisana' : `Kilaža ${value} kg je sačuvana`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Kilaža nije sačuvana', description: (err as Error).message, tone: 'error' });
    } finally {
      setSavingWeight(null);
    }
  };

  React.useEffect(() => {
    if (open) void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Količina, kilaža i izbor proizvoda mijenjaju iznos — polja se same obnove.
  const quantitiesKey = products.map((p) => `${p.productId}:${p.quantity ?? '-'}`).join(',');
  const weightsKey = products
    .map((p) => `${p.productId}:${catalog[p.productId]?.additional?.weightKg ?? '-'}`)
    .join(',');
  const selectionKey = products.map((p) => `${p.productId}:${selected[p.productId] !== false}`).join(',');
  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void prepare();
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantitiesKey, weightsKey, selectionKey, open]);

  const copyAll = () => {
    if (!prepared) return;
    const text = preparedValues
      .filter((v) => v.value)
      .map((v) => `${v.field.label}: ${v.value}`)
      .join('\n');
    void copy(text, 'Sva polja su kopirana');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide className="max-w-2xl">
        <DialogHeader
          title="Priprema GigaHub narudžbe"
          description="Kopirajte polje po polje u GigaHub. Aplikacija ništa ne šalje niti kreira narudžbu umjesto vas."
        />
        <DialogBody className="space-y-3">
          {detail ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface px-3 py-2">
              <div>
                <p className="text-[12px] font-medium">{detail.session.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {products.length} proizvod(a) · ukupno{' '}
                  <strong className="text-foreground">
                    {calculation?.total !== null && calculation?.total !== undefined
                      ? formatMoney(calculation.total, calculation.currency)
                      : 'nije izračunato'}
                  </strong>
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={prepare} loading={loading}>
                <RefreshCw className="h-3.5 w-3.5" /> Osvježi
              </Button>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger">{error}</p>
          ) : null}

          {loading && !prepared ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
              <Spinner /> pripremam polja…
            </div>
          ) : null}

          {!loading && !products.length ? (
            <p className="rounded-lg border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.07)] px-3 py-2 text-[12px] text-[hsl(var(--warning))]">
              Dodajte proizvode u sesiju prije pripreme narudžbe.
            </p>
          ) : null}

          {prepared?.provisional ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.07)] px-3 py-2 text-[11.5px] leading-relaxed text-[hsl(var(--warning))]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Polja obrasca su privremena i nisu potvrđeni GigaHub raspored. Uredite ih u Postavkama → GigaHub obrazac.
            </p>
          ) : null}

          {prepared && prepared.missingRequired.length ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Nedostaju obavezna polja: {prepared.missingRequired.join(', ')}. Unesite ih u razgovoru ili ručno u GigaHub.
            </p>
          ) : null}

          {prepared?.liveNotes?.length ? (
            <ul className="space-y-1 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-relaxed">
              {prepared.liveNotes.map((note) => (
                <li key={note} className="flex items-start gap-1.5">
                  <RefreshCw className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {products.length ? (
            <div className="rounded-xl border bg-surface">
              <p className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Šta ide u narudžbu
              </p>
              <ul className="divide-y">
                {products.map((p) => {
                  const weight = catalog[p.productId]?.additional?.weightKg ?? null;
                  const draft = weightDraft[p.productId];
                  const checked = selected[p.productId] !== false;
                  return (
                    <li key={p.productId} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${checked ? '' : 'opacity-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setSelected((prev) => ({ ...prev, [p.productId]: event.target.checked }))}
                        aria-label={`Uključi ${p.name} u narudžbu`}
                        className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.unitPrice !== null ? formatMoney(p.unitPrice, p.currency) : 'cijena nepoznata'}
                        </p>
                      </div>
                      <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                        kol.
                        <Input
                          type="number"
                          min={1}
                          value={p.quantity ?? ''}
                          placeholder="?"
                          onChange={(event) => {
                            const raw = event.target.value;
                            const value = raw === '' ? null : Math.max(1, Math.floor(Number(raw)));
                            void updateQuantity(p.productId, value);
                          }}
                          className={`h-7 w-14 px-1 text-center text-[11.5px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${
                            p.quantity ? '' : 'border-danger/40'
                          }`}
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                        kg
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={draft ?? (weight !== null ? String(weight) : '')}
                          placeholder="unesi"
                          onChange={(event) => setWeightDraft((prev) => ({ ...prev, [p.productId]: event.target.value }))}
                          onBlur={() => {
                            if (draft !== undefined) void saveWeight(p.productId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void saveWeight(p.productId);
                            }
                          }}
                          className={`h-7 w-16 px-1 text-center text-[11.5px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${
                            weight === null ? 'border-danger/40' : ''
                          }`}
                        />
                        {savingWeight === p.productId ? <Spinner /> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t px-3 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                Količinu i kilažu možeš upisati ovdje — upis se odmah sprema u sesiju i u proizvod.
              </p>
            </div>
          ) : null}

          {missingQuantity.length && !missingWeight.length ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-relaxed">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Količina još nije poznata za: {missingQuantity.map((p) => p.name).join(', ')}. Upiši je u polje „kol.”
              iznad (ili u razgovoru) pa klikni „Osvježi”.
            </p>
          ) : null}

          {prepared && missingWeight.length ? (
            <div className="rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-danger">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Dostava nije izračunata jer {missingWeight.length === 1 ? 'ovaj proizvod nema' : 'ovi proizvodi nemaju'} kilažu. Upiši je u polje „kg” iznad (ili na kartici proizvoda):
                </span>
              </p>
              <ul className="mt-1 space-y-0.5 pl-5">
                {missingWeight.map((line) => (
                  <li key={line.productId} className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{line.name}</span>
                    <a
                      className="underline underline-offset-2 hover:opacity-80"
                      href={`/products?q=${encodeURIComponent(line.name)}`}
                      title="Otvori proizvod i unesi težinu"
                    >
                      otvori proizvod
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-danger/80">
                Dostava se obračunava isključivo po težini (pravila R13/R14), pa bez kilaže nema cijene. Kilaža se pamti
                uz proizvod i vrijedi za sve buduće narudžbe.
              </p>
              {deliveryIssue ? <p className="mt-1 text-danger/70">{deliveryIssue.message}</p> : null}
            </div>
          ) : null}

          {prepared && weightRulesMissing ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Tarife po težini nisu podešene. Dodaj ih u Postavkama → Kalkulator → „Tarife po težini”.
            </p>
          ) : null}

          {prepared ? (
            <ol className="space-y-1.5">
              {preparedValues.map((item) => (
                <li
                  key={item.field.id}
                  className={`rounded-xl border px-3 py-2 ${
                    item.missing ? 'border-danger/25 bg-danger/[0.03]' : 'bg-background'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold">{item.field.label}</span>
                      {item.field.required ? <Badge tone="neutral">obavezno</Badge> : null}
                      {item.value ? <Badge tone="blue">{item.provenance}</Badge> : <Badge tone="amber">prazno</Badge>}
                      {item.validationError ? <Badge tone="red">{item.validationError}</Badge> : null}
                    </div>
                    <CopyButton
                      text={item.value}
                      label="Kopiraj"
                      size="sm"
                      variant="secondary"
                      toastLabel={`„${item.field.label}” kopirano`}
                    />
                  </div>
                  <pre className="prose-chat mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-foreground/85">
                    {item.value || '—'}
                  </pre>
                </li>
              ))}
            </ol>
          ) : null}
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
          <Button variant="primary" size="sm" onClick={copyAll} disabled={!prepared}>
            <ClipboardCopy className="h-3.5 w-3.5" /> Kopiraj sva polja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
