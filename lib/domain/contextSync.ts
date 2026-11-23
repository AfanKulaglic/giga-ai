import type { ContextProduct, Product, SessionContext } from './types';
import { extractCustomerDetails, sanitizeCustomerDetails } from './customerExtraction';
import { extractSize, modelKey } from './productVariants';
import { mergeCustomerDetails, upsertContextProduct } from './sessionContext';

/**
 * Drži karticu „Kupac” i karticu „Proizvodi u sesiji” u toku sa razgovorom.
 *
 * Radi deterministički, bez AI poziva, na svakoj kupčevoj poruci: ono što je
 * kupac upravo napisao odmah mijenja sesiju. Kad kupac prvi put pita za model
 * („imate li Aura komodu?”), u karticu ulaze sve dimenzije. Kad poslije napiše
 * tačno koju želi („ona 102 x 40, bijela”), ostale dimenzije se ODMAH brišu.
 */

const COLOR_WORDS = [
  'bež', 'bez', 'bijeli', 'bijela', 'bijelo', 'bijelom', 'crni', 'crna', 'crno', 'crnom',
  'sivi', 'siva', 'sivo', 'sivom', 'antracit', 'krem', 'orah', 'hrast', 'bijeljeni',
  'plavi', 'plava', 'zeleni', 'zelena', 'roze', 'žuti', 'žuta', 'braon', 'smeđi', 'smeđa',
  'zlatni', 'srebrni', 'trešnja', 'wenge', 'sonoma',
];

const QUANTITY_WORDS: Record<string, number> = {
  jedan: 1, jedna: 1, jedno: 1, jednu: 1,
  dva: 2, dvije: 2, dve: 2,
  tri: 3, četiri: 4, cetiri: 4, pet: 5, šest: 6, sest: 6, sedam: 7, osam: 8, devet: 9, deset: 10,
};

/** Riječi iz razgovora koje ne smiju povući novi proizvod u karticu. */
const GENERIC_WORDS = new Set([
  'imate', 'imam', 'imamo', 'treba', 'trebam', 'zelim', 'želim', 'uzeo', 'uzela', 'uzecu', 'uzeću',
  'uzimam', 'komada', 'komad', 'ladice', 'ladica', 'dimenzija', 'dimenzije', 'cijena', 'cijenu',
  'dostava', 'dostavu', 'molim', 'hvala', 'koliko', 'kako', 'koja', 'koji', 'koje', 'ova', 'ovo',
  'onaj', 'ona', 'ono', 'posto', 'pošto', 'moze', 'možete', 'mogu', 'dajte', 'posaljite', 'pošaljite',
  'kupac', 'kupca', 'telefon', 'adresa', 'grad', 'postanski', 'poštanski', 'broj', 'plava', 'bijela',
]);

export interface RequestedSpec {
  /** Npr. `102x40`. */
  sizes: string[];
  /** Npr. `3` iz „3 ladice”. */
  drawerCounts: string[];
  colors: string[];
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9čćžšđ/×x ]/giu, ' ').replace(/\s+/g, ' ').trim();

/** Broj ladica iz naziva proizvoda: „AURA KOMODA LADIČAR 3 LADICE” → `3`. */
export function drawerCountOf(name: string): string | null {
  const match = /(\d)\s*ladic/iu.exec(name);
  return match?.[1] ?? null;
}

/** Samo ono što kupac zaista traži — dimenzija, broj ladica, boja. */
export function parseRequestedSpec(text: string, knownNames: string[] = []): RequestedSpec {
  const raw = text.toLowerCase();
  const sizes = new Set<string>();
  const drawerCounts = new Set<string>();
  const colors = new Set<string>();

  for (const match of raw.matchAll(/(\d{2,3})\s*[x×]\s*(\d{2,3})/gu)) {
    sizes.add(`${match[1]}x${match[2]}`.toLowerCase());
  }
  for (const match of raw.matchAll(/(\d)\s*ladic/gu)) {
    drawerCounts.add(match[1]!);
  }

  // Goli broj („ona od 102”, „velicina 127”) prihvatamo samo ako taj broj
  // postoji u nazivu nekog proizvoda iz razgovora — inače bi svaka cijena ili
  // telefon postali „dimenzija”.
  const knownNumbers = new Set<string>();
  for (const name of knownNames) {
    for (const token of normalize(name).split(' ')) {
      if (/^\d{2,3}$/.test(token) && Number(token) >= 30) knownNumbers.add(token);
    }
  }
  for (const match of raw.matchAll(/(?<![\d.,])(\d{2,3})(?![\d.,])/gu)) {
    const value = match[1]!;
    if (!knownNumbers.has(value)) continue;
    // Ignoriši broj koji je dio para dimenzija (već pokriveno).
    const before = raw.slice(Math.max(0, match.index - 6), match.index);
    if (/[x×]\s*$/.test(before)) continue;
    sizes.add(value);
  }

  for (const word of COLOR_WORDS) {
    if (new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu').test(raw)) colors.add(word);
  }

  return { sizes: [...sizes], drawerCounts: [...drawerCounts], colors: [...colors] };
}

export function specIsEmpty(spec: RequestedSpec): boolean {
  return !spec.sizes.length && !spec.drawerCounts.length && !spec.colors.length;
}

/**
 * Da li proizvod odgovara onome što kupac traži.
 * Dimenzija i broj ladica moraju se poklopiti; boja samo ako je proizvod ima u nazivu.
 */
export function productMatchesSpec(product: { name: string }, spec: RequestedSpec): boolean {
  const name = normalize(product.name);
  const size = extractSize(product.name);
  const sizeKey = size?.sizeKey ?? null;

  if (spec.sizes.length) {
    const hit = spec.sizes.some((wanted) => {
      if (sizeKey && (sizeKey === wanted || sizeKey.startsWith(`${wanted}x`))) return true;
      if (wanted.includes('x')) {
        const [a, b] = wanted.split('x');
        return Boolean(a && b && name.includes(a) && name.includes(b));
      }
      return name.split(' ').includes(wanted);
    });
    if (!hit) return false;
  }

  if (spec.drawerCounts.length) {
    const drawers = drawerCountOf(product.name);
    if (!drawers || !spec.drawerCounts.includes(drawers)) return false;
  }

  if (spec.colors.length) {
    const hits = spec.colors.some((color) => {
      const stem = color.length > 3 ? color.slice(0, 4) : color;
      return name.includes(stem);
    });
    if (!hits) return false;
  }

  return true;
}

/** „2 komada”, „tri kom”, „po 4” → broj. */
export function parseQuantity(text: string): number | null {
  const raw = text.toLowerCase();

  const digits = /(?<![\d.,])(\d{1,3})\s*(?:kom|komad|komada|kom\.|puta|proizvoda)/u.exec(raw);
  if (digits?.[1]) {
    const value = Number(digits[1]);
    if (value > 0 && value <= 999) return value;
  }

  for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
    if (new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu').test(raw)) return value;
  }
  return null;
}

export interface ContextSyncResult {
  context: SessionContext;
  /** Šta je poruka promijenila — koristi se za napomene i testove. */
  changed: {
    customerFields: string[];
    droppedProductIds: string[];
    quantitySet: { productId: string; quantity: number }[];
    addedProductIds: string[];
  };
}

const contextProductFrom = (product: Product, quantity: number | null): ContextProduct => ({
  productId: product.id,
  name: product.name,
  sku: product.sku,
  unitPrice: product.price,
  currency: product.currency,
  quantity,
  priceCheckedAt: new Date().toISOString(),
  priceSource: 'scraped',
});

/**
 * Jedan ulaz za sve: podaci kupca + sužavanje liste proizvoda + količina.
 * Namjerno NIKAD ne briše cijelu listu: ako nijedan proizvod ne odgovara
 * napisanom, lista ostaje kakva jeste, a novi kandidati se dodaju.
 */
export function syncContextWithCustomerMessage(
  context: SessionContext,
  input: { text: string; matches: Product[]; maxAdd?: number },
): ContextSyncResult {
  // Pitanje o cijeloj ponudi („imate li penjalice za mačke”) puni karticu svim
  // modelima, a pitanje o jednom proizvodu samo s nekoliko kandidata.
  const maxAdd = Math.max(1, input.maxAdd ?? 3);
  const text = input.text ?? '';
  const changed: ContextSyncResult['changed'] = {
    customerFields: [],
    droppedProductIds: [],
    quantitySet: [],
    addedProductIds: [],
  };

  // 1. Podaci kupca (ime, telefon, adresa, grad, poštanski broj) — odmah.
  const found = extractCustomerDetails(text);
  let next = context;
  const shouldApply = (key: keyof typeof found): boolean => {
    const value = found[key];
    if (!value) return false;
    return String(context.customer[key] ?? '').trim() !== String(value).trim();
  };
  const patch = Object.fromEntries(
    (Object.keys(found) as (keyof typeof found)[]).filter((key) => shouldApply(key)).map((key) => [key, found[key]]),
  );
  if (Object.keys(patch).length) {
    changed.customerFields = Object.keys(patch);
    next = mergeCustomerDetails(next, patch);
  }

  // Stare pogrešno izvučene vrijednosti (npr. „adresa” iz naziva proizvoda)
  // uklanjaju se čim dođe nova poruka, da ne završe u GigaHub obrascu.
  const cleanCustomer = sanitizeCustomerDetails(next.customer);
  for (const key of Object.keys(next.customer) as (keyof typeof next.customer)[]) {
    if (!(key in cleanCustomer)) delete next.customer[key];
  }

  // 2. Sužavanje liste proizvoda prema onome što tačno traži.
  const existingNames = next.products.map((p) => p.name);
  const spec = parseRequestedSpec(text, [...existingNames, ...input.matches.map((m) => m.name)]);
  const quantity = parseQuantity(text);

  if (!specIsEmpty(spec) && next.products.length) {
    const kept = next.products.filter((product) => productMatchesSpec(product, spec));
    if (kept.length && kept.length < next.products.length) {
      changed.droppedProductIds = next.products
        .filter((product) => !kept.includes(product))
        .map((product) => product.productId);
      next = { ...next, products: kept };
    }
  }

  // 3. Novi kandidati iz kataloga. Kartica ne smije ponovo puniti listu koju je
  //    kupac već suzio: „Uzeću 2 komada” ne smije vratiti dimenzije koje je
  //    maloprije odbio. Novi proizvod ulazi samo ako ga poruka stvarno imenuje
  //    (naziv modela) ili ako u sesiji još nema nijednog proizvoda.
  const messageTokens = new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word)),
  );
  const mentionsProduct = (product: Product): boolean => {
    const tokens = normalize(product.name).split(' ');
    return tokens.some((token) => token.length >= 4 && messageTokens.has(token));
  };

  if (input.matches.length) {
    const candidates = specIsEmpty(spec)
      ? input.matches.filter(mentionsProduct).slice(0, maxAdd)
      : input.matches.filter((product) => productMatchesSpec(product, spec)).slice(0, maxAdd);
    for (const product of candidates) {
      if (next.products.some((p) => p.productId === product.id)) continue;
      // Kad je kupac već suzio izbor na jednu dimenziju, ne dodajemo druge.
      if (!specIsEmpty(spec) && next.products.length && !productMatchesSpec(product, spec)) continue;
      if (specIsEmpty(spec) && next.products.length && !mentionsProduct(product)) continue;
      next = upsertContextProduct(next, contextProductFrom(product, quantity));
      changed.addedProductIds.push(product.id);
    }
  }

  // 4. Količina: upisuje se samo kad je ostao jedan proizvod (inače je nejasno
  //    na koji se od dimenzija odnosi) ili kad je kupac dodao novi proizvod.
  if (quantity && quantity > 0) {
    if (next.products.length === 1) {
      const single = next.products[0]!;
      if (single.quantity !== quantity) {
        next = upsertContextProduct(next, { ...single, quantity });
        changed.quantitySet.push({ productId: single.productId, quantity });
      }
    } else if (changed.addedProductIds.length === 1) {
      const only = next.products.find((p) => p.productId === changed.addedProductIds[0]);
      if (only && only.quantity !== quantity) {
        next = upsertContextProduct(next, { ...only, quantity });
        changed.quantitySet.push({ productId: only.productId, quantity });
      }
    }
  }

  // 5. Proizvodi iz iste grupe drže se zajedno: kad je kupac suzio na jednu
  //    dimenziju, druge dimenzije istog modela više ne trebaju u kartici.
  if (!specIsEmpty(spec) && next.products.length > 1) {
    const keys = new Set(next.products.map((p) => modelKey(p.name)));
    if (keys.size === 1 && spec.sizes.length + spec.drawerCounts.length > 0) {
      // Ostavljamo sve koje kupac nije isključio; ništa dodatno ne brišemo.
    }
  }

  return { context: next, changed };
}
