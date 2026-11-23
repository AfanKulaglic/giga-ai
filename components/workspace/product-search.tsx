'use client';

import * as React from 'react';
import { Check, Package, Plus, Search } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { AdditionalProductField, Product } from '@/lib/domain/types';
import { Badge, Button, EmptyState, Input, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/domain/money';
import { relativeTime } from '@/lib/utils';

type Dimensions = { lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null;

type ProductWithAdditional = Product & {
  additionalFields?: AdditionalProductField[];
  weightKg?: number | null;
  dimensionsCm?: Dimensions;
};

const hasDims = (dims: Dimensions | undefined): boolean =>
  Boolean(dims && [dims.lengthCm, dims.widthCm, dims.heightCm].some((v) => typeof v === 'number' && v > 0));

export function ProductSearchDialog({
  open,
  onOpenChange,
  onSelect,
  selectedIds = [],
  title = 'Dodaj proizvod',
  description = 'Pretražite katalog GIGA.ba po nazivu ili SKU. Cijena se preuzima iz kataloga, ne iz razgovora.',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (product: Product) => void | Promise<void>;
  selectedIds?: string[];
  title?: string;
  description?: string;
}) {
  const [query, setQuery] = React.useState('');
  const [products, setProducts] = React.useState<ProductWithAdditional[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ products: ProductWithAdditional[] }>(
          `/api/products?limit=20${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`,
        );
        if (!cancelled) setProducts(data.products);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 260 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader title={title} description={description} />
        <DialogBody className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Naziv proizvoda ili SKU…"
              className="pl-8"
            />
            {loading ? <Spinner className="absolute right-2.5 top-1/2 -translate-y-1/2" /> : null}
          </div>

          {error ? (
            <p className="rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger">{error}</p>
          ) : null}

          {!loading && !products.length && !error ? (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title={query ? 'Nema rezultata' : 'Katalog je prazan'}
              description={
                query
                  ? 'Pokušajte drugačiji naziv ili SKU.'
                  : 'Pokrenite testni ili puni uvoz u Postavkama → Sinkronizacija kataloga.'
              }
            />
          ) : (
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {products.map((p) => {
                const added = selectedIds.includes(p.id);
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{p.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {p.sku ? <span className="font-mono">SKU {p.sku}</span> : <span>bez SKU</span>}
                        {p.category ? <span>· {p.category}</span> : null}
                        <span>· {p.price !== null ? formatMoney(p.price, p.currency) : 'cijena nije poznata'}</span>
                        <span>· provjereno {relativeTime(p.scrapedAt)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {typeof p.weightKg === 'number' && p.weightKg > 0 ? null : (
                        <Badge tone="red" title="Bez težine se dostava ne može izračunati">
                          bez težine
                        </Badge>
                      )}
                      {hasDims(p.dimensionsCm) ? null : (
                        <Badge tone="red" title="Dimenzije nisu unesene u sistem">
                          bez dimenzija
                        </Badge>
                      )}
                      {p.availability.status === 'in_stock' ? (
                        <Badge tone="green">dostupno*</Badge>
                      ) : p.availability.status === 'out_of_stock' ? (
                        <Badge tone="red">nema na stanju*</Badge>
                      ) : p.availability.status === 'partial' ? (
                        <Badge tone="amber">djelimično*</Badge>
                      ) : (
                        <Badge tone="neutral">nepoznato</Badge>
                      )}
                      <Button
                        size="sm"
                        variant={added ? 'ghost' : 'primary'}
                        disabled={added}
                        loading={adding === p.id}
                        onClick={async () => {
                          setAdding(p.id);
                          try {
                            await onSelect(p);
                          } finally {
                            setAdding(null);
                          }
                        }}
                      >
                        {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {added ? 'Dodano' : 'Dodaj'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10.5px] text-muted-foreground">
            * Dostupnost je izvedena iz podataka GIGA.ba u navedenom trenutku i može se promijeniti. Provjerite prije potvrde kupcu.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
