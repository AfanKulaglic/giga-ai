import type { Product } from './types';
import { formatMoney } from './money';
import { normalizeText } from './productSearch';

/**
 * Sizes are separate products on GIGA.ba ("ALBA DNEVNA KOMODA 180X40CM" and
 * "…180X80CM"), not variants of one product. When a customer names the model
 * without saying which size, the assistant must ask — but only when the other
 * sizes really exist and are currently available.
 */
export interface DimensionOption {
  productId: string;
  name: string;
  /** Normalised size key, e.g. "180x40". */
  sizeKey: string;
  /** Human label, e.g. "180 × 40 cm". */
  label: string;
  price: number | null;
  currency: string;
  available: boolean;
  /** Weight entered by the agent; null when the price of delivery is unknown. */
  weightKg?: number | null;
  /** Delivery price for this size, computed from its own weight. */
  delivery?: { amount: number; currency: string } | null;
}

/** Colour words are part of the model, not of the size — they must not split a group. */
/**
 * Reči boja u nazivu. Granice su lookaround umesto `\b`, jer `\b` u JS-u
 * poznaje samo ASCII slova — „BEŽ” se sa `\b` ne bi prepoznao.
 */
const COLOR_WORD_SOURCE =
  '(?<![\\p{L}])(bijeli|bijela|bijelo|be[žz]|crni|crna|crno|sivi|siva|sivo|braon|krem|zlatni|zlatna|srebrni|srebrna|antracit|borovina|hrast|orah|plava|plavi|crvena|crveni|zelena|zeleni|[žz]uta|[žz]uti|roze|ljubi[čc]asta|tamno|svijetlo)(?![\\p{L}])';
const COLOR_WORD = new RegExp(COLOR_WORD_SOURCE, 'giu');

export function extractSize(name: string): { sizeKey: string; label: string } | null {
  const match = /\b(\d{2,3})\s*[x×]\s*(\d{2,3})(?:\s*[x×]\s*(\d{2,3}))?(?!\d)/i.exec(name);
  if (!match) return null;
  const parts = [match[1]!, match[2]!, match[3]].filter(Boolean) as string[];
  return {
    sizeKey: parts.join('x').toLowerCase(),
    label: `${parts.join(' × ')} cm`,
  };
}

/** Name without the size, so the same model in different sizes groups together. */
export function modelKey(name: string): string {
  return normalizeText(name)
    .replace(/\b\d{2,3}\s*x\s*\d{2,3}(\s*x\s*\d{2,3})?(?!\d)/g, ' ')
    .replace(/\bcm\b/g, ' ')
    .replace(new RegExp(COLOR_WORD_SOURCE, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAvailable(product: Product): boolean {
  // R31: GigaHub je mjerodavan — kolicina 1 ili manje nije dostupno za prodaju.
  if (product.availability.source === 'gigahub' && product.availability.quantity != null) {
    return product.availability.quantity >= 2;
  }
  if (product.availability.status === 'out_of_stock') return false;
  if (product.variants.length) return product.variants.some((variant) => variant.available !== false);
  return product.availability.status === 'in_stock';
}

/**
 * Other sizes of the same model. Returns only entries that are in stock, because
 * offering an unavailable size is worse than not mentioning it.
 */
export function findDimensionOptions(product: Product, catalogue: Product[], max = 4): DimensionOption[] {
  const own = extractSize(product.name);
  const key = modelKey(product.name);
  if (!own || !key) return [];

  const options: DimensionOption[] = [];
  const seen = new Set<string>([own.sizeKey]);
  for (const candidate of catalogue) {
    if (candidate.id === product.id) continue;
    if (modelKey(candidate.name) !== key) continue;
    const size = extractSize(candidate.name);
    if (!size || seen.has(size.sizeKey)) continue;
    if (!isAvailable(candidate)) continue;
    seen.add(size.sizeKey);
    options.push({
      productId: candidate.id,
      name: candidate.name,
      sizeKey: size.sizeKey,
      label: size.label,
      price: candidate.price,
      currency: candidate.currency,
      available: true,
    });
  }
  return options.slice(0, max);
}

/** Lines for the reply prompt: what other sizes exist and what they cost. */
export function dimensionOptionsBlock(
  product: Product,
  options: DimensionOption[],
): string {
  const own = extractSize(product.name);
  if (!own || !options.length) return '';
  const ownDelivery = options.find((option) => option.sizeKey === own.sizeKey)?.delivery ?? null;
  const deliveryText = (price: number | null, delivery: { amount: number; currency: string } | null | undefined) => {
    if (delivery && typeof delivery.amount === 'number') return `dostava ${formatMoney(delivery.amount, delivery.currency)}`;
    return 'dostava se ne može izračunati (težina nije unesena) — napiši da ćemo javiti tačan iznos';
  };
  const lines = [
    '  DIMENZIJE ISTOG MODELA KOJE IMAMO (kupac nije rekao koju želi):',
    `    - ${own.label}: cijena ${product.price !== null ? formatMoney(product.price, product.currency) : 'nije poznata'}, ${deliveryText(product.price, ownDelivery)}`,
    ...options.map(
      (option) =>
        `    - ${option.label}: cijena ${option.price !== null ? formatMoney(option.price, option.currency) : 'nije poznata'}, ${deliveryText(option.price, option.delivery)}`,
    ),
    '  U poruci kupcu OBAVEZNO navedi SVE ove dimenzije, svaku sa svojom cijenom i cijenom dostave, pa pitaj koju dimenziju želi (R21). Ne šalji kupca na provjeru za dimenzije koje su ovdje navedene.',
  ];
  return lines.join('\n');
}

/** Boja iz naziva ("… 102 X 40 BEŽ" -> "bež"); null kada je naziv ne navodi. */
export function extractColor(name: string): string | null {
  const match = new RegExp(COLOR_WORD_SOURCE, 'iu').exec(name);
  return match ? match[0].toLowerCase() : null;
}

export interface FamilyVariant {
  productId: string;
  color: string;
  price: number | null;
  currency: string;
  available: boolean;
}

export interface FamilySize {
  sizeKey: string;
  label: string;
  variants: FamilyVariant[];
}

/**
 * Sve dimenzije i sve boje jednog modela — i one koje trenutno nisu na stanju.
 * Kupac mora dobiti kompletnu sliku ponude, a ne samo prvu pronađenu boju.
 */
export function familySizes(product: Product, catalogue: Product[], maxSizes = 12): FamilySize[] {
  const key = modelKey(product.name);
  if (!key) return [];
  const sizes = new Map<string, FamilySize>();
  const add = (candidate: Product) => {
    const size = extractSize(candidate.name);
    if (!size) return;
    const entry = sizes.get(size.sizeKey) ?? { sizeKey: size.sizeKey, label: size.label, variants: [] };
    entry.variants.push({
      productId: candidate.id,
      color: extractColor(candidate.name) ?? '',
      price: candidate.price,
      currency: candidate.currency,
      available: isAvailable(candidate),
    });
    sizes.set(size.sizeKey, entry);
  };

  if (extractSize(product.name)) add(product);
  for (const candidate of catalogue) {
    if (candidate.id === product.id) continue;
    if (modelKey(candidate.name) !== key) continue;
    add(candidate);
  }

  const area = (size: FamilySize) =>
    size.sizeKey.split('x').reduce((total, part) => total * Number(part || 0), 1);
  return [...sizes.values()]
    .sort((a, b) => area(a) - area(b))
    .map((size) => ({
      ...size,
      variants: size.variants.sort((a, b) => Number(b.available) - Number(a.available) || a.color.localeCompare(b.color)),
    }))
    .slice(0, maxSizes);
}

/** Prompt blok: sve dimenzije × sve boje, sa cijenom i stanjem. */
export function familyBlock(sizes: FamilySize[]): string {
  if (sizes.length < 2) return '';
  const lines = sizes.map((size) => {
    const variants = size.variants
      .map(
        (variant) =>
          `${variant.color || 'bez oznake boje'} ${variant.price !== null ? formatMoney(variant.price, variant.currency) : '(cijena nije poznata)'} ${
            variant.available ? '— na stanju' : '— nije na stanju'
          }`,
      )
      .join('; ');
    return `    - ${size.label}: ${variants}`;
  });
  return [
    '  SVE DIMENZIJE I BOJE OVOG MODELA (kompletna ponuda iz kataloga):',
    ...lines,
    '  U poruci kupcu OBAVEZNO navedi SVE gore navedene dimenzije i SVE boje koje su na stanju, svaku sa svojom cijenom i cijenom dostave. Za boju/dimenziju koja nije na stanju napiši da trenutno nije dostupna. Ništa od ovoga ne preskači (R21).',
  ].join('\n');
}

/** Boje koje su dostupne u bilo kojoj dimenziji modela. */
export function availableColors(sizes: FamilySize[]): string[] {
  const colors = new Set<string>();
  for (const size of sizes) for (const variant of size.variants) if (variant.available && variant.color) colors.add(variant.color);
  return [...colors];
}
