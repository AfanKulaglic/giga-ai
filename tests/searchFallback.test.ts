import { describe, expect, it } from 'vitest';
import { searchProductCatalog } from '@/lib/domain/productSearch';
import type { Product } from '@/lib/domain/types';

function product(over: Partial<Product>): Product {
  return {
    id: 'p1',
    name: 'THALIA STOL SMINKANJE SA OGLEDALOM 100CM BIJELI',
    sku: '123',
    brand: null,
    category: 'Namještaj',
    price: 120,
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
    scrapedAt: '2026-01-01T00:00:00.000Z',
    missingFields: [],
    extractionStatus: 'complete',
    ...over,
  } as Product;
}

describe('search fallback for whole sentences', () => {
  const catalog = [product({ id: 'a' }), product({ id: 'b', name: 'RIPADO NOĆNI ORMARIĆ 45X60CM', sku: '999' })];

  it('finds the product when the customer writes a full sentence', () => {
    const hits = searchProductCatalog(catalog, 'Zanima me THALIA stol za sminkanje, ima li i koliko je dostava u Sarajevo?');
    expect(hits[0]?.product.id).toBe('a');
  });

  it('still returns nothing for an unrelated sentence', () => {
    expect(searchProductCatalog(catalog, 'imate li nesto za kuhinju od nerđajućeg čelika')).toEqual([]);
  });

  it('keeps exact name matching ahead of loose matches', () => {
    const hits = searchProductCatalog(catalog, 'RIPADO NOĆNI ORMARIĆ 45X60CM');
    expect(hits[0]?.product.id).toBe('b');
  });
});
