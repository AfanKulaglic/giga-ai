import { createHash } from 'node:crypto';
import type {
  AvailabilityStatus,
  ExtractionStatus,
  Product,
  ProductVariant,
} from './types';

// ---------------------------------------------------------------------------
// Normalisation of raw Shopify product JSON into the internal Product model.
// Nothing is invented: absent fields stay null and are recorded in
// `missingFields`. The raw source payload is never mutated.
// ---------------------------------------------------------------------------

export interface ShopifyVariant {
  id: number | string;
  title?: string | null;
  sku?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  available?: boolean | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  position?: number;
}

export interface ShopifyProduct {
  id: number | string;
  title: string;
  handle: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: ShopifyVariant[];
  images?: { src?: string | null; position?: number }[] | null;
  options?: { name?: string; values?: string[] }[] | null;
  published_at?: string | null;
  updated_at?: string | null;
}

const NUMERIC = /^-?\d+([.,]\d+)?$/;

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = value.replace(/\s|,/g, (m) => (m === ',' ? '.' : ''));
  if (!NUMERIC.test(cleaned.replace(/\s/g, ''))) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Conservative specification extraction. We only accept data the page itself
 * states explicitly:
 *  - two-cell table rows (label | value)
 *  - "Label: Value" inside <li>/<p> with a bold label
 * Everything else is left out rather than guessed.
 */
const SPEC_JUNK_KEYS = /^(naziv|opis|proizvod|slika|cijena|koli[čc]ina|[šs]ifra|skupina|brend\?)$/i;
const SPEC_PROSE = /\b(dolazi|dolaze|podnosi|uklapa|potrebno|uklju[čc]uje|obuhvata|omogu[cć]ava|pru[žz]a|izra[đd]en|napravljen|sadr[žz]i|ima|se|je|su)\b/i;

function cleanSpecText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function pushSpec(specs: Record<string, string>, labelRaw: string, valueRaw: string): void {
  const label = cleanSpecText(labelRaw).replace(/[:\-–—\s]+$/, '').trim();
  const value = cleanSpecText(valueRaw).replace(/^[:\-–—\s]+/, '').trim();
  if (label.length < 2 || label.length > 60) return;
  if (!value || value.length > 400) return;
  if (SPEC_JUNK_KEYS.test(label)) return;
  // Prose and links from the description must not become "specification" keys.
  if (/^(https?|www|tel|mailto|e-?mail)$/i.test(label)) return;
  if (/^(\/\/|https?:\/\/|www\.)/i.test(value)) return;
  if (label.split(/\s+/).length > 5) return;
  // Sentences that merely contain a colon ("Stolica dolazi rastavljena: …") are
  // prose, not fields. The text stays available through the description.
  if (SPEC_PROSE.test(label)) return;
  if (value.split(/\s+/).length > 30) return;
  if (!specs[label]) specs[label] = value;
}

/**
 * Specs come from the source in several shapes: two-cell tables, four-cell
 * tables (two pairs in one row), definition lists, bold labels and plain
 * `Label: value` list items. Missing any of these loses real data customers
 * ask about (material, dimensions, capacity), so all of them are read.
 */
export function extractSpecifications(html: string | null | undefined): Record<string, string> {
  const specs: Record<string, string> = {};
  if (!html) return specs;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const cells = [...(m[1] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1] ?? '');
    for (let i = 0; i + 1 < cells.length; i += 2) pushSpec(specs, cells[i]!, cells[i + 1]!);
  }

  // The regex must be a single instance: an inline literal resets lastIndex on
  // every iteration and the loop never advances.
  const dlRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((m = dlRe.exec(html))) pushSpec(specs, m[1] ?? '', m[2] ?? '');

  // A colon is required: bold prose ("<strong>Stolica dolazi rastavljena</strong> …")
  // would otherwise become a fake field name.
  const boldRe = /<(strong|b)[^>]*>([\s\S]{2,120}?)\s*:\s*<\/\1>\s*([^<]{1,300})/gi;
  while ((m = boldRe.exec(html))) pushSpec(specs, m[2] ?? '', m[3] ?? '');

  const itemRe = /<(li|p)[^>]*>([\s\S]{3,400}?)<\/\1>/gi;
  while ((m = itemRe.exec(html))) {
    const text = (m[2] ?? '').replace(/<[^>]*>/g, ' ');
    const pair = /^\s*([^:]{2,55}?)\s*[:：]\s*(.{1,300})$/s.exec(decodeEntities(text));
    if (pair) pushSpec(specs, pair[1] ?? '', pair[2] ?? '');
  }

  return specs;
}

export function extractShortDescription(html: string | null | undefined, maxLen = 220): string | null {
  const text = stripHtml(html);
  if (!text) return null;
  const firstParagraph = text.split('\n').find((line) => line.trim().length > 20) ?? text;
  const clean = firstParagraph.trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : maxLen).trim()}…`;
}

export function buildProductUrl(handle: string, domain = 'https://giga.ba'): string {
  return `${domain.replace(/\/$/, '')}/products/${handle}`;
}

export function buildVariants(raw: ShopifyProduct): ProductVariant[] {
  return (raw.variants ?? []).map((v) => ({
    id: String(v.id),
    title: v.title ?? 'Default Title',
    sku: v.sku?.trim() ? v.sku.trim() : null,
    price: num(v.price),
    compareAtPrice: num(v.compare_at_price),
    available: typeof v.available === 'boolean' ? v.available : null,
    options: {
      [raw.options?.[0]?.name ?? 'option1']: v.option1 ?? null,
      ...(v.option2 ? { [raw.options?.[1]?.name ?? 'option2']: v.option2 } : {}),
      ...(v.option3 ? { [raw.options?.[2]?.name ?? 'option3']: v.option3 } : {}),
    },
  }));
}

export function deriveAvailability(variants: ProductVariant[], checkedAt: string) {
  const known = variants.filter((v) => v.available !== null);
  if (!variants.length || !known.length) {
    return {
      status: 'unknown' as AvailabilityStatus,
      raw: null,
      checkedAt,
      source: 'products.json' as const,
    };
  }
  const availableCount = known.filter((v) => v.available).length;
  const status: AvailabilityStatus =
    availableCount === known.length ? 'in_stock' : availableCount === 0 ? 'out_of_stock' : 'partial';
  return {
    status,
    raw: `Shopify API: ${availableCount}/${known.length} varijanti označeno kao dostupno.`,
    checkedAt,
    source: 'products.json' as const,
  };
}

export function computeContentHash(product: Product): string {
  const stable = {
    name: product.name,
    brand: product.brand,
    category: product.category,
    tags: [...product.tags].sort(),
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    availability: product.availability.status,
    variants: product.variants.map((v) => [v.id, v.title, v.sku, v.price, v.available]),
    images: product.images,
    descriptionHtml: product.descriptionHtml,
    specifications: product.specifications,
    sourceUpdatedAt: product.sourceUpdatedAt,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export interface NormalizeResult {
  product: Product;
  warnings: string[];
}

export function normalizeShopifyProduct(
  raw: ShopifyProduct,
  opts: { now?: string; currency?: string; domain?: string } = {},
): NormalizeResult {
  const now = opts.now ?? new Date().toISOString();
  const warnings: string[] = [];

  if (!raw || raw.id === undefined || raw.id === null) throw new Error('Proizvod nema ID.');
  if (!raw.title || !raw.handle) throw new Error('Proizvod nema naziv ili handle.');

  const variants = buildVariants(raw);
  const priced = variants.filter((v) => v.price !== null);
  const price = priced.length ? Math.min(...priced.map((v) => v.price!)) : null;
  const compareCandidates = priced
    .map((v) => v.compareAtPrice)
    .filter((c): c is number => c !== null && price !== null && c > price);
  const compareAtPrice = compareCandidates.length ? Math.max(...compareCandidates) : null;

  const tagsRaw = raw.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).trim()).filter(Boolean)
    : typeof tagsRaw === 'string'
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const images = (raw.images ?? [])
    .map((i) => i.src)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => (s.startsWith('//') ? `https:${s}` : s));

  const sku = variants.map((v) => v.sku).find((s): s is string => !!s) ?? null;

  const missingFields: string[] = [];
  if (price === null) missingFields.push('price');
  if (!sku) missingFields.push('sku');
  if (!raw.product_type) missingFields.push('category');
  if (!raw.vendor) missingFields.push('brand');
  if (!images.length) missingFields.push('images');
  if (!raw.body_html) missingFields.push('description');
  if (!variants.some((v) => v.available !== null)) missingFields.push('availability');

  if (price === null) warnings.push('Cijena nije dostupna u izvoru.');
  if (!raw.product_type) warnings.push('Kategorija nije dostupna u izvoru.');

  const discountPercent =
    price !== null && compareAtPrice !== null && compareAtPrice > price
      ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
      : null;

  const product: Product = {
    id: `giga_${raw.id}`,
    sourceId: String(raw.id),
    sku,
    name: raw.title.trim(),
    brand: raw.vendor?.trim() || null,
    category: raw.product_type?.trim() || null,
    tags,
    url: buildProductUrl(raw.handle, opts.domain),
    images,
    price,
    compareAtPrice,
    discountPercent,
    currency: opts.currency ?? 'BAM',
    descriptionHtml: raw.body_html ?? null,
    shortDescription: extractShortDescription(raw.body_html),
    specifications: extractSpecifications(raw.body_html),
    options: (raw.options ?? []).map((o) => ({
      name: o.name ?? '',
      values: (o.values ?? []).map(String),
    })),
    variants,
    availability: deriveAvailability(variants, now),
    source: 'giga.ba',
    sourceUpdatedAt: raw.updated_at ?? null,
    scrapedAt: now,
    lastValidScrapeAt: now,
    contentHash: null,
    extractionStatus: 'incomplete',
    missingFields,
    lastError: null,
  };

  product.contentHash = computeContentHash(product);
  const status: ExtractionStatus =
    price !== null && !!product.name && !!product.url ? (missingFields.length ? 'incomplete' : 'complete') : 'failed';
  product.extractionStatus = status;

  return { product, warnings };
}
