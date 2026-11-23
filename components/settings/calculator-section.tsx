'use client';

import * as React from 'react';
import { Check, Plus, Sparkles, Trash2, Truck, Tag, X } from 'lucide-react';
import { useSettings } from './settings-context';
import { ProductSearchDialog } from '@/components/workspace/product-search';
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
  Textarea,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { DeliveryRule, DiscountRule } from '@/lib/domain/types';
import { formatMoney } from '@/lib/domain/money';

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function CalculatorSection() {
  const { settings, updateSettings, save, dirty, saving } = useSettings();
  const { toast } = useToast();
  const [scopeFor, setScopeFor] = React.useState<DiscountRule | null>(null);
  if (!settings) return null;
  const calc = settings.calculator;

  const update = (fn: (prev: typeof calc) => typeof calc) =>
    updateSettings((prev) => ({ ...prev, calculator: { ...fn(prev.calculator), updatedAt: new Date().toISOString() } }));

  const patchDelivery = (id: string, patch: Partial<DeliveryRule>) =>
    update((prev) => ({
      ...prev,
      deliveryRules: prev.deliveryRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  const patchDiscount = (id: string, patch: Partial<DiscountRule>) =>
    update((prev) => ({
      ...prev,
      discountRules: prev.discountRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Popusti i dostava"
        description="Pravila moraju biti izričito unesena. Aplikacija ne izmišlja pragove, cijene dostave ni akcije. Kalkulator ih primjenjuje deterministički."
        action={
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={!dirty}
            onClick={async () => {
              try {
                await save();
                toast({ title: 'Pravila su sačuvana' });
              } catch (err) {
                toast({ title: 'Čuvanje nije uspjelo', description: (err as Error).message, tone: 'error' });
              }
            }}
          >
            <Check className="h-3.5 w-3.5" /> Sačuvaj pravila
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
              <CardTitle>Dostava</CardTitle>
            </div>
            <Badge tone={calc.deliveryPolicy === 'rules' ? (calc.deliveryRules.some((r) => r.enabled) ? 'green' : 'amber') : 'amber'}>
              {calc.deliveryPolicy === 'rules'
                ? calc.deliveryRules.some((r) => r.enabled)
                  ? 'pravila aktivna'
                  : 'nema aktivnih pravila'
                : 'po dogovoru'}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2">
              <span>
                <span className="block text-[12.5px] font-medium">Koristi pravila dostave</span>
                <span className="block text-[11px] text-muted-foreground">
                  Isključeno = kalkulator traži ručnu potvrdu cijene dostave.
                </span>
              </span>
              <Switch
                checked={calc.deliveryPolicy === 'rules'}
                onCheckedChange={(v) => update((prev) => ({ ...prev, deliveryPolicy: v ? 'rules' : 'on_request' }))}
              />
            </label>

            {calc.deliveryRules.map((rule) => (
              <div key={rule.id} className="space-y-2 rounded-xl border bg-background p-2.5">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={rule.name}
                    onChange={(e) => patchDelivery(rule.id, { name: e.target.value })}
                    className="h-8 flex-1 text-[12.5px]"
                    placeholder="Naziv pravila"
                  />
                  <Switch checked={rule.enabled} onCheckedChange={(v) => patchDelivery(rule.id, { enabled: v })} />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Obriši pravilo"
                    onClick={() => update((prev) => ({ ...prev, deliveryRules: prev.deliveryRules.filter((r) => r.id !== rule.id) }))}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Tip">
                    <select
                      value={rule.type}
                      onChange={(e) => patchDelivery(rule.id, { type: e.target.value as DeliveryRule['type'] })}
                      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-[12px]"
                    >
                      <option value="flat">Fiksna cijena</option>
                      <option value="free_above">Besplatno iznad iznosa</option>
                      <option value="per_item">Po artiklu</option>
                      <option value="by_weight">Po težini (tarife ispod)</option>
                      <option value="on_request">Po dogovoru</option>
                    </select>
                  </Field>
                  <Field label="Iznos (KM)">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={rule.amount ?? ''}
                      onChange={(e) => patchDelivery(rule.id, { amount: e.target.value === '' ? null : Number(e.target.value) })}
                      className="h-8 text-[12px]"
                    />
                  </Field>
                  {rule.type === 'free_above' ? (
                    <Field label="Besplatno od (KM)">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={rule.freeAbove ?? ''}
                        onChange={(e) => patchDelivery(rule.id, { freeAbove: e.target.value === '' ? null : Number(e.target.value) })}
                        className="h-8 text-[12px]"
                      />
                    </Field>
                  ) : null}
                  <Field label="Napomena" className={rule.type === 'free_above' ? '' : 'col-span-2'}>
                    <Input
                      value={rule.note ?? ''}
                      onChange={(e) => patchDelivery(rule.id, { note: e.target.value || null })}
                      className="h-8 text-[12px]"
                      placeholder="Opciono"
                    />
                  </Field>
                </div>
              </div>
            ))}

            <div className="space-y-2 rounded-xl border border-dashed bg-muted/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11.5px] font-semibold">Tarife po težini</p>
                  <p className="text-[11px] text-muted-foreground">
                    Cijena dostave za ukupnu težinu narudžbe. Provjerava se od najlakše tarife prema težoj.
                  </p>
                </div>
                <Badge tone={calc.weightTiers.some((t) => t.enabled) ? 'green' : 'amber'}>
                  {calc.weightTiers.filter((t) => t.enabled).length} aktivno
                </Badge>
              </div>

              {calc.weightTiers.map((tier) => (
                <div key={tier.id} className="flex items-end gap-1.5">
                  <Field label="Do (kg)" className="w-24">
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={tier.upToKg}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          weightTiers: prev.weightTiers.map((t) =>
                            t.id === tier.id ? { ...t, upToKg: e.target.value === '' ? 0 : Number(e.target.value) } : t,
                          ),
                        }))
                      }
                      className="h-8 text-[12px]"
                    />
                  </Field>
                  <Field label="Cijena (KM)" className="w-28">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={tier.amount}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          weightTiers: prev.weightTiers.map((t) =>
                            t.id === tier.id ? { ...t, amount: e.target.value === '' ? 0 : Number(e.target.value) } : t,
                          ),
                        }))
                      }
                      className="h-8 text-[12px]"
                    />
                  </Field>
                  <Field label="Napomena" className="flex-1">
                    <Input
                      value={tier.note ?? ''}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          weightTiers: prev.weightTiers.map((t) =>
                            t.id === tier.id ? { ...t, note: e.target.value || null } : t,
                          ),
                        }))
                      }
                      className="h-8 text-[12px]"
                      placeholder="Opciono"
                    />
                  </Field>
                  <Switch
                    checked={tier.enabled}
                    onCheckedChange={(v) =>
                      update((prev) => ({
                        ...prev,
                        weightTiers: prev.weightTiers.map((t) => (t.id === tier.id ? { ...t, enabled: v } : t)),
                      }))
                    }
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Obriši tarifu"
                    onClick={() =>
                      update((prev) => ({ ...prev, weightTiers: prev.weightTiers.filter((t) => t.id !== tier.id) }))
                    }
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}

              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  update((prev) => {
                    const last = [...prev.weightTiers].sort((a, b) => a.upToKg - b.upToKg).pop();
                    return {
                      ...prev,
                      weightTiers: [
                        ...prev.weightTiers,
                        {
                          id: uid('wt'),
                          upToKg: (last?.upToKg ?? 0) + 10,
                          amount: last?.amount ?? 0,
                          enabled: true,
                          note: null,
                        },
                      ],
                    };
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Dodaj tarifu
              </Button>
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                update((prev) => ({
                  ...prev,
                  deliveryRules: [
                    ...prev.deliveryRules,
                    { id: uid('del'), name: 'Nova dostava', type: 'flat', enabled: true, amount: null, freeAbove: null, note: null },
                  ],
                }))
              }
            >
              <Plus className="h-3.5 w-3.5" /> Dodaj pravilo dostave
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <CardTitle>Popusti</CardTitle>
            </div>
            <Badge tone={calc.discountRules.some((r) => r.enabled) ? 'green' : 'amber'}>
              {calc.discountRules.some((r) => r.enabled) ? `${calc.discountRules.filter((r) => r.enabled).length} aktivno` : 'nema pravila'}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="rounded-lg border bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Popust na količinu važi <strong>samo za isti proizvod</strong>: 2 komada istog = popust, a 2 različita
              proizvoda po 1 komad = bez popusta. Ako je u korpi više različitih proizvoda, a jedan od njih je naručen
              više puta, popust se računa samo na taj proizvod. Uvijek se primjenjuje <strong>najviši dostignuti prag</strong>.
            </p>

            {calc.discountRules.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Nema definisanih popusta. Kalkulator neće primijeniti nikakav popust dok ga vi ne unesete.
              </p>
            ) : null}

            {calc.discountRules.map((rule) => (
              <div key={rule.id} className="space-y-2 rounded-xl border bg-background p-2.5">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={rule.name}
                    onChange={(e) => patchDiscount(rule.id, { name: e.target.value })}
                    className="h-8 flex-1 text-[12.5px]"
                  />
                  <Switch checked={rule.enabled} onCheckedChange={(v) => patchDiscount(rule.id, { enabled: v })} />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Obriši popust"
                    onClick={() => update((prev) => ({ ...prev, discountRules: prev.discountRules.filter((r) => r.id !== rule.id) }))}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Tip">
                    <select
                      value={rule.type}
                      onChange={(e) => patchDiscount(rule.id, { type: e.target.value as DiscountRule['type'] })}
                      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-[12px]"
                    >
                      <option value="quantity">Količinski (po stavci)</option>
                      <option value="product">Na proizvod</option>
                      <option value="bundle">Na ukupnu količinu</option>
                      <option value="cart_total">Na vrijednost narudžbe</option>
                    </select>
                  </Field>
                  <Field label="Postotak (%)">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={rule.percent ?? ''}
                      onChange={(e) => patchDiscount(rule.id, { percent: e.target.value === '' ? null : Number(e.target.value) })}
                      className="h-8 text-[12px]"
                    />
                  </Field>
                  <Field label="Fiksni iznos (KM)">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={rule.amount ?? ''}
                      onChange={(e) => patchDiscount(rule.id, { amount: e.target.value === '' ? null : Number(e.target.value) })}
                      className="h-8 text-[12px]"
                    />
                  </Field>
                  {rule.type === 'cart_total' ? (
                    <Field label="Min. vrijednost (KM)">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={rule.minSubtotal ?? ''}
                        onChange={(e) => patchDiscount(rule.id, { minSubtotal: e.target.value === '' ? null : Number(e.target.value) })}
                        className="h-8 text-[12px]"
                      />
                    </Field>
                  ) : (
                    <Field label="Min. količina">
                      <Input
                        type="number"
                        min={1}
                        value={rule.minQuantity ?? ''}
                        onChange={(e) => patchDiscount(rule.id, { minQuantity: e.target.value === '' ? null : Number(e.target.value) })}
                        className="h-8 text-[12px]"
                      />
                    </Field>
                  )}
                </div>

                {rule.type === 'product' || rule.type === 'quantity' ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        Ograničeno na proizvode ({rule.productIds.length || 'svi'})
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setScopeFor(rule)}>
                        <Plus className="h-3 w-3" /> Odaberi
                      </Button>
                    </div>
                    {rule.productIds.length ? (
                      <div className="flex flex-wrap gap-1">
                        {rule.productIds.map((id) => (
                          <span key={id} className="inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px]">
                            {id.replace('giga_', '')}
                            <button
                              onClick={() =>
                                patchDiscount(rule.id, { productIds: rule.productIds.filter((p) => p !== id) })
                              }
                              aria-label="Ukloni"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10.5px] text-muted-foreground">Ako nema odabira, pravilo važi za sve stavke odgovarajućeg tipa.</p>
                    )}
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Switch checked={rule.stackable} onCheckedChange={(v) => patchDiscount(rule.id, { stackable: v })} />
                    Može se kombinovati
                  </label>
                  <Field label="Prioritet" className="w-20">
                    <Input
                      type="number"
                      min={0}
                      value={rule.priority}
                      onChange={(e) => patchDiscount(rule.id, { priority: Number(e.target.value) })}
                      className="h-7 text-[11px]"
                    />
                  </Field>
                </div>
                <Field label="Obrazloženje (vidljivo agentu)">
                  <Textarea
                    rows={2}
                    value={rule.note ?? ''}
                    onChange={(e) => patchDiscount(rule.id, { note: e.target.value || null })}
                    className="text-[12px]"
                    placeholder="Zašto pravilo postoji / kada se primjenjuje"
                  />
                </Field>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  update((prev) => ({
                    ...prev,
                    discountRules: [
                      ...prev.discountRules,
                      {
                        id: uid('disc'),
                        name: 'Novi popust',
                        type: 'cart_total',
                        enabled: false,
                        productIds: [],
                        minQuantity: null,
                        minSubtotal: null,
                        percent: null,
                        amount: null,
                        note: null,
                        priority: 100,
                        stackable: false,
                      },
                    ],
                  }))
                }
              >
                <Plus className="h-3.5 w-3.5" /> Dodaj popust
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Dodaje pragove 2 kom = 5%, 5 kom = 7%, 10 kom = 10% (preskače one koji već postoje)"
                onClick={() =>
                  update((prev) => {
                    const presets: { quantity: number; percent: number }[] = [
                      { quantity: 2, percent: 5 },
                      { quantity: 5, percent: 7 },
                      { quantity: 10, percent: 10 },
                    ];
                    const existing = new Set(
                      prev.discountRules
                        .filter((rule) => rule.type === 'quantity')
                        .map((rule) => `${rule.minQuantity}-${rule.percent}`),
                    );
                    const added = presets
                      .filter((preset) => !existing.has(`${preset.quantity}-${preset.percent}`))
                      .map((preset) => ({
                        id: uid('qty'),
                        name: `${preset.quantity} istih proizvoda — ${preset.percent}%`,
                        type: 'quantity' as const,
                        enabled: true,
                        productIds: [],
                        minQuantity: preset.quantity,
                        minSubtotal: null,
                        percent: preset.percent,
                        amount: null,
                        note: `Popust važi samo za isti proizvod naručen ${preset.quantity} ili više puta.`,
                        priority: preset.quantity * 10,
                        stackable: false,
                      }));
                    return { ...prev, discountRules: [...prev.discountRules, ...added] };
                  })
                }
              >
                <Sparkles className="h-3.5 w-3.5" /> Pragovi 2/5/10
              </Button>
            </div>

            {calc.discountRules.some((r) => r.enabled && r.percent === null && r.amount === null) ? (
              <p className="rounded-lg border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-[11px] text-danger">
                Neka aktivna pravila nemaju ni postotak ni iznos — bit će ignorisana dok ih ne dopunite.
              </p>
            ) : null}
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              Valuta: {calc.currency} · Neprobojna (non-stackable) pravila: primjenjuje se samo najvrijednije. Stackable pravila se sabiraju po prioritetu.
            </p>
          </CardBody>
        </Card>
      </div>

      <ProductSearchDialog
        open={Boolean(scopeFor)}
        onOpenChange={(v) => !v && setScopeFor(null)}
        selectedIds={scopeFor?.productIds ?? []}
        title="Ograniči popust na proizvode"
        description="Odaberite proizvode na koje se pravilo odnosi. Cijene se ne mijenjaju ovdje."
        onSelect={(product) => {
          if (!scopeFor) return;
          if (scopeFor.productIds.includes(product.id)) return;
          patchDiscount(scopeFor.id, { productIds: [...scopeFor.productIds, product.id] });
          setScopeFor({ ...scopeFor, productIds: [...scopeFor.productIds, product.id] });
          toast({ title: `Dodano: ${product.name}`, description: formatMoney(product.price, product.currency) });
        }}
      />
    </div>
  );
}
