import { describe, expect, it } from 'vitest';
import {
  buildProductUrl,
  extractSpecifications,
  normalizeShopifyProduct,
  stripHtml,
  type ShopifyProduct,
} from '@/lib/domain/productNormalize';
import { expandTokens, identifyProduct, searchProductCatalog } from '@/lib/domain/productSearch';
import { applyLiveState, handleFromUrl, liveCheckNotes, parseLiveProduct } from '@/lib/site/gigaLive';
import { isAvailable } from '@/lib/domain/productVariants';
import { mergeOperationalState } from '@/lib/domain/productMerge';

const raw = (overrides: Partial<ShopifyProduct> = {}): ShopifyProduct => ({
  id: 9001,
  title: 'Traka za trčanje FitRun X3',
  handle: 'traka-za-trcanje-fitrun-x3',
  vendor: 'FitRun',
  product_type: 'Fitnes',
  tags: ['fitnes', 'traka'],
  body_html: `
    <p>Profesionalna traka za trčanje.</p>
    <table>
      <tr><td>Brzina</td><td>18 km/h</td></tr>
      <tr><td>Težina</td><td>85 kg</td></tr>
    </table>
  `,
  images: [{ src: '//cdn.shopify.com/traka.jpg' }],
  variants: [
    { id: 1, sku: 'FR-X3', price: '1499.00', compare_at_price: '1799.00', available: true, title: 'Default Title' },
  ],
  ...overrides,
});

describe('product normalization', () => {
  it('maps Shopify data into the domain product', () => {
    const { product, warnings } = normalizeShopifyProduct(raw(), { now: '2026-01-01T00:00:00.000Z' });
    expect(product.id).toBe('giga_9001');
    expect(product.sku).toBe('FR-X3');
    expect(product.price).toBe(1499);
    expect(product.compareAtPrice).toBe(1799);
    expect(product.discountPercent).toBe(17);
    expect(product.availability.status).toBe('in_stock');
    expect(product.url).toBe('https://giga.ba/products/traka-za-trcanje-fitrun-x3');
    expect(product.images[0]).toBe('https://cdn.shopify.com/traka.jpg');
    expect(product.specifications['Brzina']).toBe('18 km/h');
    expect(product.missingFields).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('marks partial availability when only some variants are available', () => {
    const { product } = normalizeShopifyProduct(
      raw({
        variants: [
          { id: 1, sku: 'A', price: '10.00', available: true },
          { id: 2, sku: 'B', price: '12.00', available: false },
        ],
      }),
    );
    expect(product.availability.status).toBe('partial');
    expect(product.price).toBe(10);
  });

  it('reports missing fields instead of inventing them', () => {
    const { product } = normalizeShopifyProduct(
      raw({ vendor: null, product_type: null, images: [], variants: [{ id: 1, price: null }] }),
    );
    expect(product.price).toBeNull();
    expect(product.missingFields).toEqual(expect.arrayContaining(['price', 'sku', 'category', 'brand', 'images']));
    expect(product.extractionStatus).not.toBe('complete');
  });

  it('rejects products without identity', () => {
    expect(() => normalizeShopifyProduct(raw({ title: '' }))).toThrow();
    expect(() => normalizeShopifyProduct(raw({ handle: '' }))).toThrow();
  });

  it('extracts specs and strips html safely', () => {
    const specs = extractSpecifications(
      '<table><tr><td>Boja</td><td>crna</td></tr><tr><td>Materijal</td><td>čelik</td></tr></table>',
    );
    expect(specs['Boja']).toBe('crna');
    expect(stripHtml('<p>Zdravo <strong>svijete</strong></p>')).toBe('Zdravo svijete');
  });

  it('builds absolute product urls', () => {
    expect(buildProductUrl('abc')).toBe('https://giga.ba/products/abc');
  });
});

describe('product search', () => {
  const catalog = [
    normalizeShopifyProduct(raw()).product,
    normalizeShopifyProduct(
      raw({
        id: 9002,
        title: 'Sobni bicikl PowerBike M1',
        handle: 'sobnibicikl-powerbike-m1',
        product_type: 'Fitnes',
        variants: [{ id: 3, sku: 'PB-M1', price: '799.00', available: false }],
      }),
    ).product,
  ];

  it('finds products by name token', () => {
    const hits = searchProductCatalog(catalog, 'traka FitRun');
    expect(hits[0]?.product.id).toBe('giga_9001');
  });

  it('finds products by SKU', () => {
    const hits = searchProductCatalog(catalog, 'PB-M1');
    expect(hits[0]?.product.id).toBe('giga_9002');
  });

  it('returns no hits for unrelated queries', () => {
    expect(searchProductCatalog(catalog, 'skuter za vodu')).toHaveLength(0);
  });

  it('classifies identification confidence', () => {
    expect(identifyProduct(catalog, 'Traka za trčanje FitRun X3').confidence).toBe('certain');
    expect(identifyProduct(catalog, 'skuter').confidence).toBe('none');
  });

  it('keeps unknown availability explicit', () => {
    expect(catalog[1]!.availability.status).toBe('out_of_stock');
  });
});

describe('vague shopper wording', () => {
  it('expands everyday words into catalogue vocabulary', () => {
    expect(expandTokens(['sprava', 'vjezbanje'])).toEqual(expect.arrayContaining(['fitness', 'teretana']));
    expect(expandTokens(['ormarice'])).toEqual(expect.arrayContaining(['ormar', 'garderoba']));
    expect(expandTokens(['nekipojam'])).toEqual(['nekipojam']);
  });

  it('finds a fitness product when the shopper says "sprava za vježbanje"', () => {
    const { product } = normalizeShopifyProduct(
      raw({ title: 'ALLIN FITNESS KUĆNA TERETANA', product_type: 'KUĆNA TERETANA', tags: ['fitness'] }),
      { now: '2026-01-01T00:00:00.000Z' },
    );
    const hits = searchProductCatalog([product], 'sprava za vježbanje');
    expect(hits[0]?.product.id).toBe(product.id);
  });
});

describe('provjera stvarnog stanja na giga.ba', () => {
  it('izvlači handle iz URL-a proizvoda', () => {
    expect(handleFromUrl('https://giga.ba/products/aura-komoda-3-ladice')).toBe('aura-komoda-3-ladice');
    expect(handleFromUrl('https://giga.ba/products/aura-komoda-3-ladice?variant=1')).toBe('aura-komoda-3-ladice');
    expect(handleFromUrl('https://giga.ba/collections/all')).toBeNull();
    expect(handleFromUrl(null)).toBeNull();
  });

  it('parsira /products/<handle>.js (cijene su u centima)', () => {
    const live = parseLiveProduct({
      price: 8000,
      available: false,
      variants: [{ id: 44263481540784, price: 8000, available: false, compare_at_price: 15000 }],
    });
    expect(live?.price).toBe(80);
    expect(live?.available).toBe(false);
    expect(live?.variants[0]?.compareAtPrice).toBe(150);
  });

  it('odlučuje dostupnost iz varijanti kada nema zajedničkog polja', () => {
    const live = parseLiveProduct({
      variants: [
        { id: 1, price: 13000, available: false },
        { id: 2, price: 15000, available: true },
      ],
    });
    expect(live?.available).toBe(true);
    expect(live?.price).toBe(130);
  });

  it('upisuje svježe stanje u kopiju proizvoda', () => {
    const product = {
      id: 'giga_test',
      name: 'AURA KOMODA',
      url: 'https://giga.ba/products/aura-komoda-3-ladice',
      price: 80,
      availability: { status: 'in_stock' as const, raw: 'staro', checkedAt: null, source: 'products.json' as const },
      variants: [
        { id: '44263481540784', title: 'Default Title', sku: null, price: 80, compareAtPrice: null, available: true, options: {} },
      ],
    } as unknown as Parameters<typeof applyLiveState>[0];
    const next = applyLiveState(product, {
      price: 95,
      available: false,
      variants: [{ id: '44263481540784', price: 95, available: false, compareAtPrice: null }],
      checkedAt: '2026-11-24T10:00:00.000Z',
    });
    expect(next.price).toBe(95);
    expect(next.variants[0]?.available).toBe(false);
    expect(next.availability.status).toBe('out_of_stock');
    expect(next.availability.source).toBe('live:product.js');
  });

  it('piše agentu kada se cijena promijenila', () => {
    const notes = liveCheckNotes([
      {
        productId: 'giga_1',
        name: 'AURA KOMODA',
        ok: true,
        skipped: false,
        error: null,
        priceBefore: 80,
        priceAfter: 95,
        statusBefore: 'in_stock',
        statusAfter: 'in_stock',
      },
    ]);
    expect(notes[0]).toContain('80.00 → 95.00 KM');
  });
});

describe('GigaHub stanje (R31)', () => {
  const base = () => normalizeShopifyProduct(raw(), { now: '2026-01-01T00:00:00.000Z' }).product;
  const withGigahub = (quantity: number | null) => ({
    ...base(),
    availability: { status: 'in_stock' as const, raw: 'GigaHub', checkedAt: '2026-11-26T00:00:00.000Z', source: 'gigahub' as const, quantity },
  });

  it('kolicina 1 nije dostupna za prodaju', () => {
    expect(isAvailable(withGigahub(1))).toBe(false);
  });

  it('kolicina 2 je dostupna', () => {
    expect(isAvailable(withGigahub(2))).toBe(true);
  });

  it('bez podatka o kolicini vazi status iz baze', () => {
    expect(isAvailable(withGigahub(null))).toBe(true);
  });

  it('live provjera giga.ba ne prepisuje GigaHub stanje', () => {
    const product = withGigahub(0);
    const next = applyLiveState(product, {
      price: 100,
      available: true,
      variants: [],
      checkedAt: '2026-11-26T01:00:00.000Z',
    });
    expect(next.availability.source).toBe('gigahub');
    expect(next.availability.status).toBe('in_stock');
    expect(isAvailable(next)).toBe(false);
  });
});

describe('Osvjezavanje kataloga ne gazi GigaHub stanje', () => {
  const base = () => normalizeShopifyProduct(raw(), { now: '2026-01-01T00:00:00.000Z' }).product;

  it('zadrzava gigahub stanje iz prethodne verzije proizvoda', () => {
    const previous = {
      ...base(),
      availability: { status: 'out_of_stock' as const, raw: 'GigaHub: 0 kom', checkedAt: '2026-11-26T00:00:00.000Z', source: 'gigahub' as const, quantity: 0 },
    };
    const incoming = { ...base(), price: 999, availability: { status: 'in_stock' as const, raw: null, checkedAt: '2026-11-27T00:00:00.000Z', source: 'products.json' as const } };
    const merged = mergeOperationalState(previous, incoming);
    expect(merged.price).toBe(999);
    expect(merged.availability.source).toBe('gigahub');
    expect(merged.availability.status).toBe('out_of_stock');
    expect(isAvailable(merged)).toBe(false);
  });

  it('obican katalog ostaje kakav jeste', () => {
    const previous = base();
    const incoming = { ...base(), price: 500 };
    expect(mergeOperationalState(previous, incoming).availability.source).toBe('products.json');
  });
});
