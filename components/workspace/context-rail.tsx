'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Calculator as CalculatorIcon,
  ChevronDown,
  ClipboardList,
  Minus,
  Package,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useWorkspace } from './workspace-context';
import { ProductSearchDialog } from './product-search';
import { Badge, Button, Card, EmptyState, Input } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/domain/money';
import { cn, relativeTime } from '@/lib/utils';

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  action,
  scrollable: _scrollable = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  /** Kept for compatibility: every card now scrolls its own body. */
  scrollable?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    // Cards share the column height equally; the body scrolls when it overflows.
    <Card className={cn('overflow-hidden', open ? 'flex min-h-[96px] flex-1 flex-col' : 'flex-none')}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-1.5 text-left">
          <span className="text-muted-foreground">{icon}</span>
          <span className="truncate text-[12.5px] font-semibold tracking-[-0.01em]">{title}</span>
          <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {action}
      </div>
      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t px-3 py-2.5 pr-2">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

export function ContextRail({ onOpenOrder }: { onOpenOrder: () => void }) {
  const {
    detail,
    catalog,
    calculation,
    manualDiscount,
    setManualDiscount,
    addProductToContext,
    updateQuantity,
    removeProduct,
    refreshProduct,
    bootstrap,
  } = useWorkspace();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [busyProduct, setBusyProduct] = React.useState<string | null>(null);

  if (!detail) {
    return (
      <div className="panel flex items-center justify-center p-4">
        <EmptyState icon={<Package className="h-6 w-6" />} title="Kontekst i kalkulator" description="Odaberite sesiju." />
      </div>
    );
  }

  const context = detail.session.context;
  const products = context.products;
  const intent = context.orderIntent;
  const settings = bootstrap?.settings;

  const intentBadge =
    intent.value === 'confirmed' ? (
      <Badge tone="green">narudžba potvrđena</Badge>
    ) : intent.value === 'interested' ? (
      <Badge tone="blue">zainteresovan</Badge>
    ) : intent.value === 'declined' ? (
      <Badge tone="neutral">odustao</Badge>
    ) : intent.value === 'browsing' ? (
      <Badge tone="neutral">razgleda</Badge>
    ) : (
      <Badge tone="neutral">status nepoznat</Badge>
    );

  // Šta od podataka za narudžbu još nije rečeno — kartica to pokaže odmah,
  // čim kupac pošalje poruku (bez čekanja na AI).
  const customerFieldLabels: { key: keyof typeof context.customer; label: string }[] = [
    { key: 'name', label: 'ime i prezime' },
    { key: 'phone', label: 'telefon' },
    { key: 'address', label: 'adresa' },
    { key: 'city', label: 'grad' },
  ];
  const missingCustomerFields = customerFieldLabels
    .filter(({ key }) => !String(context.customer[key] ?? '').trim())
    .map(({ label }) => label);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden pr-0.5">
      <Section title="Kupac" icon={<UserRound className="h-3.5 w-3.5" />} action={intentBadge}>
        <div className="space-y-1 text-[12px]">
          {context.customer.name || context.customer.phone || context.customer.city ? (
            <>
              {context.customer.name ? <p className="font-medium">{context.customer.name}</p> : null}
              <p className="text-muted-foreground">
                {[context.customer.phone, context.customer.email, [context.customer.city, context.customer.address].filter(Boolean).join(', ')]
                  .filter(Boolean)
                  .join(' · ') || 'Kontakt nije poznat'}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Podaci kupca još nisu zabilježeni. AI ih može izvući iz razgovora.</p>
          )}
          {missingCustomerFields.length || context.missingInfo.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {missingCustomerFields.map((label) => (
                <Badge key={label} tone="amber">
                  nedostaje: {label}
                </Badge>
              ))}
              {context.missingInfo.slice(0, 6).map((m, i) => (
                <Badge key={`other-${i}`} tone="amber">
                  nedostaje: {m}
                </Badge>
              ))}
            </div>
          ) : null}
          {context.outstandingQuestions.filter((q) => !q.resolved).length ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Otvoreno: {context.outstandingQuestions.filter((q) => !q.resolved).map((q) => q.question).join(' · ')}
            </p>
          ) : null}
        </div>
      </Section>

      <Section
        title={`Proizvodi u sesiji (${products.length})`}
        icon={<Package className="h-3.5 w-3.5" />}
        action={
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setSearchOpen(true)}>
            <Plus className="h-3 w-3" /> Dodaj
          </Button>
        }
      >
        {products.length === 0 ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="Nema proizvoda"
            description="Dodajte proizvod iz kataloga ili neka ga AI pronađe kroz razgovor."
            className="py-4"
          />
        ) : (
          <ul className="space-y-2">
            {products.map((p) => {
              const fresh = catalog[p.productId]?.product;
              const drifted = fresh && p.unitPrice !== null && fresh.price !== null && fresh.price !== p.unitPrice;
              return (
                <li key={p.productId} className="rounded-xl border bg-background p-2.5">
                  <div className="flex items-start gap-2">
                    {/* Slika proizvoda: agent odmah vidi o komadu je riječ. */}
                    <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
                      <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {catalog[p.productId]?.product.images?.[0] ? (
                        <a
                          href={catalog[p.productId]!.product.images[0]!}
                          target="_blank"
                          rel="noreferrer"
                          title="Otvori sliku proizvoda"
                          className="absolute inset-0"
                        >
                          <img
                            src={catalog[p.productId]!.product.images[0]!}
                            alt={p.name}
                            className="h-full w-full object-cover"
                            onError={(event) => {
                              event.currentTarget.parentElement?.remove();
                            }}
                          />
                        </a>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[12.5px] font-medium leading-snug">
                        <span className="truncate">{p.name}</span>
                        {typeof catalog[p.productId]?.additional?.weightKg === 'number' ? null : (
                          <Badge tone="red" className="shrink-0" title="Dostava se ne može izračunati bez težine">
                            bez težine
                          </Badge>
                        )}
                        {(() => {
                          const dims = catalog[p.productId]?.additional?.dimensionsCm;
                          const ok = Boolean(
                            dims && [dims.lengthCm, dims.widthCm, dims.heightCm].some((v) => typeof v === 'number' && v > 0),
                          );
                          return ok ? null : (
                            <Badge tone="red" className="shrink-0" title="Dimenzije nisu unesene u sistem">
                              bez dimenzija
                            </Badge>
                          );
                        })()}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                        {p.sku ? <span className="font-mono">SKU {p.sku} · </span> : null}
                        {p.unitPrice !== null ? formatMoney(p.unitPrice, p.currency) : 'cijena nepoznata'} · provjereno{' '}
                        {relativeTime(fresh?.scrapedAt ?? p.priceCheckedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Osvježi cijenu"
                        title="Provjeri trenutnu cijenu u katalogu"
                        onClick={async () => {
                          setBusyProduct(p.productId);
                          await refreshProduct(p.productId).catch(() => undefined);
                          setBusyProduct(null);
                        }}
                      >
                        <RefreshCw className={`h-3 w-3 ${busyProduct === p.productId ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Ukloni proizvod"
                        onClick={() => removeProduct(p.productId)}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                    </div>
                  </div>

                  {drifted ? (
                    <div className="mt-1.5 rounded-lg border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] px-2 py-1.5 text-[10.5px] text-[hsl(var(--warning))]">
                      Cijena u katalogu je promijenjena na {formatMoney(fresh.price, fresh.currency)}. Potvrdite koju cijenu koristiti.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-1 h-5 px-1 text-[10px]"
                        onClick={() => refreshProduct(p.productId)}
                      >
                        Preuzmi novu
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Smanji količinu"
                        disabled={(p.quantity ?? 1) <= 1}
                        onClick={() => updateQuantity(p.productId, Math.max(1, (p.quantity ?? 1) - 1))}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        value={p.quantity ?? ''}
                        placeholder="?"
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          void updateQuantity(p.productId, v === null ? null : Math.max(1, Math.floor(v)));
                        }}
                        className="h-6 w-12 px-1 text-center text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Povećaj količinu"
                        onClick={() => updateQuantity(p.productId, (p.quantity ?? 0) + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    {p.quantity !== null && p.unitPrice !== null ? (
                      <span className="text-[11.5px] font-medium tabular-nums">
                        {formatMoney(p.quantity * p.unitPrice, p.currency)}
                      </span>
                    ) : (
                      <Badge tone="amber">količina nije poznata</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Kalkulator narudžbe" icon={<CalculatorIcon className="h-3.5 w-3.5" />} scrollable>
        {!calculation ? (
          <p className="py-2 text-[12px] leading-relaxed text-muted-foreground">
            Dodajte proizvode s poznatom cijenom i količinom da bi se izračunao iznos.
          </p>
        ) : (
          <div className="space-y-2">
            {calculation.lines.map((l) => (
              <div key={l.productId} className="flex items-start justify-between gap-2 text-[12px]">
                <div className="min-w-0">
                  <p className="truncate">{l.name}</p>
                  <p className="text-[10.5px] text-muted-foreground tabular-nums">
                    {formatMoney(l.unitPrice, calculation.currency)} × {l.quantity}
                    {l.lineWeightKg !== null ? ` · ${l.lineWeightKg} kg` : ''}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{formatMoney(l.lineTotal, calculation.currency)}</span>
              </div>
            ))}

            <div className="space-y-1 border-t pt-2 text-[12px]">
              <div className="flex justify-between text-muted-foreground">
                <span>Međusuma</span>
                <span className="tabular-nums">{formatMoney(calculation.subtotal, calculation.currency)}</span>
              </div>
              {calculation.discounts.map((d) => (
                <div key={d.ruleId} className="flex justify-between text-[hsl(var(--success))]">
                  <span className="truncate pr-2" title={d.reason}>
                    {d.name}
                  </span>
                  <span className="tabular-nums">-{formatMoney(d.amount, calculation.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between text-muted-foreground">
                <span className="truncate pr-2" title={calculation.delivery.reason}>
                  {calculation.delivery.name}
                </span>
                <span className="tabular-nums">
                  {calculation.delivery.status === 'applied'
                    ? formatMoney(calculation.delivery.amount, calculation.currency)
                    : 'po dogovoru'}
                </span>
              </div>
              {calculation.totalWeightKg !== null ? (
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Ukupna težina</span>
                  <span className="tabular-nums">{calculation.totalWeightKg} kg</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-1.5 text-[13px] font-semibold">
                <span>Ukupno</span>
                <span className="tabular-nums">
                  {calculation.total !== null ? formatMoney(calculation.total, calculation.currency) : '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <label className="text-[11px] text-muted-foreground" htmlFor="manual-discount">
                Ručni popust %
              </label>
              <Input
                id="manual-discount"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={manualDiscount ?? ''}
                placeholder="0"
                onChange={(e) => setManualDiscount(e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value))))}
                className="h-7 w-20 text-[12px]"
              />
            </div>

            {settings && settings.calculator.deliveryRules.filter((r) => r.enabled).length === 0 ? (
              <p className="flex items-start gap-1 rounded-lg border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.07)] px-2 py-1.5 text-[10.5px] leading-relaxed text-[hsl(var(--warning))]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Pravila dostave nisu konfigurirana. Postavite ih u{' '}
                  <Link href="/settings?tab=calculator" className="underline">
                    Postavkama
                  </Link>{' '}
                  ili potvrdite cijenu ručno.
                </span>
              </p>
            ) : null}

            {calculation.issues.length ? (
              <ul className="space-y-1">
                {calculation.issues.map((issue, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1 rounded-lg border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.06)] px-2 py-1 text-[10.5px] leading-relaxed text-[hsl(var(--warning))]"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        <Button
          variant="primary"
          size="md"
          className="mt-2.5 w-full"
          onClick={onOpenOrder}
          disabled={products.length === 0}
          title="Priprema podataka za ručni unos u GigaHub"
        >
          <ClipboardList className="h-4 w-4" /> Pripremi GigaHub narudžbu
        </Button>
      </Section>

      <Section title="Brzi podsjetnici" icon={<ShoppingCart className="h-3.5 w-3.5" />} defaultOpen={false}>
        <ul className="space-y-1 text-[11.5px] leading-relaxed text-muted-foreground">
          <li>• Cijene i dostupnost uvijek provjerite prije nego ih navedete kupcu.</li>
          <li>• Narudžbu ne kreirajte automatski — unosite je ručno u GigaHub.</li>
          <li>• Interne bilješke i upute AI-u nikada se ne šalju kupcu.</li>
        </ul>
      </Section>

      <ProductSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        selectedIds={products.map((p) => p.productId)}
        onSelect={async (product) => {
          await addProductToContext(product, 1);
        }}
      />
    </div>
  );
}
