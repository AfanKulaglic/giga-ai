import type { Product, ProductAvailability, ProductVariant } from '@/lib/domain/types';
import type { Store } from '@/lib/store/types';
import { acquireSiteSlot } from './siteGuard';

/**
 * Provjera "pravog stanja" na giga.ba za pojedinačan proizvod.
 *
 * Katalog u bazi je kopija napravljena u momentu sinhronizacije. Cijena i stanje
 * se na sajtu mogu promijeniti u svakom trenutku, pa prije nego što asistent
 * napiše cijenu ili dostupnost, dotični proizvod provjerimo na izvoru.
 *
 * Nije "realtime streaming" — provjera se radi u momentu korištenja, za
 * najviše nekoliko proizvoda iz razgovora, jedan zahtjev po proizvodu,
 * i najviše jednom u `ttlMs` za isti proizvod.
 */

export const DEFAULT_LIVE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export interface LiveVariantState {
  id: string;
  price: number | null;
  available: boolean | null;
  compareAtPrice: number | null;
}

export interface LiveProductState {
  price: number | null;
  available: boolean | null;
  variants: LiveVariantState[];
  checkedAt: string;
}

export interface LiveCheck {
  productId: string;
  name: string;
  ok: boolean;
  skipped: boolean;
  error: string | null;
  priceBefore: number | null;
  priceAfter: number | null;
  statusBefore: ProductAvailability['status'] | null;
  statusAfter: ProductAvailability['status'] | null;
}

export interface LiveRefreshResult {
  updated: Map<string, Product>;
  checks: LiveCheck[];
}

/** `https://giga.ba/products/aura-komoda-3-ladice` → `aura-komoda-3-ladice`. */
export function handleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/products\/([^/?#]+)/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const toDecimal = (cents: unknown): number | null => {
  if (typeof cents === 'number' && Number.isFinite(cents)) return Math.round(cents) / 100;
  if (typeof cents === 'string' && cents.trim() && Number.isFinite(Number(cents))) return Math.round(Number(cents)) / 100;
  return null;
};

/** Parsira odgovor `/products/<handle>.js` (cijene su u centima). */
export function parseLiveProduct(payload: unknown, now: Date = new Date()): LiveProductState | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  const variants: LiveVariantState[] = rawVariants.map((entry) => {
    const variant = (entry ?? {}) as Record<string, unknown>;
    return {
      id: String(variant.id ?? ''),
      price: toDecimal(variant.price),
      available: typeof variant.available === 'boolean' ? variant.available : null,
      compareAtPrice: toDecimal(variant.compare_at_price),
    };
  });

  const availableFromVariants = variants.some((variant) => variant.available === true);
  const available =
    typeof raw.available === 'boolean' ? raw.available : variants.length ? availableFromVariants : null;
  const price =
    toDecimal(raw.price) ??
    toDecimal(raw.price_min) ??
    (variants.length ? Math.min(...variants.map((v) => v.price ?? Number.POSITIVE_INFINITY)) : null);

  if (price === null && available === null) return null;

  return {
    price: price !== null && Number.isFinite(price) ? price : null,
    available,
    variants,
    checkedAt: now.toISOString(),
  };
}

async function fetchLiveProduct(handle: string): Promise<LiveProductState | null> {
  // Tvrda granica: preko nje se giga.ba ne dira, ostaje kopija iz baze.
  if (!acquireSiteSlot()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://giga.ba/products/${encodeURIComponent(handle)}.js`, {
      headers: {
        'User-Agent':
          process.env.SCRAPER_USER_AGENT ??
          'GIGA.ba internal assistant sync bot (contact: configured by operator)',
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return parseLiveProduct(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cijena i stanje iz provjere upisani u kopiju proizvoda. */
export function applyLiveState(product: Product, live: LiveProductState): Product {
  const status: ProductAvailability['status'] =
    live.available === true ? 'in_stock' : live.available === false ? 'out_of_stock' : product.availability.status;
  const availability: ProductAvailability = {
    ...product.availability,
    status,
    checkedAt: live.checkedAt,
    source: 'live:product.js',
    raw:
      live.available === true
        ? 'Provjereno na giga.ba: dostupno.'
        : live.available === false
          ? 'Provjereno na giga.ba: nije dostupno.'
          : product.availability.raw,
  };
  const variants: ProductVariant[] = product.variants.map((variant) => {
    const match = live.variants.find((entry) => entry.id === variant.id);
    if (!match) return variant;
    return {
      ...variant,
      price: match.price ?? variant.price,
      compareAtPrice: match.compareAtPrice ?? variant.compareAtPrice,
      available: match.available ?? variant.available,
    };
  });
  return {
    ...product,
    price: live.price ?? product.price,
    variants,
    availability,
    lastValidScrapeAt: live.checkedAt,
  };
}

const lastCheckAt = new Map<string, number>();

/** Testove i restart resetuju stanje; dovoljno za zaštitu izvora. */
export function resetLiveCheckCache(): void {
  lastCheckAt.clear();
}

/**
 * Provjeri `products` na giga.ba (sekvencijalno, sa pauzom) i upiši promjene
 * u bazu. Greške ne prekidaju rad: tada ostaje kopija iz baze, a agent dobija
 * napomenu da stanje nije potvrđeno.
 */
export async function refreshLiveProducts(
  store: Store,
  products: Product[],
  options: { max?: number; ttlMs?: number; delayMs?: number; now?: Date } = {},
): Promise<LiveRefreshResult> {
  const max = options.max ?? 4;
  const ttlMs = options.ttlMs ?? DEFAULT_LIVE_TTL_MS;
  const delayMs = options.delayMs ?? 150;
  const now = options.now ?? new Date();
  const updated = new Map<string, Product>();
  const checks: LiveCheck[] = [];
  const changed: Product[] = [];
  const seen = new Set<string>();

  for (const product of products) {
    if (checks.length >= max) break;
    if (seen.has(product.id)) continue;
    seen.add(product.id);

    const handle = handleFromUrl(product.url);
    const check: LiveCheck = {
      productId: product.id,
      name: product.name,
      ok: false,
      skipped: false,
      error: null,
      priceBefore: product.price,
      priceAfter: product.price,
      statusBefore: product.availability.status,
      statusAfter: product.availability.status,
    };
    checks.push(check);

    if (!handle) {
      check.skipped = true;
      check.error = 'Nema handle u URL-u proizvoda.';
      continue;
    }
    if (products.length > 1 && delayMs > 0 && checks.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const previousCheck = lastCheckAt.get(handle) ?? 0;
    if (now.getTime() - previousCheck < ttlMs) {
      check.skipped = true;
      continue;
    }

    const live = await fetchLiveProduct(handle);
    lastCheckAt.set(handle, now.getTime());
    if (!live) {
      check.error = 'provjera je preskočena (granica prema giga.ba) ili sajt nije odgovorio.';
      continue;
    }

    const next = applyLiveState(product, live);
    check.ok = true;
    check.priceAfter = next.price;
    check.statusAfter = next.availability.status;
    updated.set(product.id, next);
    if (JSON.stringify(next) !== JSON.stringify(product)) changed.push(next);
  }

  if (changed.length) {
    try {
      await store.upsertProducts(changed);
    } catch {
      // Upis nije kritičan: svježi podaci su već u odgovoru asistenta.
    }
  }

  return { updated, checks };
}

/** Rečenice za agenta o tome šta se na sajtu promijenilo. */
export function liveCheckNotes(checks: LiveCheck[]): string[] {
  const notes: string[] = [];
  for (const check of checks) {
    if (check.skipped) continue;
    if (!check.ok) {
      if (check.error) notes.push(`Stanje za „${check.name}” nije provjereno na giga.ba (${check.error}).`);
      continue;
    }
    if (check.priceBefore !== null && check.priceAfter !== null && check.priceBefore !== check.priceAfter) {
      notes.push(
        `Cijena za „${check.name}” se promijenila na giga.ba: ${check.priceBefore.toFixed(2)} → ${check.priceAfter.toFixed(2)} KM.`,
      );
    }
    if (check.statusBefore !== check.statusAfter) {
      notes.push(
        check.statusAfter === 'in_stock'
          ? `„${check.name}” je sada na stanju na giga.ba.`
          : `„${check.name}” više nije na stanju na giga.ba.`,
      );
    }
  }
  return notes;
}
