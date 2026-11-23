import type { ContextProduct, Product, SessionContext } from './types';
import { emptySessionContext } from './sessionContext';

export interface ProductSearchHit {
  product: Product;
  score: number;
  matchedOn: ('sku' | 'name' | 'brand' | 'category' | 'tag')[];
  /** Words the customer spelled differently, e.g. "pulsat" -> "pulsar". */
  typos?: { wrote: string; catalog: string }[];
}

/**
 * Damerau-Levenshtein distance with an early exit. Customers mistype product
 * names all the time ("pulsat komoda"), and a single wrong letter must still
 * reach the real product instead of "we don't have it".
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prevPrev = prev.slice();
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, current[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2]! + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = current;
  }
  return prev[b.length]!;
}

/** How many edits are tolerated for a word of this length (short words: none). */
function typoTolerance(word: string): number {
  if (word.length <= 3) return 0;
  if (word.length <= 6) return 1;
  return 2;
}

interface WordMatch {
  /** 1 = exact word, 0.7 = accepted with a typo. */
  strength: number;
  catalogWord: string | null;
}

function matchWord(words: string[], token: string): WordMatch {
  for (const word of words) {
    if (word === token) return { strength: 1, catalogWord: null };
  }
  for (const word of words) {
    if (word.length >= 3 && word.startsWith(token) && token.length >= 3) return { strength: 0.85, catalogWord: null };
  }
  const tolerance = typoTolerance(token);
  if (!tolerance) return { strength: 0, catalogWord: null };
  let best: { distance: number; word: string } | null = null;
  for (const word of words) {
    if (Math.abs(word.length - token.length) > tolerance) continue;
    if (word[0] !== token[0] && token.length < 7) continue;
    const distance = editDistance(token, word, tolerance);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) best = { distance, word };
  }
  return best ? { strength: 0.7, catalogWord: best.word } : { strength: 0, catalogWord: null };
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'i','ili','za','na','u','sa','se','je','li','da','od','do','po','koji','koja','koje','ovaj','ova','ovo','ovog','ovom',
  'imate','imamo','kako','koliko','košta','kosta','cijena','dali','d','a','the','with','cm','mm','kg',
]);

export function tokenize(query: string): string[] {
  return normalizeText(query)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Shoppers describe things loosely ("sprava za vježbanje", "ormarica"), while
 * the catalogue uses its own vocabulary. These groups widen the query so the
 * assistant can offer real, in-stock alternatives instead of "not found".
 */
const SYNONYM_GROUPS: string[][] = [
  ['fitness', 'teretana', 'sprava', 'sprave', 'vjezbanje', 'vjezbanja', 'trening', 'treniranje', 'gym', 'trenazer', 'trazna', 'bucice', 'tegovi'],
  ['ormar', 'ormaric', 'ormarica', 'ormarice', 'garderoba', 'plakar', 'polica', 'police', 'regal'],
  ['sofa', 'trosjed', 'dvosjed', 'garnitura', 'kauc', 'fotelja'],
  ['krevet', 'krevetac', 'madrac', 'hrptenjaca', 'posteljina'],
  ['sto', 'stolova', 'stolic', 'stolica', 'stolice', 'trpezarija'],
  ['lampa', 'rasvjeta', 'svjetiljka'],
];

/** Adds synonyms so vague requests still reach a real catalogue match. */
export function expandTokens(tokens: string[]): string[] {
  const extra = new Set<string>();
  for (const token of tokens) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(token)) for (const synonym of group) extra.add(synonym);
    }
  }
  if (!extra.size) return tokens;
  return [...new Set([...tokens, ...extra])];
}

/**
 * Deterministic product scorer used for search and identification.
 * Returns the best hits with an explicit confidence so the assistant can ask
 * the agent to clarify instead of silently choosing an uncertain match.
 */
export function searchProductCatalog(products: Product[], query: string, limit = 8): ProductSearchHit[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const baseTokens = tokenize(query);
  const tokens = expandTokens(baseTokens);
  const queryNumbers = (query.match(/\b\d{3,}\b/g) ?? []).map((s) => s.toLowerCase());

  const hits: ProductSearchHit[] = [];

  for (const product of products) {
    const name = normalizeText(product.name);
    const brand = normalizeText(product.brand ?? '');
    const category = normalizeText(product.category ?? '');
    const sku = normalizeText(product.sku ?? '');
    const tags = product.tags.map(normalizeText);

    let score = 0;
    const matchedOn: ProductSearchHit['matchedOn'] = [];

    if (sku && (query.toLowerCase().trim() === sku || queryNumbers.includes(sku))) {
      score += 1000;
      matchedOn.push('sku');
    }

    if (name === normalized) {
      score += 600;
      matchedOn.push('name');
    } else if (name.includes(normalized)) {
      score += 320 + Math.min(120, normalized.length * 4);
      matchedOn.push('name');
    }

    const nameWords = name.split(' ');
    const typos: { wrote: string; catalog: string }[] = [];

    if (baseTokens.length) {
      let matchedTokens = 0;
      let weight = 0;
      let matchedWeight = 0;
      // Coverage is measured only on the customer's own words: synonym padding
      // must never make a product that matches the real name look weaker than
      // one that merely matches a generic synonym.
      for (const token of baseTokens) {
        const w = Math.min(8, token.length);
        weight += w;
        // Exact word first, then a typo-tolerant comparison ("pulsat" -> "pulsar").
        const nameMatch: WordMatch = name.includes(token) ? { strength: 1, catalogWord: null } : matchWord(nameWords, token);
        if (nameMatch.strength) {
          matchedTokens += nameMatch.strength;
          matchedWeight += w * nameMatch.strength;
          if (!matchedOn.includes('name')) matchedOn.push('name');
          if (nameMatch.catalogWord) typos.push({ wrote: token, catalog: nameMatch.catalogWord });
        } else if (brand.includes(token)) {
          matchedTokens += 0.5;
          matchedWeight += w * 0.4;
          if (!matchedOn.includes('brand')) matchedOn.push('brand');
        } else if (category.includes(token)) {
          matchedTokens += 0.35;
          matchedWeight += w * 0.3;
          if (!matchedOn.includes('category')) matchedOn.push('category');
        } else if (tags.some((t) => t.includes(token))) {
          matchedTokens += 0.25;
          matchedWeight += w * 0.2;
          if (!matchedOn.includes('tag')) matchedOn.push('tag');
        }
      }
      const coverage = weight ? matchedWeight / weight : 0;
      if (coverage >= 0.5) score += Math.round(coverage * 240);
      if (matchedTokens < baseTokens.length * 0.4) score -= 60;
    }

    // Synonyms count as supporting evidence, never as a substitute for the
    // shopper's own words, so precision stays intact.
    const synonymHits = tokens.filter(
      (token) =>
        !baseTokens.includes(token) &&
        (name.includes(token) || category.includes(token) || brand.includes(token) || tags.some((t) => t.includes(token))),
    );
    if (synonymHits.length) {
      score += Math.min(200, synonymHits.length * 50);
      if (!matchedOn.length) matchedOn.push('category');
    }

    if (queryNumbers.some((n) => name.includes(n) || sku.includes(n))) score += 40;

    if (score > 40) hits.push({ product, score, matchedOn, ...(typos.length ? { typos } : {}) });
  }

  /**
   * A whole customer sentence ("Zanima me THALIA stol za sminkanje, ima li i
   * koliko je dostava u Sarajevo?") dilutes coverage with words that are not in
   * any product, so the strict scorer finds nothing and the assistant wrongly
   * answers "nemamo". This looser second pass scores only the words that exist
   * somewhere in the catalogue.
   */
  if (!hits.length) {
    const candidates = expandTokens(baseTokens).filter((t) => t.length > 2);
    const loose: ProductSearchHit[] = [];
    for (const product of products) {
      const haystack = [
        normalizeText(product.name),
        normalizeText(product.brand ?? ''),
        normalizeText(product.category ?? ''),
        normalizeText(product.sku ?? ''),
        ...product.tags.map(normalizeText),
      ].join(' ');
      let matched = 0;
      let strongest = 0;
      const typos: { wrote: string; catalog: string }[] = [];
      const words = haystack.split(' ').filter(Boolean);
      for (const token of candidates) {
        const direct = haystack.includes(token);
        const fuzzy: WordMatch = direct ? { strength: 1, catalogWord: null } : matchWord(words, token);
        if (!fuzzy.strength) continue;
        matched += fuzzy.strength;
        strongest = Math.max(strongest, token.length);
        if (fuzzy.catalogWord && baseTokens.includes(token)) typos.push({ wrote: token, catalog: fuzzy.catalogWord });
      }
      // At least one meaningful word (4+ letters) has to hit the product.
      if (!matched || strongest < 4) continue;
      const score = 45 + Math.round(matched * 40) + Math.min(60, strongest * 4);
      loose.push({ product, score, matchedOn: ['name'], ...(typos.length ? { typos } : {}) });
    }
    hits.push(...loose);
  }

  /**
   * A named product type narrows the answer: for "komoda" only komode, not
   * every item that shares some word. A token is treated as a type when it
   * appears in a small share of the catalogue (so "stol" filters, but a brand
   * that appears in hundreds of names does not).
   */
  if (hits.length && baseTokens.length) {
    const total = products.length;
    const typeTokens = baseTokens.filter((token) => {
      if (token.length < 4) return false;
      let df = 0;
      for (const product of products) if (normalizeText(product.name).includes(token)) df++;
      return df > 0 && df / total <= 0.12;
    });
    if (typeTokens.length) {
      const sameType = hits.filter((hit) => {
        const name = normalizeText(hit.product.name);
        return typeTokens.some((token) => name.includes(token));
      });
      // Never return nothing just because the type word is unusual.
      if (sameType.length) return sameType.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).slice(0, limit);
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).slice(0, limit);
}

export type IdentificationConfidence = 'certain' | 'likely' | 'ambiguous' | 'none';

export interface IdentificationResult {
  confidence: IdentificationConfidence;
  best: ProductSearchHit | null;
  alternatives: ProductSearchHit[];
  reason: string;
}

/** Decide whether a product match is safe to use without asking the agent. */
export function identifyProduct(products: Product[], query: string): IdentificationResult {
  const hits = searchProductCatalog(products, query, 5);
  if (!hits.length) {
    return { confidence: 'none', best: null, alternatives: [], reason: 'Nijedan proizvod ne odgovara upitu.' };
  }
  const [best, second] = hits as [ProductSearchHit, ProductSearchHit | undefined];
  if (best.score >= 600) {
    return { confidence: 'certain', best, alternatives: hits.slice(1), reason: 'Tačan naziv ili SKU.' };
  }
  if (best.score >= 300 && (!second || best.score >= second.score * 1.5)) {
    return { confidence: 'likely', best, alternatives: hits.slice(1), reason: 'Jasan ali ne i tačan naziv.' };
  }
  return {
    confidence: 'ambiguous',
    best,
    alternatives: hits.slice(1),
    reason: 'Više proizvoda odgovara upitu — potrebna potvrda agenta.',
  };
}

/** Build a context product snapshot from a catalogue product + optional price. */
export function contextProductFrom(product: Product, quantity: number | null = null): ContextProduct {
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    unitPrice: product.price,
    currency: product.currency,
    quantity,
    priceCheckedAt: product.scrapedAt,
    priceSource: 'scraped',
  };
}

export { emptySessionContext };

/**
 * Words the customer spelled differently from the catalogue ("pulsat" ->
 * "pulsar"). Used to tell the assistant which product was probably meant, without
 * correcting the shopper for the mistake.
 */
export function findTypos(query: string, products: Product[]): { wrote: string; catalog: string }[] {
  const tokenList = tokenize(query).filter((t) => t.length >= 4);
  if (!tokenList.length || !products.length) return [];
  const words = products.flatMap((product) => normalizeText(product.name).split(' ')).filter(Boolean);
  const pairs: { wrote: string; catalog: string }[] = [];
  const seen = new Set<string>();
  for (const token of tokenList) {
    if (words.includes(token)) continue;
    const match = matchWord(words, token);
    if (!match.catalogWord || seen.has(token)) continue;
    seen.add(token);
    pairs.push({ wrote: token, catalog: match.catalogWord });
  }
  return pairs;
}
