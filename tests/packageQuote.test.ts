import { describe, expect, it } from 'vitest';
import { buildPackageQuote, narrowPackageCandidates, packagePromptBlock, packageTotalsText, hasPackageTotal } from '@/lib/domain/packageQuote';
import { isOfferQuestion } from '@/lib/ai/offer';
import { applyDeterministicFixes, buildSafeReply, checkCustomerReply } from '@/lib/ai/replyGuard';
import { defaultCalculatorConfig } from '@/lib/config/defaults';
import type { CalculatorConfig } from '@/lib/domain/types';
import type { Product } from '@/lib/domain/types';

// formatMoney koristi tvrdi razmak prije valute (U+00A0) - tekst normalizujemo.
const norm = (value: string) => value.replace(/ /g, ' ');

const base = defaultCalculatorConfig();
const config: CalculatorConfig = {
  ...base,
  deliveryPolicy: 'rules',
  deliveryRules: [{ id: 'del_weight', name: 'Dostava po težini', type: 'by_weight', enabled: true, amount: null, freeAbove: null, note: null }],
  weightTiers: [
    { id: 'wt_5', upToKg: 5, amount: 5, enabled: true, note: null },
    { id: 'wt_20', upToKg: 20, amount: 10, enabled: true, note: null },
    { id: 'wt_50', upToKg: 50, amount: 20, enabled: true, note: null },
  ],
  discountRules: [
    { id: 'q2', name: '2 komada', type: 'quantity', enabled: true, percent: 5, amount: null, minQuantity: 2, minSubtotal: null, productIds: [], note: null, priority: 1, stackable: false },
  ],
};

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: 'p1',
    name: 'AURA KOMODA 4 LADICE',
    sku: '63533',
    brand: null,
    category: 'Namještaj',
    price: 130,
    compareAtPrice: null,
    currency: 'BAM',
    discountPercent: null,
    availability: { status: 'in_stock', checkedAt: null, source: 'site', note: null },
    images: [],
    variants: [],
    tags: [],
    specifications: {},
    shortDescription: null,
    description: null,
    url: 'https://giga.ba/p',
    source: 'shopify-json',
    sourceUpdatedAt: null,
    scrapedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Product;

describe('obračun paketa (R30)', () => {
  it('sabira kilažu i računa JEDNU dostavu za sve proizvode', () => {
    const quote = buildPackageQuote(
      [
        { productId: 'p1', name: 'AURA KOMODA', unitPrice: 130, quantity: 1, weightKg: 8 },
        { productId: 'p2', name: 'PULSAR KOMODA', unitPrice: 200, quantity: 1, weightKg: 10 },
      ],
      config,
    );
    expect(quote).not.toBeNull();
    expect(quote!.subtotal).toBe(330);
    expect(quote!.totalWeightKg).toBe(18);
    // 18 kg → tarifa do 20 kg = 10 KM, ne 5 + 10.
    expect(quote!.deliveryAmount).toBe(10);
    expect(quote!.total).toBe(340);
    expect(norm(packageTotalsText(quote!))).toContain('UKUPNO ZA PLAĆANJE: 340,00 KM');
  });

  it('popust na količinu važi za isti proizvod, dostava ostaje jedna', () => {
    const quote = buildPackageQuote(
      [
        { productId: 'p1', name: 'AURA KOMODA', unitPrice: 130, quantity: 2, weightKg: 8 },
        { productId: 'p2', name: 'PULSAR KOMODA', unitPrice: 200, quantity: 1, weightKg: 10 },
      ],
      config,
    );
    expect(quote!.subtotal).toBe(460);
    expect(quote!.discountAmount).toBe(13);
    expect(quote!.subtotalAfterDiscount).toBe(447);
    // 2×8 + 10 = 26 kg → do 50 kg = 20 KM
    expect(quote!.deliveryAmount).toBe(20);
    expect(quote!.total).toBe(467);
    expect(packageTotalsText(quote!)).toContain('Popust');
  });

  it('bez kilaže i bez podrazumijevane težine dostava ostaje praznina', () => {
    const quote = buildPackageQuote(
      [
        { productId: 'p1', name: 'AURA KOMODA', unitPrice: 130, quantity: 1, weightKg: null },
        { productId: 'p2', name: 'PULSAR KOMODA', unitPrice: 200, quantity: 1, weightKg: 10 },
      ],
      { ...config, fallbackWeightKg: null },
    );
    expect(quote!.deliveryAmount).toBeNull();
    expect(quote!.total).toBeNull();
    expect(quote!.missingWeights).toEqual(['AURA KOMODA']);
    expect(packageTotalsText(quote!)).toContain('________ KM');
  });

  it('R34: bez kilaže koristi se podrazumijevana težina iz Postavki', () => {
    const quote = buildPackageQuote(
      [
        { productId: 'p1', name: 'AURA KOMODA', unitPrice: 130, quantity: 1, weightKg: null },
        { productId: 'p2', name: 'PULSAR KOMODA', unitPrice: 200, quantity: 1, weightKg: 10 },
      ],
      { ...config, fallbackWeightKg: 1 },
    );
    // 1 kg podrazumijevano + 10 kg stvarno = 11 kg -> tarifa do 20 kg = 10 KM.
    expect(quote!.deliveryAmount).toBe(10);
    expect(quote!.total).toBe(340);
    expect(quote!.missingWeights).toEqual([]);
  });

  it('jedan komad ne pravi blok ukupnog iznosa', () => {
    const quote = buildPackageQuote([{ productId: 'p1', name: 'AURA', unitPrice: 130, quantity: 1, weightKg: 8 }], config);
    expect(quote).toBeNull();
  });
});

describe('guard za paket (R30)', () => {
  const quote = buildPackageQuote(
    [
      { productId: 'p1', name: 'AURA KOMODA', unitPrice: 130, quantity: 1, weightKg: 8 },
      { productId: 'p2', name: 'PULSAR KOMODA', unitPrice: 200, quantity: 1, weightKg: 10 },
    ],
    config,
  );

  it('traži ukupan iznos kada ga poruka nema', () => {
    const issues = checkCustomerReply(
      'AURA KOMODA je 130,00 KM, a PULSAR KOMODA 200,00 KM.',
      { products: [], customerMessage: '', packageQuote: quote },
    );
    expect(issues.some((issue) => issue.code === 'package_total_missing')).toBe(true);
  });

  it('deterministički dodaje ukupno i dostavu za paket', () => {
    const body = 'AURA KOMODA je 130,00 KM, a PULSAR KOMODA 200,00 KM.';
    const issues = checkCustomerReply(body, { products: [], customerMessage: '', packageQuote: quote });
    const fixed = applyDeterministicFixes(body, { products: [], customerMessage: '', packageQuote: quote }, issues);
    expect(norm(fixed)).toContain('UKUPNO ZA PLAĆANJE: 340,00 KM');
    expect(norm(fixed)).toContain('Dostava za cijeli paket: 10,00 KM');
    expect(hasPackageTotal(fixed)).toBe(true);
  });

  it('sigurna poruka sadrži ukupno, a ne dvije dostave', () => {
    const safe = buildSafeReply({
      products: [
        { product: product(), additional: { weightKg: 8 } as never },
        { product: product({ id: 'p2', name: 'PULSAR KOMODA', price: 200 }), additional: { weightKg: 10 } as never },
      ],
      customerMessage: 'zelim obje',
      packageQuote: quote,
    });
    expect(norm(safe)).toContain('UKUPNO ZA PLAĆANJE: 340,00 KM');
    expect((safe.match(/Dostava/gi) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('prompt blok eksplicitno zabranjuje dostavu po proizvodu', () => {
    const block = packagePromptBlock(quote!);
    expect(norm(block)).toContain('JEDAN PAKET');
    expect(norm(block)).toContain('UKUPNO ZA PLAĆANJE: 340,00 KM');
    expect(block).toMatch(/Nikad ne piši dostavu pojedinačno/);
  });
});

describe('sužavanje na ono što kupac traži (R30)', () => {
  const catalogue = [
    { name: 'AURA KOMODA LADIČAR 3 LADICE' },
    { name: 'AURA KOMODA LADIČAR 4 LADICE' },
    { name: 'AURA KOMODA LADIČAR 5 LADICA' },
    { name: 'PULSAR ORMARICI KOMODA POLICE 102 X 40 BEŽ' },
    { name: 'PULSAR ORMARICI KOMODA POLICE 153 X 40 BIJELI' },
    { name: 'SPECTRA NOCNI ORMARIC KOMODA 2 LADICE BIJELA' },
  ];

  it('uzima Aura 4 ladice i najbliži Pulsar, bez ostalih familija', () => {
    const kept = narrowPackageCandidates(
      catalogue,
      'Uzimam Aura komodu 4 ladice i Pulsar komodu 150x40, koliko ukupno?',
    ).map((item) => item.name);
    expect(kept).toContain('AURA KOMODA LADIČAR 4 LADICE');
    expect(kept.some((name) => name.startsWith('PULSAR') && name.includes('153'))).toBe(true);
    expect(kept.some((name) => name.startsWith('SPECTRA'))).toBe(false);
    expect(kept).not.toContain('AURA KOMODA LADIČAR 3 LADICE');
  });

  it('„koliko ukupno sa dostavom” nije pitanje o cijeloj ponudi', () => {
    expect(isOfferQuestion('Uzimam dvije komode, koliko me ukupno izadje sa dostavom?')).toBe(false);
    expect(isOfferQuestion('Koje sve komode imate?')).toBe(true);
    expect(isOfferQuestion('Imate li penjalice za mačke')).toBe(true);
    expect(isOfferQuestion('Koliko modela imate?')).toBe(true);
  });
});
