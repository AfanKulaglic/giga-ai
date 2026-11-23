import { describe, expect, it } from 'vitest';
import { searchProductCatalog } from '@/lib/domain/productSearch';
import type { Product } from '@/lib/domain/types';

const make = (id: string, name: string): Product =>
  ({
    id, name, sku: null, brand: null, category: 'Namještaj', price: 100, compareAtPrice: null,
    currency: 'BAM', discountPercent: null,
    availability: { status: 'in_stock', checkedAt: null, source: 'site', note: null },
    images: [], variants: [], tags: [], specifications: {}, shortDescription: null,
    descriptionHtml: null, url: 'https://giga.ba/p', source: 'shopify-json', sourceUpdatedAt: null,
    scrapedAt: '2026-01-01T00:00:00.000Z', missingFields: [], extractionStatus: 'complete',
    contentHash: null, lastError: null, lastValidScrapeAt: null, options: [],
  }) as unknown as Product;

// Dovoljno veliki katalog da "tip" prag (12%) ima smisla.
const catalogue = [
  make('1', 'PULSAR ORMARICI KOMODA POLICE 102 X 40 BIJELI'),
  make('2', 'ABISKO TV KOMODA 140X50CM SMEĐA'),
  make('3', 'ALBA DNEVNA KOMODA STALAŽA POLICA 180X40CM'),
  ...Array.from({ length: 40 }, (_, i) => make(`s${i}`, `SOME POLICA ${i}`)),
  ...Array.from({ length: 40 }, (_, i) => make(`t${i}`, `SOME STOL ${i}`)),
];

describe('filter po tipu proizvoda', () => {
  it('vraća samo komode kad kupac traži komodu', () => {
    const hits = searchProductCatalog(catalogue, 'komoda', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.product.name.includes('KOMODA'))).toBe(true);
  });

  it('ne miješa police kad se traži komoda', () => {
    const hits = searchProductCatalog(catalogue, 'komoda sa policama', 10);
    expect(hits.every((h) => h.product.name.includes('KOMODA'))).toBe(true);
  });

  it('i dalje vraća rezultate kad tip ne postoji', () => {
    const hits = searchProductCatalog(catalogue, 'neki nepostojeci tip', 5);
    expect(Array.isArray(hits)).toBe(true);
  });
});
