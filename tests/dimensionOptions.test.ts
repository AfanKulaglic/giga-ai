import { describe, expect, it } from 'vitest';
import {
  availableColors,
  extractSize,
  familyBlock,
  familySizes,
  findDimensionOptions,
  modelKey,
} from '@/lib/domain/productVariants';
import type { Product } from '@/lib/domain/types';

const make = (id: string, name: string, status: 'in_stock' | 'out_of_stock' = 'in_stock'): Product =>
  ({
    id, name, sku: null, brand: null, category: 'Namještaj', price: 100, compareAtPrice: null,
    currency: 'BAM', discountPercent: null,
    availability: { status, checkedAt: null, source: 'site', note: null },
    images: [],
    variants: [{ id: `${id}-v`, title: 'Default Title', sku: null, price: 100, compareAtPrice: null, available: status === 'in_stock' }],
    tags: [], specifications: {}, shortDescription: null, descriptionHtml: null,
    url: 'https://giga.ba/p', source: 'shopify-json', sourceUpdatedAt: null,
    scrapedAt: '2026-01-01T00:00:00.000Z', missingFields: [], extractionStatus: 'complete',
    contentHash: null, lastError: null, lastValidScrapeAt: null, options: [],
  }) as unknown as Product;

const a40 = make('a40', 'ALBA DNEVNA KOMODA STALAŽA POLICA 180X40CM');
const a80 = make('a80', 'ALBA DNEVNA KOMODA STALAŽA POLICA 180X80CM');
const a120 = make('a120', 'ALBA DNEVNA KOMODA STALAŽA POLICA 180X120CM', 'out_of_stock');
const other = make('x', 'PULSAR ORMARICI KOMODA POLICE 102 X 40 BIJELI');

describe('dimenzije istog modela', () => {
  it('čita dimenziju iz naziva', () => {
    expect(extractSize('ALBA KOMODA 180X40CM')).toEqual({ sizeKey: '180x40', label: '180 × 40 cm' });
    expect(extractSize('BEZ DIMENZIJE')).toBeNull();
  });

  it('grupiše isti model bez dimenzije', () => {
    expect(modelKey(a40.name)).toBe(modelKey(a80.name));
    expect(modelKey(a40.name)).not.toBe(modelKey(other.name));
  });

  it('vraća samo dostupne druge dimenzije', () => {
    const options = findDimensionOptions(a40, [a40, a80, a120, other]);
    expect(options.map((o) => o.sizeKey)).toEqual(['180x80']);
  });

  it('ne vraća ništa kad model ima samo jednu dimenziju', () => {
    expect(findDimensionOptions(other, [other])).toEqual([]);
  });
});

describe('kompletna ponuda: dimenzije i boje', () => {
  const mk = (id: string, name: string, price: number, inStock = true) =>
    ({
      id,
      name,
      price,
      currency: 'BAM',
      availability: { status: inStock ? 'in_stock' : 'out_of_stock' },
      variants: [],
    }) as never;

  const family = [
    mk('p1', 'PULSAR KOMODA 102 X 40 BEŽ', 59),
    mk('p2', 'PULSAR KOMODA 102 X 40 BIJELI', 59),
    mk('p3', 'PULSAR KOMODA 127 X 40 BEŽ', 69),
    mk('p4', 'PULSAR KOMODA 153 X 40 BIJELI', 85, false),
  ];

  it('grupiše sve dimenzije i sve boje jednog modela', () => {
    const sizes = familySizes(family[0]!, family);
    expect(sizes.map((size) => size.sizeKey).sort()).toEqual(['102x40', '127x40', '153x40']);
    const first = sizes.find((size) => size.sizeKey === '102x40')!;
    expect(first.variants.map((variant) => variant.color).sort()).toEqual(['bež', 'bijeli']);
  });

  it('navodi i boju koja nije na stanju', () => {
    const sizes = familySizes(family[0]!, family);
    const big = sizes.find((size) => size.sizeKey === '153x40')!;
    expect(big.variants[0]!.available).toBe(false);
    expect(familyBlock(sizes)).toContain('nije na stanju');
  });

  it('boje na stanju se izdvajaju bez duplikata', () => {
    expect(availableColors(familySizes(family[0]!, family)).sort()).toEqual(['bež', 'bijeli']);
  });
});
