'use client';

import * as React from 'react';
import { AlertTriangle, Check, Package, Plus, Search, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { AdditionalProductField, Product, ProductAdditionalData } from '@/lib/domain/types';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, SectionHeader, Spinner } from '@/components/ui/primitives';
import { ProductSearchDialog } from '@/components/workspace/product-search';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/domain/money';
import { relativeTime } from '@/lib/utils';

interface Row extends AdditionalProductField {
  tempId: string;
}

const emptyRow = (): Row => ({
  tempId: Math.random().toString(36).slice(2),
  fieldName: '',
  value: '',
  unit: null,
  note: null,
  addedAt: new Date().toISOString(),
  addedBy: 'local',
});

export function ProductsSection() {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [product, setProduct] = React.useState<Product | null>(null);
  const [additional, setAdditional] = React.useState<ProductAdditionalData | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ product: Product; additional: ProductAdditionalData | null }>(`/api/products/${id}`);
      setProduct(data.product);
      setAdditional(data.additional);
      setRows(
        (data.additional?.fields ?? []).map((f) => ({ ...f, tempId: Math.random().toString(36).slice(2) })),
      );
    } catch (err) {
      toast({ title: 'Proizvod nije učitan', description: (err as Error).message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!product) return;
    const cleaned = rows.filter((r) => r.fieldName.trim() && r.value.trim());
    setSaving(true);
    try {
      const data = await apiFetch<{ additional: ProductAdditionalData }>(`/api/products/${product.id}/additional`, {
        method: 'PUT',
        body: JSON.stringify({
          fields: cleaned.map((r) => ({ fieldName: r.fieldName, value: r.value, unit: r.unit, note: r.note })),
        }),
      });
      setAdditional(data.additional);
      setRows(data.additional.fields.map((f) => ({ ...f, tempId: Math.random().toString(36).slice(2) })));
      toast({ title: 'Dodatne specifikacije su sačuvane', description: 'AI ih sada može koristiti uz jasnu oznaku izvora.' });
    } catch (err) {
      toast({ title: 'Čuvanje nije uspjelo', description: (err as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const scrapedKeys = product ? Object.keys(product.specifications) : [];
  const conflicts = rows.filter((r) => scrapedKeys.some((k) => k.toLowerCase() === r.fieldName.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Dodatne specifikacije proizvoda"
        description="Ručno dodajte provjerene podatke koji nisu na GIGA.ba stranici (dimenzije, težina, kompatibilnost). Čuvaju se odvojeno od izvornih podataka i nikada ne prepisuju izvor."
        action={
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
            <Search className="h-3.5 w-3.5" /> Odaberi proizvod
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      ) : !product ? (
        <div className="rounded-2xl border bg-surface p-8 text-center">
          <Package className="mx-auto h-6 w-6 text-muted-foreground/50" />
          <p className="mt-2 text-[13px] font-medium">Nijedan proizvod nije odabran</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Odaberite proizvod iz kataloga da biste mu dodali provjerene specifikacije.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="h-fit">
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="truncate">{product.name}</CardTitle>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {product.sku ? `SKU ${product.sku}` : 'bez SKU'} · {formatMoney(product.price, product.currency)} ·{' '}
                  {product.availability.status} · provjereno {relativeTime(product.scrapedAt)}
                </p>
              </div>
              <Badge tone="neutral">izvor</Badge>
            </CardHeader>
            <CardBody>
              {Object.keys(product.specifications).length ? (
                <dl className="max-h-72 space-y-1 overflow-y-auto text-[12px]">
                  {Object.entries(product.specifications).map(([k, v]) => (
                    <div key={k} className="flex gap-2 border-b border-dashed pb-1 last:border-0">
                      <dt className="w-2/5 shrink-0 text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 flex-1">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Ova stranica ne prikazuje strukturirane specifikacije. Dodajte ih ručno ako ih znate iz službene dokumentacije.
                </p>
              )}
              <a
                href={product.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
              >
                Otvori GIGA.ba stranicu proizvoda
              </a>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provjereno od agenta ({rows.length})</CardTitle>
              <Badge tone="violet">ručni unos</Badge>
            </CardHeader>
            <CardBody className="space-y-2">
              {rows.map((row, index) => (
                <div key={row.tempId} className="grid grid-cols-12 gap-1.5 rounded-xl border bg-background p-2">
                  <Input
                    className="col-span-4 h-8 text-[12px]"
                    placeholder="Polje (npr. Dimenzije)"
                    value={row.fieldName}
                    onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, fieldName: e.target.value } : r)))}
                  />
                  <Input
                    className="col-span-4 h-8 text-[12px]"
                    placeholder="Vrijednost"
                    value={row.value}
                    onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))}
                  />
                  <Input
                    className="col-span-2 h-8 text-[12px]"
                    placeholder="Jed."
                    value={row.unit ?? ''}
                    onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, unit: e.target.value || null } : r)))}
                  />
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <Input
                      className="h-8 text-[11px]"
                      placeholder="Napomena"
                      title="Napomena"
                      value={row.note ?? ''}
                      onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, note: e.target.value || null } : r)))}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Ukloni polje"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                  {conflicts.some((c) => c.tempId === row.tempId) ? (
                    <p className="col-span-12 flex items-center gap-1 text-[10.5px] text-[hsl(var(--warning))]">
                      <AlertTriangle className="h-3 w-3" />
                      Ovo polje postoji i u izvoru. Obje vrijednosti ostaju sačuvane i vidljive AI-u.
                    </p>
                  ) : null}
                </div>
              ))}

              <Button size="sm" variant="secondary" onClick={() => setRows([...rows, emptyRow()])}>
                <Plus className="h-3.5 w-3.5" /> Dodaj polje
              </Button>

              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-[10.5px] text-muted-foreground">
                  {additional?.updatedAt ? `Ažurirano ${relativeTime(additional.updatedAt)}` : 'Još nema ručnih podataka'}
                </span>
                <Button size="sm" variant="primary" loading={saving} onClick={save} disabled={!rows.length}>
                  <Check className="h-3.5 w-3.5" /> Sačuvaj specifikacije
                </Button>
              </div>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                Navedite samo provjerene podatke iz službene dokumentacije. AI će ih koristiti uz oznaku da ih je dodao agent.
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      <ProductSearchDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Odaberi proizvod"
        description="Pretražite katalog i odaberite proizvod kojem želite dodati provjerene specifikacije."
        onSelect={async (p) => {
          setPickerOpen(false);
          await load(p.id);
        }}
      />
    </div>
  );
}
