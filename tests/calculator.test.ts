import { describe, expect, it } from 'vitest';
import { fromCents, parseQuantity, percentOfCents, toCents } from '@/lib/domain/money';
import { calculateOrder, type CalculateInput } from '@/lib/domain/calculator';
import type { CalculatorConfig, DiscountRule, DeliveryRule } from '@/lib/domain/types';

const config = (overrides: Partial<CalculatorConfig> = {}): CalculatorConfig => ({
  currency: 'BAM',
  pricesIncludeTax: null,
  deliveryPolicy: 'rules',
  deliveryRules: [],
  weightTiers: [
    { id: 'wt_10', upToKg: 10, amount: 10, enabled: true, note: null },
    { id: 'wt_20', upToKg: 20, amount: 15, enabled: true, note: null },
    { id: 'wt_30', upToKg: 30, amount: 20, enabled: true, note: null },
  ],
  discountRules: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const delivery = (overrides: Partial<DeliveryRule> = {}): DeliveryRule => ({
  id: 'del1',
  name: 'Dostava',
  type: 'flat',
  enabled: true,
  amount: 5,
  freeAbove: null,
  note: null,
  ...overrides,
});

const discount = (overrides: Partial<DiscountRule> = {}): DiscountRule => ({
  id: 'd1',
  name: 'Popust',
  type: 'cart_total',
  enabled: true,
  productIds: [],
  minQuantity: null,
  minSubtotal: 0,
  percent: 10,
  amount: null,
  note: null,
  priority: 100,
  stackable: false,
  ...overrides,
});

const input = (overrides: Partial<CalculateInput> = {}): CalculateInput => ({
  items: [{ productId: 'giga_1', name: 'Proizvod', unitPrice: 100, quantity: 1 }],
  config: config({ deliveryRules: [delivery()] }),
  now: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('money helpers', () => {
  it('converts to integer cents without float drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('0.07')).toBe(7);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBeNull();
    expect(toCents('nije broj')).toBeNull();
  });

  it('round-trips cents', () => {
    expect(fromCents(1999)).toBe(19.99);
    expect(percentOfCents(1999, 10)).toBe(200);
  });

  it('rejects invalid quantities', () => {
    expect(parseQuantity(2)).toBe(2);
    expect(parseQuantity(0)).toBeNull();
    expect(parseQuantity(1.5)).toBeNull();
    expect(parseQuantity('3')).toBe(3);
    expect(parseQuantity(null)).toBeNull();
  });
});

describe('calculateOrder', () => {
  it('computes subtotal, delivery and total in cents', () => {
    const result = calculateOrder(input({ items: [{ productId: 'giga_1', name: 'Stolica', unitPrice: 49.99, quantity: 3 }] }));
    expect(result.subtotal).toBe(149.97);
    expect(result.delivery.amount).toBe(5);
    expect(result.total).toBe(154.97);
    expect(result.requiresAttention).toBe(false);
  });

  it('applies the free-above delivery threshold after discounts', () => {
    const cfg = config({
      deliveryRules: [delivery({ type: 'free_above', amount: 5, freeAbove: 100 })],
      discountRules: [discount({ percent: 20 })],
    });
    const result = calculateOrder(input({ config: cfg }));
    // 100 - 20 = 80, below 100 threshold, so paid delivery applies.
    expect(result.delivery.amount).toBe(5);
    expect(result.total).toBe(85);
  });

  it('picks only the best non-stackable discount', () => {
    const cfg = config({
      discountRules: [
        discount({ id: 'a', name: 'A', percent: 5 }),
        discount({ id: 'b', name: 'B', percent: 15 }),
      ],
    });
    const result = calculateOrder(input({ config: cfg }));
    expect(result.discounts.map((d) => d.name)).toEqual(['B']);
    expect(result.discountTotal).toBe(15);
  });

  it('sums stackable discounts', () => {
    const cfg = config({
      discountRules: [
        discount({ id: 'a', name: 'A', percent: 5, stackable: true }),
        discount({ id: 'b', name: 'B', percent: null, amount: 10, stackable: true }),
      ],
      deliveryRules: [delivery()],
    });
    const result = calculateOrder(input({ config: cfg }));
    expect(result.discountTotal).toBe(15);
    expect(result.total).toBe(90);
  });

  it('never applies a discount above the subtotal', () => {
    const cfg = config({ discountRules: [discount({ percent: null, amount: 500 })] });
    const result = calculateOrder(input({ config: cfg }));
    expect(result.discountTotal).toBe(100);
    expect(result.subtotalAfterDiscount).toBe(0);
  });

  it('flags missing price and quantity instead of inventing values', () => {
    const result = calculateOrder(
      input({
        items: [
          { productId: 'giga_1', name: 'Bez cijene', unitPrice: null, quantity: 1 },
          { productId: 'giga_2', name: 'Bez količine', unitPrice: 10, quantity: null },
        ],
      }),
    );
    expect(result.total).toBeNull();
    expect(result.issues.some((i) => i.code === 'MISSING_PRICE')).toBe(true);
    expect(result.issues.some((i) => i.code === 'MISSING_QUANTITY')).toBe(true);
    expect(result.requiresAttention).toBe(true);
  });

  it('reports price drift against the catalogue', () => {
    const result = calculateOrder(
      input({ items: [{ productId: 'giga_1', name: 'Proizvod', unitPrice: 100, quantity: 1, currentCatalogPrice: 120 }] }),
    );
    expect(result.issues.some((i) => i.code === 'PRICE_DRIFT')).toBe(true);
  });

  it('requires manual confirmation when delivery is on request', () => {
    const result = calculateOrder(input({ config: config({ deliveryPolicy: 'on_request' }) }));
    expect(result.delivery.status).toBe('on_request');
    expect(result.requiresAttention).toBe(true);
    expect(result.issues.some((i) => i.code === 'DELIVERY_NOT_CONFIGURED')).toBe(true);
  });

  it('ignores a cart-total rule without a threshold instead of guessing', () => {
    const cfg = config({ discountRules: [discount({ minSubtotal: null })] });
    const result = calculateOrder(input({ config: cfg }));
    expect(result.discountTotal).toBe(0);
    expect(result.discounts).toHaveLength(0);
  });

  it('uses per-item delivery', () => {
    const cfg = config({ deliveryRules: [delivery({ type: 'per_item', amount: 2 })] });
    const result = calculateOrder(
      input({ config: cfg, items: [{ productId: 'giga_1', name: 'Proizvod', unitPrice: 10, quantity: 3 }] }),
    );
    expect(result.delivery.amount).toBe(6);
    expect(result.total).toBe(36);
  });
});

describe('delivery by weight', () => {
  const base = (weightKg: number | null, quantity = 1) => ({
    items: [
      {
        productId: 'p1',
        name: 'Ormarić',
        unitPrice: 100,
        quantity,
        weightKg,
      },
    ],
    config: config({
      deliveryRules: [
        { id: 'w1', name: 'Dostava po težini', type: 'by_weight', enabled: true, amount: null, freeAbove: null, note: null },
      ],
    }),
  });

  it('charges 10 KM up to 10 kg', () => {
    const result = calculateOrder(base(8));
    expect(result.totalWeightKg).toBe(8);
    expect(result.delivery.amount).toBe(10);
    expect(result.delivery.status).toBe('applied');
  });

  it('charges 15 KM up to 20 kg', () => {
    const result = calculateOrder(base(10.5));
    expect(result.delivery.amount).toBe(15);
  });

  it('charges 20 KM up to 30 kg', () => {
    const result = calculateOrder(base(30));
    expect(result.delivery.amount).toBe(20);
  });

  it('multiplies weight by quantity', () => {
    const result = calculateOrder(base(4, 4));
    expect(result.totalWeightKg).toBe(16);
    expect(result.delivery.amount).toBe(15);
  });

  it('does not invent a price when weight is missing', () => {
    const result = calculateOrder(base(null));
    expect(result.weightMissing).toBe(true);
    expect(result.totalWeightKg).toBeNull();
    expect(result.delivery.status).toBe('missing');
    expect(result.requiresAttention).toBe(true);
    expect(result.issues.some((i) => i.code === 'WEIGHT_MISSING')).toBe(true);
  });

  it('above the heaviest tier charges the heaviest tier and warns the agent', () => {
    const result = calculateOrder(base(45));
    expect(result.delivery.status).toBe('applied');
    // Najveća tarifa u ovom testu ide do 20 kg i iznosi 20 KM.
    expect(result.delivery.amount).toBe(20);
    expect(result.issues.some((i) => i.code === 'WEIGHT_OVER_LIMIT')).toBe(true);
  });
});

describe('delivery is always by weight at GIGA.ba', () => {
  it('uses the weight tiers even without an explicit delivery rule', () => {
    const result = calculateOrder({
      items: [{ productId: 'p1', name: 'Ormarić', unitPrice: 200, quantity: 1, weightKg: 22 }],
      config: config({ deliveryRules: [] }),
    });
    expect(result.delivery.amount).toBe(20);
    expect(result.delivery.status).toBe('applied');
    expect(result.delivery.reason).toContain('22 kg');
  });
});

describe('R28: popust na količinu istog proizvoda', () => {
  const qty = (minQuantity: number, percent: number): DiscountRule =>
    discount({ id: `qty_${minQuantity}`, name: `${minQuantity} kom — ${percent}%`, type: 'quantity', minQuantity, percent });
  const tiers = [qty(2, 5), qty(5, 7), qty(10, 10)];

  const cart = (items: { productId: string; quantity: number }[]) =>
    calculateOrder({
      items: items.map((item) => ({ ...item, name: item.productId, unitPrice: 100 })),
      config: config({ discountRules: tiers, deliveryRules: [delivery({ amount: 0 })] }),
    });

  it('2 ista proizvoda daju 5%', () => {
    const result = cart([{ productId: 'giga_1', quantity: 2 }]);
    expect(result.discountTotal).toBe(10);
    expect(result.total).toBe(190);
  });

  it('5 istih proizvoda daje 7%, ne 5%', () => {
    const result = cart([{ productId: 'giga_1', quantity: 5 }]);
    expect(result.discountTotal).toBe(35);
  });

  it('10 istih proizvoda daje 10%', () => {
    const result = cart([{ productId: 'giga_1', quantity: 10 }]);
    expect(result.discountTotal).toBe(100);
  });

  it('dva različita proizvoda po jedan komad — bez popusta', () => {
    const result = cart([
      { productId: 'giga_1', quantity: 1 },
      { productId: 'giga_2', quantity: 1 },
    ]);
    expect(result.discountTotal).toBe(0);
  });

  it('različiti proizvodi + jedan ponovljen — popust samo na ponovljeni', () => {
    const result = cart([
      { productId: 'giga_1', quantity: 3 },
      { productId: 'giga_2', quantity: 1 },
    ]);
    // 3 × 100 = 300, 5 % = 15; drugi proizvod bez popusta.
    expect(result.discountTotal).toBe(15);
  });
});
