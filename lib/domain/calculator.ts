import type { CalculatorConfig, DiscountRule, DeliveryRule } from './types';
import { formatMoney, percentOfCents, toCents } from './money';

// ---------------------------------------------------------------------------
// Deterministic order calculator.
// The language model may suggest items, but every number here is computed from
// validated inputs with integer-cent arithmetic.
// ---------------------------------------------------------------------------

export interface CalcItemInput {
  productId: string;
  name: string;
  sku?: string | null;
  /** Price quoted in the conversation. */
  unitPrice: number | null;
  quantity: number | null;
  /** Fresh catalogue price, when known. Used for drift detection only. */
  currentCatalogPrice?: number | null;
  priceCheckedAt?: string | null;
  /** Shipping weight per unit in kg, entered by the agent. */
  weightKg?: number | null;
}

export interface CalculateInput {
  items: CalcItemInput[];
  config: CalculatorConfig;
  /** Force one delivery rule; otherwise the first applicable rule is used. */
  deliveryRuleId?: string | null;
  deliveryConfirmed?: boolean;
  manualDiscountPercent?: number | null;
  now?: string;
}

export interface LineBreakdown {
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Weight per unit in kg (null when the agent has not entered it yet). */
  weightKg: number | null;
  /** weightKg × quantity, or null when unknown. */
  lineWeightKg: number | null;
}

export interface AppliedDiscount {
  ruleId: string;
  name: string;
  type: DiscountRule['type'];
  /** Human explanation: why the rule applies. */
  reason: string;
  amount: number;
  scopeProductIds: string[];
  percent: number | null;
}

export interface DeliveryBreakdown {
  ruleId: string | null;
  name: string;
  amount: number;
  reason: string;
  status: 'applied' | 'missing' | 'on_request';
}

export interface CalculationIssue {
  code:
    | 'MISSING_PRICE'
    | 'MISSING_QUANTITY'
    | 'NO_ITEMS'
    | 'DELIVERY_NOT_CONFIGURED'
    | 'DELIVERY_REQUIRES_CONFIRMATION'
    | 'DELIVERY_WEIGHT_NOT_CONFIGURED'
    | 'WEIGHT_MISSING'
    | 'WEIGHT_OVER_LIMIT'
    | 'PRICE_DRIFT'
    | 'DISCOUNT_RULE_INVALID';
  message: string;
  productId?: string;
}

export interface CalculationResult {
  currency: string;
  lines: LineBreakdown[];
  subtotal: number;
  discountTotal: number;
  subtotalAfterDiscount: number;
  delivery: DeliveryBreakdown;
  totalBeforeDiscount: number;
  total: number | null;
  discounts: AppliedDiscount[];
  /** Total shipping weight in kg; null when any line has no weight. */
  totalWeightKg: number | null;
  /** True when at least one line is missing its weight. */
  weightMissing: boolean;
  issues: CalculationIssue[];
  /** True when any issue means the total must not be quoted yet. */
  requiresAttention: boolean;
  computedAt: string;
}

/** Weights are shown to 2 decimals, never used for money math directly. */
function roundKg(value: number): number {
  return Math.round(value * 100) / 100;
}

function ruleReason(rule: DiscountRule, matchedUnits: number, matchedSubtotalCents: number): string {
  switch (rule.type) {
    case 'quantity':
      return `${rule.name}: količina ${matchedUnits} dostiže prag ${rule.minQuantity}.`;
    case 'product':
      return `${rule.name}: primjenjuje se na odabrane proizvode.`;
    case 'bundle':
      return `${rule.name}: ukupno ${matchedUnits} artikala dostiže prag ${rule.minQuantity}.`;
    case 'cart_total':
      return `${rule.name}: vrijednost narudžbe ${formatMoney(matchedSubtotalCents / 100)} dostiže prag ${formatMoney(
        rule.minSubtotal ?? 0,
      )}.`;
  }
}

interface Candidate {
  rule: DiscountRule;
  amountCents: number;
  reason: string;
  scope: string[];
}

function evaluateRule(
  rule: DiscountRule,
  lines: LineBreakdown[],
  subtotalCents: number,
): Candidate | null {
  if (!rule.enabled) return null;

  let baseCents = 0;
  let scope: string[] = [];
  let reason = '';
  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);

  switch (rule.type) {
    case 'quantity': {
      const scoped = rule.productIds.length
        ? lines.filter((l) => rule.productIds.includes(l.productId))
        : lines;
      const matched = scoped.filter((l) => (rule.minQuantity ?? 1) <= l.quantity);
      if (!matched.length) return null;
      baseCents = matched.reduce((s, l) => s + toCents(l.lineTotal)!, 0);
      scope = matched.map((l) => l.productId);
      reason = `${rule.name}: količina ${Math.max(...matched.map((l) => l.quantity))} dostiže prag ${
        rule.minQuantity
      }.`;
      break;
    }
    case 'product': {
      const matched = lines.filter((l) => rule.productIds.includes(l.productId));
      if (!matched.length) return null;
      baseCents = matched.reduce((s, l) => s + toCents(l.lineTotal)!, 0);
      scope = matched.map((l) => l.productId);
      reason = ruleReason(rule, totalUnits, subtotalCents);
      break;
    }
    case 'bundle': {
      if (rule.minQuantity === null || totalUnits < rule.minQuantity) return null;
      baseCents = subtotalCents;
      scope = lines.map((l) => l.productId);
      reason = ruleReason(rule, totalUnits, subtotalCents);
      break;
    }
    case 'cart_total': {
      if (rule.minSubtotal === null || subtotalCents < toCents(rule.minSubtotal)!) return null;
      baseCents = subtotalCents;
      scope = lines.map((l) => l.productId);
      reason = ruleReason(rule, totalUnits, subtotalCents);
      break;
    }
  }

  if (baseCents <= 0) return null;

  let amountCents = 0;
  if (rule.percent !== null && rule.percent > 0) amountCents = percentOfCents(baseCents, rule.percent);
  else if (rule.amount !== null && rule.amount > 0) amountCents = Math.min(toCents(rule.amount)!, baseCents);
  else return null;

  return { rule, amountCents, reason, scope };
}

export function calculateOrder(input: CalculateInput): CalculationResult {
  const now = input.now ?? new Date().toISOString();
  const currency = input.config.currency || 'BAM';
  const issues: CalculationIssue[] = [];
  const lines: LineBreakdown[] = [];

  for (const item of input.items) {
    const priceCents = toCents(item.unitPrice);
    if (priceCents === null || priceCents < 0) {
      issues.push({
        code: 'MISSING_PRICE',
        message: `Cijena za "${item.name}" nije poznata. Potrebna je provjera.`,
        productId: item.productId,
      });
      continue;
    }
    if (item.quantity === null || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      issues.push({
        code: 'MISSING_QUANTITY',
        message: `Količina za "${item.name}" nije poznata ili nije ispravna.`,
        productId: item.productId,
      });
      continue;
    }
    const lineTotalCents = priceCents * item.quantity;
    const unitWeight = typeof item.weightKg === 'number' && item.weightKg > 0 ? item.weightKg : null;
    lines.push({
      productId: item.productId,
      name: item.name,
      sku: item.sku ?? null,
      unitPrice: priceCents / 100,
      quantity: item.quantity,
      lineTotal: lineTotalCents / 100,
      weightKg: unitWeight,
      lineWeightKg: unitWeight === null ? null : roundKg(unitWeight * item.quantity),
    });

    const catalogCents = toCents(item.currentCatalogPrice);
    if (catalogCents !== null && catalogCents !== priceCents) {
      issues.push({
        code: 'PRICE_DRIFT',
        message: `Cijena za "${item.name}" se promijenila: u razgovoru ${formatMoney(
          priceCents / 100,
          currency,
        )}, u katalogu ${formatMoney(catalogCents / 100, currency)}. Potvrdite koju cijenu koristiti.`,
        productId: item.productId,
      });
    }
  }

  if (input.items.length === 0) {
    issues.push({ code: 'NO_ITEMS', message: 'Narudžba nema artikala.' });
  }

  const subtotalCents = lines.reduce((s, l) => s + toCents(l.lineTotal)!, 0);

  // ---- Discounts ---------------------------------------------------------
  const candidates: Candidate[] = [];
  for (const rule of input.config.discountRules ?? []) {
    if (rule.percent !== null && (rule.percent <= 0 || rule.percent > 100)) {
      issues.push({
        code: 'DISCOUNT_RULE_INVALID',
        message: `Pravilo "${rule.name}" ima neispravan postotak.`,
      });
      continue;
    }
    const c = evaluateRule(rule, lines, subtotalCents);
    if (c) candidates.push(c);
  }

  // Stackable rules all apply (in priority order). Among non-stackable rules
  // only the single most valuable one applies, so results stay deterministic.
  const stackable = candidates.filter((c) => c.rule.stackable).sort((a, b) => a.rule.priority - b.rule.priority);
  const exclusive = candidates.filter((c) => !c.rule.stackable);
  const bestExclusive = exclusive.sort((a, b) => b.amountCents - a.amountCents)[0];

  const applied: AppliedDiscount[] = [];
  let discountCents = 0;
  for (const c of [...(bestExclusive ? [bestExclusive] : []), ...stackable]) {
    applied.push({
      ruleId: c.rule.id,
      name: c.rule.name,
      type: c.rule.type,
      reason: c.reason,
      amount: c.amountCents / 100,
      scopeProductIds: c.scope,
      percent: c.rule.percent,
    });
    discountCents += c.amountCents;
  }

  // Manual discount entered by the agent (still deterministic).
  if (input.manualDiscountPercent !== null && input.manualDiscountPercent !== undefined) {
    if (input.manualDiscountPercent < 0 || input.manualDiscountPercent > 100) {
      issues.push({ code: 'DISCOUNT_RULE_INVALID', message: 'Ručni popust mora biti između 0 i 100 %.' });
    } else if (input.manualDiscountPercent > 0) {
      const manualCents = percentOfCents(subtotalCents, input.manualDiscountPercent);
      applied.push({
        ruleId: 'manual',
        name: 'Ručni popust',
        type: 'cart_total',
        reason: `Ručno unesen popust ${input.manualDiscountPercent} % na ukupnu vrijednost.`,
        amount: manualCents / 100,
        scopeProductIds: lines.map((l) => l.productId),
        percent: input.manualDiscountPercent,
      });
      discountCents += manualCents;
    }
  }

  discountCents = Math.min(discountCents, subtotalCents);
  const afterDiscountCents = subtotalCents - discountCents;

  // ---- Shipping weight ---------------------------------------------------
  const weightMissing = lines.some((l) => l.lineWeightKg === null);
  const totalWeightKg = lines.length && !weightMissing
    ? roundKg(lines.reduce((sum, l) => sum + (l.lineWeightKg ?? 0), 0))
    : null;

  // ---- Delivery ----------------------------------------------------------
  let delivery: DeliveryBreakdown = {
    ruleId: null,
    name: 'Dostava',
    amount: 0,
    reason: 'Dostava nije primijenjena.',
    status: 'missing',
  };

  const enabledDeliveryRules = (input.config.deliveryRules ?? []).filter((r) => r.enabled);
  if (input.config.deliveryPolicy === 'on_request') {
    delivery = {
      ruleId: null,
      name: 'Dostava',
      amount: 0,
      reason: 'Cijena dostave nije konfigurirana — potrebna je ručna potvrda.',
      status: 'on_request',
    };
    issues.push({
      code: 'DELIVERY_NOT_CONFIGURED',
      message: 'Pravila dostave nisu konfigurirana. Unesite ih u Postavkama ili potvrdite ručno.',
    });
  } else {
    const ordered: DeliveryRule[] = input.deliveryRuleId
      ? enabledDeliveryRules.filter((r) => r.id === input.deliveryRuleId)
      : enabledDeliveryRules;
    const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);
    let chosen: DeliveryBreakdown | null = null;

    /**
     * GIGA.ba always ships by weight, so every weight calculation goes through
     * here. Returns null only when no weight tiers are configured at all.
     */
    const weightDelivery = (ruleId: string | null, ruleName: string): DeliveryBreakdown | null => {
      const tiers = (input.config.weightTiers ?? [])
        .filter((t) => t.enabled)
        .slice()
        .sort((a, b) => a.upToKg - b.upToKg);
      if (!tiers.length) return null;

      if (totalWeightKg === null) {
        const missing = lines.filter((l) => l.lineWeightKg === null).map((l) => l.name);
        issues.push({
          code: 'WEIGHT_MISSING',
          message: `Težina nije unesena za: ${missing.join(', ')}. Unesite težinu u Proizvodi → Tvoji podaci.`,
        });
        return {
          ruleId,
          name: ruleName,
          amount: 0,
          reason: 'Dostava se računa po težini, ali težina proizvoda nije unesena.',
          status: 'missing',
        };
      }

      const tier = tiers.find((t) => totalWeightKg <= t.upToKg) ?? null;
      if (!tier) {
        const heaviest = tiers[tiers.length - 1]!;
        issues.push({
          code: 'WEIGHT_OVER_LIMIT',
          message: `Ukupna težina ${totalWeightKg} kg prelazi najveću tarifu (${heaviest.upToKg} kg). Potvrdite cijenu dostave ručno.`,
        });
        return {
          ruleId,
          name: ruleName,
          amount: 0,
          reason: `Ukupna težina ${totalWeightKg} kg prelazi najveću tarifu — dostavu potvrditi ručno.`,
          status: 'on_request',
        };
      }

      return {
        ruleId,
        name: ruleName,
        amount: tier.amount,
        reason: `${ruleName}: ${totalWeightKg} kg → do ${tier.upToKg} kg = ${formatMoney(tier.amount, currency)}.`,
        status: 'applied',
      };
    };

    for (const rule of ordered) {
      if (rule.type === 'free_above') {
        const threshold = toCents(rule.freeAbove);
        if (threshold === null) continue;
        if (afterDiscountCents >= threshold) {
          chosen = {
            ruleId: rule.id,
            name: rule.name,
            amount: 0,
            reason: `Dostava besplatna: vrijednost ${formatMoney(afterDiscountCents / 100, currency)} ≥ ${formatMoney(
              threshold / 100,
              currency,
            )}.`,
            status: 'applied',
          };
          break;
        }
        if (rule.amount !== null) {
          chosen = {
            ruleId: rule.id,
            name: rule.name,
            amount: rule.amount,
            reason: `${rule.name}: ${formatMoney(rule.amount, currency)} (ispod praga za besplatnu dostavu).`,
            status: 'applied',
          };
          break;
        }
        continue;
      }
      if (rule.type === 'flat') {
        if (rule.amount === null) continue;
        chosen = {
          ruleId: rule.id,
          name: rule.name,
          amount: rule.amount,
          reason: `${rule.name}: fiksna cijena dostave ${formatMoney(rule.amount, currency)}.`,
          status: 'applied',
        };
        break;
      }
      if (rule.type === 'per_item') {
        if (rule.amount === null) continue;
        const amount = rule.amount * totalUnits;
        chosen = {
          ruleId: rule.id,
          name: rule.name,
          amount,
          reason: `${rule.name}: ${formatMoney(rule.amount, currency)} × ${totalUnits} artikala.`,
          status: 'applied',
        };
        break;
      }
      if (rule.type === 'by_weight') {
        const computed = weightDelivery(rule.id, rule.name);
        if (!computed) {
          issues.push({
            code: 'DELIVERY_WEIGHT_NOT_CONFIGURED',
            message: 'Težinske tarife dostave nisu konfigurirane (Postavke → Dostava i popusti).',
          });
          continue;
        }
        chosen = computed;
        break;
      }
      if (rule.type === 'on_request') {
        chosen = {
          ruleId: rule.id,
          name: rule.name,
          amount: 0,
          reason: 'Dostava po dogovoru — cijena se potvrđuje ručno.',
          status: 'on_request',
        };
        issues.push({
          code: 'DELIVERY_REQUIRES_CONFIRMATION',
          message: 'Dostava je po dogovoru — potvrdite cijenu prije slanja ponude.',
        });
        break;
      }
    }

    // Delivery at GIGA.ba is always priced by weight, so the weight tiers are
    // used even when no explicit rule is enabled.
    if (!chosen) chosen = weightDelivery(null, 'Dostava po težini');

    if (chosen) delivery = chosen;
    else {
      delivery = {
        ruleId: null,
        name: 'Dostava',
        amount: 0,
        reason: 'Nije pronađeno primjenjivo pravilo dostave.',
        status: 'missing',
      };
      issues.push({
        code: 'DELIVERY_NOT_CONFIGURED',
        message: 'Nijedno pravilo dostave se ne primjenjuje. Provjerite Postavke → Dostava i popusti.',
      });
    }
  }

  const deliveryCents = toCents(delivery.amount) ?? 0;
  const blocking = issues.some((i) =>
    [
      'MISSING_PRICE',
      'MISSING_QUANTITY',
      'NO_ITEMS',
      'DELIVERY_NOT_CONFIGURED',
      'DELIVERY_WEIGHT_NOT_CONFIGURED',
      'WEIGHT_MISSING',
    ].includes(i.code),
  ) || delivery.status === 'on_request' || delivery.status === 'missing';

  const totalCents = lines.length ? afterDiscountCents + deliveryCents : null;

  return {
    currency,
    lines,
    subtotal: subtotalCents / 100,
    discountTotal: discountCents / 100,
    subtotalAfterDiscount: afterDiscountCents / 100,
    delivery,
    totalBeforeDiscount: subtotalCents / 100,
    total: totalCents === null ? null : totalCents / 100,
    discounts: applied,
    totalWeightKg,
    weightMissing,
    issues,
    requiresAttention: blocking || issues.length > 0,
    computedAt: now,
  };
}
