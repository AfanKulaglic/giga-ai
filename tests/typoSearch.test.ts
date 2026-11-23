import { describe, expect, it } from 'vitest';
import { editDistance, findTypos, searchProductCatalog } from '@/lib/domain/productSearch';
import type { Product } from '@/lib/domain/types';

const make = (id: string, name: string, sku: string | null = null): Product =>
  ({
    id,
    name,
    sku,
    brand: null,
    category: 'Namještaj',
    price: 300,
    compareAtPrice: null,
    currency: 'BAM',
    discountPercent: null,
    availability: { status: 'in_stock', checkedAt: null, source: 'site', note: null },
    images: [],
    variants: [],
    tags: [],
    specifications: {},
    shortDescription: null,
    descriptionHtml: null,
    url: 'https://giga.ba/p',
    source: 'shopify-json',
    sourceUpdatedAt: null,
    scrapedAt: '2026-01-01T00:00:00.000Z',
    missingFields: [],
    extractionStatus: 'complete',
    contentHash: null,
    lastError: null,
    lastValidScrapeAt: null,
    options: [],
  }) as unknown as Product;

const catalogue = [
  make('1', 'PULSAR ORMARICI KOMODA POLICE 102 X 40 BIJELI'),
  make('2', 'CASSAI CIPELAR ORMARIC ZA OBUCU 90X32'),
  make('3', 'ABISKO TV KOMODA 140X50CM SMEĐA'),
  make('4', 'ALTUS RADNI STOL SA POLICOM 120X200CM'),
];

describe('editDistance', () => {
  it('counts a single wrong letter', () => {
    expect(editDistance('pulsat', 'pulsar')).toBe(1);
  });
  it('counts a missing letter', () => {
    expect(editDistance('flrk', 'flirk')).toBe(1);
  });
  it('counts a swapped pair', () => {
    expect(editDistance('pulsra', 'pulsar')).toBe(1);
  });
});

describe('typo-tolerant catalogue search', () => {
  it('finds PULSAR KOMODA when the customer wrote "pulsat komoda"', () => {
    const hits = searchProductCatalog(catalogue, 'pulsat komoda', 3);
    expect(hits[0]?.product.name).toContain('PULSAR');
    expect(hits[0]?.typos).toEqual([{ wrote: 'pulsat', catalog: 'pulsar' }]);
  });

  it('finds the right product with a missing letter ("flrk stol")', () => {
    const hits = searchProductCatalog(catalogue, 'flrk stol', 2);
    expect(hits[0]?.product.name).toContain('ALTUS');
  });

  it('keeps the right product on top when the number is included', () => {
    const hits = searchProductCatalog(catalogue, 'cipelar ormaric 90', 3);
    expect(hits[0]?.product.name).toContain('90X32');
  });

  it('reports the typo pair for the assistant', () => {
    expect(findTypos('pulsat komoda koliko kosta', [catalogue[0]!])).toEqual([
      { wrote: 'pulsat', catalog: 'pulsar' },
    ]);
  });

  it('does not report typos for correctly written names', () => {
    expect(findTypos('pulsar komoda', [catalogue[0]!])).toEqual([]);
  });
});
