import type { Product, ProductAvailability } from './types';

/** Izvori koji dolaze iz nase provjere, ne iz kataloga sajta. */
const OPERATIONAL_SOURCES = new Set(['gigahub', 'live:product.js', 'manual']);

/**
 * Katalog se osvjezava sa giga.ba i tada stiže i "products.json" stanje, koje
 * bi pregazilo tačnije stanje iz GigaHuba (R31) ili live provjere. Ovim se
 * zadržava najsvježije operativno stanje, a sve ostalo (naziv, cijena, opis,
 * specifikacije) preuzima se iz novog snimka kataloga.
 */
export function mergeOperationalState(previous: Product, incoming: Product): Product {
  if (!OPERATIONAL_SOURCES.has(previous.availability.source ?? 'none')) return incoming;

  const availability: ProductAvailability = {
    ...incoming.availability,
    ...previous.availability,
    // Novi snimak ne smije vratiti "products.json" preko naseg stanja.
    status: previous.availability.status,
    source: previous.availability.source,
  };

  const previousVariants = new Map(previous.variants.map((variant) => [variant.id, variant]));
  const variants = incoming.variants.map((variant) => {
    const kept = previousVariants.get(variant.id);
    if (!kept || kept.available === undefined) return variant;
    return { ...variant, available: kept.available };
  });

  return { ...incoming, availability, variants: variants.length ? variants : incoming.variants };
}
