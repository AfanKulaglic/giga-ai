'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Lock,
  Package,
  PackageX,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { AdditionalProductField, Product, ProductAdditionalData } from '@/lib/domain/types';
import { Badge, Button, EmptyState, Field, Input, Spinner, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/domain/money';
import { formatDate, relativeTime } from '@/lib/utils';

const PAGE_SIZE = 24;

/** "12,5" i "12.5" daju isti broj; prazno polje je null. */
function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

type Row = AdditionalProductField & { tempId: string };

/** Lista proizvoda dolazi sa težinom i dimenzijama, da se odmah vidi šta nedostaje. */
type ProductRow = Product & {
  weightKg?: number | null;
  dimensionsCm?: { lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null;
};

const hasWeightValue = (value: number | null | undefined): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const hasDimensionsValue = (
  dims: { lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null | undefined,
): boolean => Boolean(dims && [dims.lengthCm, dims.widthCm, dims.heightCm].some((v) => typeof v === 'number' && v > 0));

function dimensionsLabel(
  dims: { lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null | undefined,
): string {
  if (!dims) return '';
  const parts = [dims.lengthCm, dims.widthCm, dims.heightCm].filter((v): v is number => typeof v === 'number' && v > 0);
  return parts.length ? `${parts.join(' × ')} cm` : '';
}

const newRow = (): Row => ({
  tempId: Math.random().toString(36).slice(2),
  fieldName: '',
  value: '',
  unit: null,
  note: null,
  addedAt: new Date().toISOString(),
  addedBy: 'local',
});

function stockLabel(product: Product) {
  const status = product.availability?.status;
  if (status === 'in_stock') return { label: 'Na stanju', tone: 'green' as const };
  if (status === 'out_of_stock') return { label: 'Nema na stanju', tone: 'red' as const };
  if (status === 'unknown' || status === 'not_verified') return { label: 'Nije potvrđeno', tone: 'amber' as const };
  return { label: 'Nije potvrđeno', tone: 'amber' as const };
}

export default function ProductsPage() {
  const { toast } = useToast();
  const [query, setQuery] = React.useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('q') ?? ''),
  );
  const [debounced, setDebounced] = React.useState('');
  const [products, setProducts] = React.useState<Product[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    setOffset(0);
  }, [debounced]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debounced) params.set('q', debounced);
    apiFetch<{ products: Product[]; total: number }>(`/api/products?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setProducts(data.products);
        setTotal(data.total);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, offset]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Proizvodi</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Katalog GIGA.ba — detalji, specifikacije i tvoji dodaci koji nisu na sajtu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">
            <Boxes className="h-3 w-3" /> {total} proizvoda
          </Badge>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Traži po nazivu, SKU ili kategoriji…"
            className="pl-9"
            aria-label="Pretraga proizvoda"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Očisti pretragu"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {debounced ? (
          <Badge tone="blue">Rezultati za „{debounced}"</Badge>
        ) : null}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border bg-background">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-5 w-5" />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-[13px] text-danger">{error}</div>
        ) : !products?.length ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title={debounced ? 'Nema rezultata' : 'Katalog je prazan'}
            description={
              debounced
                ? 'Probaj drugi naziv ili SKU. Katalog se puni komandom npm run scraper:sync.'
                : 'Pokreni npm run scraper:sync da uvezeš proizvode sa giga.ba.'
            }
          />
        ) : (
          <ul className="divide-y">
            {products.map((product) => {
              const stock = stockLabel(product);
              return (
                <li key={product.id}>
                  <button
                    onClick={() => setSelectedId(product.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-surface">
                      {product.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <ImageOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium">{product.name}</span>
                        {product.discountPercent ? (
                          <Badge tone="amber">-{Math.round(product.discountPercent)}%</Badge>
                        ) : null}
                        {hasWeightValue((product as ProductRow).weightKg) ? null : (
                          <Badge tone="red" className="shrink-0" title="Dostava se ne može izračunati bez težine">
                            bez težine
                          </Badge>
                        )}
                        {hasDimensionsValue((product as ProductRow).dimensionsCm) ? null : (
                          <Badge tone="red" className="shrink-0" title="Dimenzije nisu unesene u sistem">
                            bez dimenzija
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                        {product.sku ? <span className="font-mono">{product.sku}</span> : <span>bez SKU</span>}
                        {product.brand ? <span>· {product.brand}</span> : null}
                        {product.category ? <span>· {product.category}</span> : null}
                      </span>
                    </span>

                    <span className="hidden shrink-0 text-right sm:block">
                      <span className="block text-[13px] font-semibold tabular-nums">
                        {formatMoney(product.price)}
                      </span>
                      {product.compareAtPrice && product.price && product.compareAtPrice > product.price ? (
                        <span className="block text-[11px] text-muted-foreground line-through tabular-nums">
                          {formatMoney(product.compareAtPrice)}
                        </span>
                      ) : null}
                    </span>

                    <Badge tone={stock.tone} className="hidden md:inline-flex">
                      {stock.tone === 'green' ? <Check className="h-3 w-3" /> : <PackageX className="h-3 w-3" />}
                      {stock.label}
                    </Badge>

                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} od {total}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prethodna
            </Button>
            <span className="px-1 tabular-nums">
              {page} / {pages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= pages || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Sljedeća <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      <ProductDetailDialog
        productId={selectedId}
        onClose={() => setSelectedId(null)}
        onSaved={() => toast({ title: 'Tvoji podaci su sačuvani', tone: 'success' })}
      />
    </div>
  );
}

function ProductDetailDialog({
  productId,
  onClose,
  onSaved,
}: {
  productId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [product, setProduct] = React.useState<Product | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [weightKg, setWeightKg] = React.useState<number | null>(null);
  const [dims, setDims] = React.useState<{ lengthCm: number | null; widthCm: number | null; heightCm: number | null }>({
    lengthCm: null,
    widthCm: null,
    heightCm: null,
  });
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);
  /** Snapshot of what is stored, so clearing a value is also a valid save. */
  const [savedSnapshot, setSavedSnapshot] = React.useState('');

  // Težina i dimenzije su samostalan podatak: ne traže nijedno dodatno polje.
  const hasWeight = weightKg !== null && Number.isFinite(weightKg) && weightKg > 0;
  const hasDims = [dims.lengthCm, dims.widthCm, dims.heightCm].some(
    (v) => v !== null && Number.isFinite(v) && v > 0,
  );
  const hasCustomField = rows.some((r) => r.fieldName.trim() && r.value.trim());
  const currentSnapshot = JSON.stringify({
    weightKg,
    dims,
    fields: rows.filter((r) => r.fieldName.trim() && r.value.trim()).map((r) => [r.fieldName.trim(), r.value.trim()]),
  });
  const dirty = currentSnapshot !== savedSnapshot;
  const canSave = hasWeight || hasDims || hasCustomField || dirty;

  React.useEffect(() => {
    if (!productId) {
      setProduct(null);
      setRows([]);
      setWeightKg(null);
      setDims({ lengthCm: null, widthCm: null, heightCm: null });
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<{ product: Product; additional: ProductAdditionalData | null }>(`/api/products/${productId}`)
      .then((data) => {
        if (cancelled) return;
        setProduct(data.product);
        setRows(
          (data.additional?.fields ?? []).map((f) => ({ ...f, tempId: Math.random().toString(36).slice(2) })),
        );
        setWeightKg(data.additional?.weightKg ?? null);
        setDims({
          lengthCm: data.additional?.dimensionsCm?.lengthCm ?? null,
          widthCm: data.additional?.dimensionsCm?.widthCm ?? null,
          heightCm: data.additional?.dimensionsCm?.heightCm ?? null,
        });
        setUpdatedAt(data.additional?.updatedAt ?? null);
        setSavedSnapshot(
          JSON.stringify({
            weightKg: data.additional?.weightKg ?? null,
            dims: {
              lengthCm: data.additional?.dimensionsCm?.lengthCm ?? null,
              widthCm: data.additional?.dimensionsCm?.widthCm ?? null,
              heightCm: data.additional?.dimensionsCm?.heightCm ?? null,
            },
            fields: (data.additional?.fields ?? []).map((f) => [f.fieldName.trim(), f.value.trim()]),
          }),
        );
      })
      .catch((err: Error) => toast({ title: 'Proizvod nije učitan', description: err.message, tone: 'error' }))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, toast]);

  const save = async () => {
    if (!product) return;
    const fields = rows
      .filter((r) => r.fieldName.trim() && r.value.trim())
      .map((r) => ({
        fieldName: r.fieldName.trim(),
        value: r.value.trim(),
        unit: r.unit?.trim() || null,
        note: r.note?.trim() || null,
      }));
    setSaving(true);
    try {
      const dimensionsCm = hasDims ? dims : null;
      const data = await apiFetch<{ additional: ProductAdditionalData }>(`/api/products/${product.id}/additional`, {
        method: 'PUT',
        body: JSON.stringify({ fields, weightKg: hasWeight ? weightKg : null, dimensionsCm }),
      });
      setRows((data.additional.fields ?? []).map((f) => ({ ...f, tempId: Math.random().toString(36).slice(2) })));
      setWeightKg(data.additional.weightKg ?? null);
      setDims({
        lengthCm: data.additional.dimensionsCm?.lengthCm ?? null,
        widthCm: data.additional.dimensionsCm?.widthCm ?? null,
        heightCm: data.additional.dimensionsCm?.heightCm ?? null,
      });
      setUpdatedAt(data.additional.updatedAt ?? null);
      setSavedSnapshot(
        JSON.stringify({
          weightKg: data.additional.weightKg ?? null,
          dims: {
            lengthCm: data.additional.dimensionsCm?.lengthCm ?? null,
            widthCm: data.additional.dimensionsCm?.widthCm ?? null,
            heightCm: data.additional.dimensionsCm?.heightCm ?? null,
          },
          fields: (data.additional.fields ?? []).map((f) => [f.fieldName.trim(), f.value.trim()]),
        }),
      );
      onSaved();
    } catch (err) {
      toast({ title: 'Nije sačuvano', description: (err as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const stock = product ? stockLabel(product) : null;
  const specs = product ? Object.entries(product.specifications ?? {}) : [];

  return (
    <Dialog open={Boolean(productId)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        {loading || !product ? (
          <div className="flex items-center justify-center py-20">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <>
            <DialogHeader title={product.name} description={product.category ?? 'Bez kategorije'} />
            <DialogBody className="max-h-[72vh] space-y-5 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2">
                {product.sku ? <Badge tone="neutral">SKU {product.sku}</Badge> : null}
                {stock ? (
                  <Badge tone={stock.tone}>
                    {stock.label}
                  </Badge>
                ) : null}
                {product.discountPercent ? <Badge tone="amber">-{Math.round(product.discountPercent)}%</Badge> : null}
                {hasWeightValue(weightKg) ? (
                  <Badge tone="blue">{weightKg} kg</Badge>
                ) : (
                  <Badge tone="red">bez težine — dostava se ne računa</Badge>
                )}
                {hasDimensionsValue(dims) ? (
                  <Badge tone="blue">{dimensionsLabel(dims)}</Badge>
                ) : (
                  <Badge tone="red">bez dimenzija</Badge>
                )}
                <span className="ml-auto text-[15px] font-semibold tabular-nums">{formatMoney(product.price)}</span>
                {product.compareAtPrice && product.price && product.compareAtPrice > product.price ? (
                  <span className="text-[12px] text-muted-foreground line-through tabular-nums">
                    {formatMoney(product.compareAtPrice)}
                  </span>
                ) : null}
              </div>

              {product.images?.length ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {product.images.slice(0, 6).map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={src}
                      src={src}
                      alt=""
                      className="h-24 w-24 shrink-0 rounded-lg border object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              ) : null}

              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Sa sajta (samo za čitanje)
                </h3>
                {specs.length ? (
                  <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {specs.map(([key, value]) => (
                      <div key={key} className="rounded-lg border bg-surface/60 px-2.5 py-1.5">
                        <dt className="text-[11px] text-muted-foreground">{key}</dt>
                        <dd className="text-[12.5px]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">Specifikacije nisu objavljene na sajtu.</p>
                )}
              </section>

              {product.variants?.length ? (
                <section>
                  <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Varijante
                  </h3>
                  <ul className="space-y-1">
                    {product.variants.map((variant) => (
                      <li key={variant.id} className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[12.5px]">
                        <span>{variant.title || 'Standard'}</span>
                        <span className="flex items-center gap-2 tabular-nums">
                          <span>{formatMoney(variant.price)}</span>
                          <Badge tone={variant.available ? 'green' : 'red'}>
                            {variant.available ? 'Dostupno' : 'Nedostupno'}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {product.shortDescription ? (
                <section>
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Opis
                  </h3>
                  <p className="text-[12.5px] leading-relaxed text-foreground/80">{product.shortDescription}</p>
                </section>
              ) : null}

              <section className="rounded-lg border bg-surface/50 px-3 py-2 text-[11.5px] text-muted-foreground">
                <p>
                  Ažurirano na sajtu: {formatDate(product.sourceUpdatedAt)} · uvezeno: {relativeTime(product.scrapedAt)}
                </p>
                <p className="mt-0.5">
                  Status ekstrakcije: {product.extractionStatus}
                  {product.missingFields?.length ? ` · nedostaje: ${product.missingFields.join(', ')}` : ''}
                </p>
                <Link
                  href={product.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Otvori na giga.ba <ExternalLink className="h-3 w-3" />
                </Link>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Tvoji podaci
                    </h3>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      Ono što nije na sajtu: dimenzije, materijal, boja, rok isporuke, napomene…
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setRows([...rows, newRow()])}>
                    <Plus className="h-3.5 w-3.5" /> Dodaj
                  </Button>
                </div>

                <div className="mb-2 rounded-lg border border-primary/25 bg-primary/[0.04] p-2.5">
                  <p className="text-[11.5px] font-semibold">Težina i dimenzije (za dostavu)</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Težina je obavezna za obračun dostave: do 10 kg, do 20 kg, do 30 kg… Možeš unijeti i 12,5 (zarez).
                  </p>
                  {updatedAt ? (
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      Zadnja izmjena: {formatDate(updatedAt)} · {relativeTime(updatedAt)}
                    </p>
                  ) : null}
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <Field label="Težina (kg)">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={weightKg ?? ''}
                        onChange={(e) => setWeightKg(parseDecimal(e.target.value))}
                        placeholder="npr. 12.5"
                      />
                    </Field>
                    <Field label="Dužina (cm)">
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={dims.lengthCm ?? ''}
                        onChange={(e) => setDims({ ...dims, lengthCm: parseDecimal(e.target.value) })}
                        placeholder="npr. 180"
                      />
                    </Field>
                    <Field label="Širina (cm)">
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={dims.widthCm ?? ''}
                        onChange={(e) => setDims({ ...dims, widthCm: parseDecimal(e.target.value) })}
                        placeholder="npr. 90"
                      />
                    </Field>
                    <Field label="Visina (cm)">
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={dims.heightCm ?? ''}
                        onChange={(e) => setDims({ ...dims, heightCm: parseDecimal(e.target.value) })}
                        placeholder="npr. 75"
                      />
                    </Field>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-[12px] text-muted-foreground">
                    Još nema dodatnih polja. Težina i dimenzije iznad se čuvaju i bez njih.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((row, index) => (
                      <li key={row.tempId} className="rounded-lg border p-2">
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_80px_auto]">
                          <Field label="Naziv polja">
                            <Input
                              value={row.fieldName}
                              onChange={(e) => {
                                const next = [...rows];
                                next[index] = { ...row, fieldName: e.target.value };
                                setRows(next);
                              }}
                              placeholder="npr. Dimenzije"
                            />
                          </Field>
                          <Field label="Vrijednost">
                            <Input
                              value={row.value}
                              onChange={(e) => {
                                const next = [...rows];
                                next[index] = { ...row, value: e.target.value };
                                setRows(next);
                              }}
                              placeholder="npr. 180 × 90 cm"
                            />
                          </Field>
                          <Field label="Jedinica">
                            <Input
                              value={row.unit ?? ''}
                              onChange={(e) => {
                                const next = [...rows];
                                next[index] = { ...row, unit: e.target.value };
                                setRows(next);
                              }}
                              placeholder="cm"
                            />
                          </Field>
                          <div className="flex items-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRows(rows.filter((r) => r.tempId !== row.tempId))}
                              aria-label="Ukloni polje"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          value={row.note ?? ''}
                          onChange={(e) => {
                            const next = [...rows];
                            next[index] = { ...row, note: e.target.value };
                            setRows(next);
                          }}
                          placeholder="Napomena (opciono)"
                          rows={2}
                          className="mt-2"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Zatvori
              </Button>
              <Button
                variant="primary"
                onClick={save}
                loading={saving}
                disabled={!canSave}
                title={canSave ? undefined : 'Unesi težinu, dimenzije ili neko svoje polje'}
              >
                Sačuvaj moje podatke
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
