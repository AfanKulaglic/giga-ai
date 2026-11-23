import { acquireSiteSlot, resetSiteGuard, siteRequestsLastHour } from '@/lib/site/siteGuard';
import { checkSyncCooldown } from '@/lib/domain/syncCooldown';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_WINDOW_MESSAGES,
  SUMMARY_TRIGGER_MESSAGES,
  emptySessionContext,
  messagesForModel,
  normalizeContextProduct,
  normalizeSessionContext,
  mergeCustomerDetails,
  shouldSummarize,
  promoteContextProducts,
  upsertContextProduct,
  serializeContext,
} from '@/lib/domain/sessionContext';
import { appendSignature, renderSignature } from '@/lib/domain/signature';
import { capitalizeSentences } from '@/lib/domain/text';
import { buildOrderFormValues, type OrderFormValues } from '@/lib/domain/orderForm';
import { calculateOrder } from '@/lib/domain/calculator';

import type {
  CalculatorConfig,
  ChatMessage,
  ContextProduct,
  CustomerSession,
  OrderFormConfiguration,
  SenderType,
} from '@/lib/domain/types';

const session = (): CustomerSession => ({
  id: 'giga_session_1',
  userId: 'u1',
  label: 'Kupac',
  status: 'active',
  context: emptySessionContext(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastMessageAt: null,
  messageCount: 0,
});

const message = (id: string, senderType: SenderType, content: string): ChatMessage => ({
  id,
  sessionId: 'giga_session_1',
  userId: 'u1',
  senderType,
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const product = (productId: string, name: string, unitPrice: number): ContextProduct => ({
  productId,
  name,
  sku: null,
  unitPrice,
  currency: 'BAM',
  quantity: 1,
  priceCheckedAt: '2026-01-01T00:00:00.000Z',
  priceSource: 'scraped',
});

describe('session context isolation', () => {
  it('starts every session from an empty context', () => {
    const a = emptySessionContext();
    const b = emptySessionContext();
    expect(a.products).toHaveLength(0);
    expect(a.customer).toEqual({});
    expect(Object.is(a, b)).toBe(false);
  });

  it('upserts a product without mutating the original context', () => {
    const ctx = upsertContextProduct(emptySessionContext(), product('giga_1', 'Traka', 1499));
    const next = upsertContextProduct(ctx, product('giga_2', 'Bicikl', 799));
    expect(next.products).toHaveLength(2);
    expect(ctx.products.map((p) => p.productId)).toEqual(['giga_1']);
  });

  it('updates an existing product instead of duplicating it', () => {
    const ctx = upsertContextProduct(emptySessionContext(), product('giga_1', 'Traka', 1499));
    const next = upsertContextProduct(ctx, { ...product('giga_1', 'Traka', 1399), quantity: 2 });
    expect(next.products).toHaveLength(1);
    expect(next.products[0]!.unitPrice).toBe(1399);
    expect(next.products[0]!.quantity).toBe(2);
  });

  it('merges customer details immutably', () => {
    const ctx = emptySessionContext();
    const next = mergeCustomerDetails(ctx, { name: 'Mirsad' });
    expect(next.customer.name).toBe('Mirsad');
    expect(ctx.customer).toEqual({});
  });

  it('triggers summarization only after enough customer-relevant messages', () => {
    const ctx = emptySessionContext();
    const many = Array.from({ length: SUMMARY_TRIGGER_MESSAGES + 1 }, (_, i) => message(`m${i}`, 'customer', 'tekst'));
    expect(shouldSummarize(ctx, many)).toBe(true);
    expect(shouldSummarize(ctx, many.slice(0, 5))).toBe(false);
  });

  it('excludes internal notes from the model transcript', () => {
    const msgs = [
      message('a', 'customer', 'Zdravo'),
      message('b', 'note', 'INTERNO: ne spominji popust'),
      message('c', 'agent', 'Dobar dan'),
    ];
    const window = messagesForModel(msgs, emptySessionContext());
    expect(window.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('limits the transcript to the context window', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => message(`m${i}`, 'customer', `poruka ${i}`));
    const window = messagesForModel(msgs, emptySessionContext());
    expect(window).toHaveLength(CONTEXT_WINDOW_MESSAGES);
    expect(window.at(-1)!.content).toBe('poruka 39');
  });

  it('serializes only its own session context', () => {
    const ctx = upsertContextProduct(mergeCustomerDetails(emptySessionContext(), { name: 'Kupac A' }), product('giga_1', 'Traka', 1499));
    const text = serializeContext(ctx);
    expect(text).toContain('Kupac A');
    expect(text).toContain('Traka');
    expect(text).not.toContain('Kupac B');
  });
});

describe('signature', () => {
  const sig = {
    signOff: 'S poštovanjem,',
    agentName: 'Amina Hodžić',
    companyName: 'GIGA.ba',
    website: 'giga.ba',
    template: '{signOff} {agentName}\n{companyName} | {website}',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('renders the template', () => {
    expect(renderSignature(sig)).toContain('Amina Hodžić');
    expect(renderSignature(sig)).toContain('giga.ba');
  });

  it('never duplicates a signature that is already present', () => {
    const body = 'Dobar dan, evo ponude.';
    const once = appendSignature(body, sig);
    expect(appendSignature(once, sig)).toBe(once);
    expect(once.startsWith(body)).toBe(true);
  });

  it('skips empty template fields', () => {
    expect(renderSignature({ ...sig, website: '' })).not.toContain('|');
  });
});

describe('order form', () => {
  const config: OrderFormConfiguration = {
    fields: [
      { id: 'f1', key: 'Name', label: 'Ime', type: 'text', required: true, sortOrder: 10, source: 'customer.name', defaultValue: null, placeholder: null, validation: null, provisional: false },
      { id: 'f2', key: 'Phone', label: 'Telefon', type: 'tel', required: true, sortOrder: 20, source: 'customer.phone', defaultValue: null, placeholder: null, validation: { pattern: '^[0-9 +/]{6,}$', minLength: null, maxLength: null }, provisional: false },
      { id: 'f3', key: 'Items', label: 'Artikli', type: 'multiline', required: true, sortOrder: 30, source: 'order.itemsBreakdown', defaultValue: null, placeholder: null, validation: null, provisional: false },
      { id: 'f4', key: 'Total', label: 'Ukupno', type: 'text', required: false, sortOrder: 40, source: 'order.total', defaultValue: null, placeholder: null, validation: null, provisional: false },
      { id: 'f5', key: 'Gift', label: 'Poklon kartica', type: 'text', required: false, sortOrder: 50, source: 'manual', defaultValue: null, placeholder: null, validation: null, provisional: true },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const calcConfig: CalculatorConfig = {
    currency: 'BAM',
    pricesIncludeTax: null,
    deliveryPolicy: 'rules',
    deliveryRules: [{ id: 'd1', name: 'Dostava', type: 'flat', enabled: true, amount: 5, freeAbove: null, note: null }],
    weightTiers: [],
    discountRules: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const build = (client: CustomerSession): OrderFormValues =>
    buildOrderFormValues(
      config,
      client,
      calculateOrder({
        items: [{ productId: 'giga_1', name: 'Traka', unitPrice: 100, quantity: 2 }],
        config: calcConfig,
        now: '2026-01-01T00:00:00.000Z',
      }),
    );

  it('maps session and calculator data with provenance', () => {
    const client = session();
    client.context = mergeCustomerDetails(client.context, { name: 'Mirsad', phone: '+387 61 111 222' });
    const values = build(client);
    const get = (key: string) => values.values.find((v) => v.field.key === key)!;
    expect(get('Name').value).toBe('Mirsad');
    expect(get('Name').provenance).toBe('kupac (sesija)');
    expect(get('Total').value).toContain('205');
    expect(get('Items').value).toContain('Traka — 100,00');
    expect(get('Items').value).toContain('× 2');
    expect(get('Items').value).toContain('200,00');
    expect(get('Items').provenance).toBe('kalkulator');
    expect(get('Gift').value).toBe('');
    expect(get('Gift').provenance).toBe('prazno');
    expect(values.missingRequired).toHaveLength(0);
  });

  it('flags missing required fields instead of inventing them', () => {
    const values = build(session());
    expect(values.missingRequired).toEqual(['Ime', 'Telefon']);
    expect(values.values.find((v) => v.field.key === 'Phone')!.missing).toBe(true);
  });

  it('validates against the field pattern', () => {
    const client = session();
    client.context = mergeCustomerDetails(client.context, { name: 'Mirsad', phone: 'nepoznat' });
    const values = build(client);
    expect(values.values.find((v) => v.field.key === 'Phone')!.validationError).not.toBeNull();
  });
});

describe('sentence capitalisation', () => {
  it('fixes a lower-case sentence start after a period', () => {
    expect(capitalizeSentences('Cijena je 650 KM. stojimo Vam na raspolaganju.')).toBe(
      'Cijena je 650 KM. Stojimo Vam na raspolaganju.',
    );
  });

  it('leaves correct text untouched', () => {
    expect(capitalizeSentences('Dostupno je. Cijena je 650 KM.')).toBe('Dostupno je. Cijena je 650 KM.');
  });
});

describe('order form delivery label', () => {
  it('never prints 0 KM when delivery is not calculated', () => {
    const config = {
      fields: [
        { id: 'f1', key: 'Delivery', label: 'Dostava', type: 'text' as const, required: false, sortOrder: 10, source: 'order.delivery' as const, defaultValue: null, placeholder: null, validation: null, provisional: false },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const session = {
      id: 's1',
      userId: 'u1',
      label: 'Test',
      status: 'active' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messageCount: 1,
      lastMessageAt: null,
      context: {
        summary: '',
        summarizedUpToMessageId: null,
        messageCountAtLastSummary: 0,
        lastSummarizedAt: null,
        products: [],
        customer: {},
        orderIntent: { value: 'unknown' as const, confidence: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
        confirmedFacts: [],
        missingInfo: [],
        outstandingQuestions: [],
        agentCorrections: [],
      },
    };
    const calculation = calculateOrder({
      items: [{ productId: 'p', name: 'X', unitPrice: 100, quantity: 1, weightKg: null }],
      config: { currency: 'BAM', pricesIncludeTax: null, deliveryPolicy: 'rules', deliveryRules: [], weightTiers: [{ id: 'w', upToKg: 10, amount: 10, enabled: true, note: null }], discountRules: [], updatedAt: '2026-01-01T00:00:00.000Z' },
    });
    const result = buildOrderFormValues(config, session, calculation);
    const delivery = result.values[0]!;
    // Praznina za ručni upis, nikad „0 KM”, uz kratko objašnjenje za agenta.
    expect(delivery.value).toBe('________ KM (kilaža nije unesena)');
  });
});

describe('context product normalization', () => {
  it('fills a missing quantity instead of losing the product', () => {
    const normalized = normalizeContextProduct({
      productId: 'p1',
      name: 'ELVA NOĆNI ORMARIĆ',
      sku: '63817',
      unitPrice: 999,
      priceSource: 'scraped',
    });
    expect(normalized?.quantity).toBeNull();
    expect(normalized?.currency).toBe('BAM');
    expect(normalized?.priceCheckedAt ?? null).toBeNull();
  });

  it('keeps a real quantity and drops an invalid one', () => {
    expect(normalizeContextProduct({ productId: 'p1', quantity: 3 })?.quantity).toBe(3);
    expect(normalizeContextProduct({ productId: 'p1', quantity: 0 })?.quantity).toBeNull();
  });

  it('normalizes the whole session context', () => {
    const context = normalizeSessionContext({
      ...emptySessionContext(),
      products: [{ productId: 'a' } as never, { productId: '' } as never],
    });
    expect(context.products).toHaveLength(1);
    expect(context.products[0]!.quantity).toBeNull();
  });
});

describe('redoslijed proizvoda u sesiji', () => {
  it('promoviše proizvode o kojima se trenutno govori na vrh', () => {
    const base = emptySessionContext();
    const withProducts = {
      ...base,
      products: [
        { productId: 'old', name: 'STARI', sku: null, unitPrice: null, currency: 'BAM', quantity: null, priceCheckedAt: null, priceSource: 'scraped' as const },
        { productId: 'a', name: 'A', sku: null, unitPrice: null, currency: 'BAM', quantity: null, priceCheckedAt: null, priceSource: 'scraped' as const },
        { productId: 'b', name: 'B', sku: null, unitPrice: null, currency: 'BAM', quantity: null, priceCheckedAt: null, priceSource: 'scraped' as const },
      ],
    };
    const promoted = promoteContextProducts(withProducts, ['b', 'a']);
    expect(promoted.products.map((p) => p.productId)).toEqual(['b', 'a', 'old']);
  });

  it('ne mijenja ništa kad nema pogodaka', () => {
    const base = emptySessionContext();
    expect(promoteContextProducts(base, ['x']).products).toEqual([]);
  });
});

describe('zaštita giga.ba od prečestih sinhronizacija', () => {
  const now = new Date('2026-11-24T10:00:00.000Z');

  it('dozvoljava prvu sinhronizaciju', () => {
    expect(checkSyncCooldown(null, now, 60).allowed).toBe(true);
  });

  it('blokira drugu u roku od 60 sekundi i kaže koliko čekati', () => {
    const verdict = checkSyncCooldown('2026-11-24T09:59:30.000Z', now, 60);
    expect(verdict.allowed).toBe(false);
    expect(verdict.waitSeconds).toBe(30);
  });

  it('dozvoljava poslije isteka roka', () => {
    expect(checkSyncCooldown('2026-11-24T09:58:00.000Z', now, 60).allowed).toBe(true);
  });
});

describe('tvrda granica prema giga.ba', () => {
  it('propušta zahtjeve dok se ne dosegne satna granica, pa blokira', () => {
    resetSiteGuard();
    process.env.SITE_MAX_REQUESTS_PER_HOUR = '3';
    process.env.SITE_MIN_GAP_MS = '0';
    const now = Date.now();
    expect(acquireSiteSlot(now)).toBe(true);
    expect(acquireSiteSlot(now + 1000)).toBe(true);
    expect(acquireSiteSlot(now + 2000)).toBe(true);
    expect(acquireSiteSlot(now + 3000)).toBe(false);
    expect(siteRequestsLastHour(now + 3000)).toBe(3);
    resetSiteGuard();
    delete process.env.SITE_MAX_REQUESTS_PER_HOUR;
    delete process.env.SITE_MIN_GAP_MS;
  });

  it('drži minimalni razmak između dva zahtjeva', () => {
    resetSiteGuard();
    process.env.SITE_MAX_REQUESTS_PER_HOUR = '100';
    process.env.SITE_MIN_GAP_MS = '500';
    const now = Date.now();
    expect(acquireSiteSlot(now)).toBe(true);
    expect(acquireSiteSlot(now + 100)).toBe(false);
    expect(acquireSiteSlot(now + 600)).toBe(true);
    resetSiteGuard();
    delete process.env.SITE_MAX_REQUESTS_PER_HOUR;
    delete process.env.SITE_MIN_GAP_MS;
  });
});
