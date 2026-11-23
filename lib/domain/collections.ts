import raw from './collections.json';

/**
 * Kategorije sa giga.ba (Shopify kolekcije).
 *
 * Zašto link, a ne spisak: kada kupac pita „koje sve grebalice imate”, tačan
 * odgovor je link na stranicu kategorije — kupac tamo vidi sve, sa slikama, i
 * kaže koji model je mislio. Prepisivanje 12+ naziva u chat je sporije i
 * podložno greškama.
 *
 * Podaci su snimljeni jednom (jedan zahtjev prema sajtu) i više se ne diraju,
 * pa aplikacija zbog ovoga ne opterećuje giga.ba.
 */
export interface CollectionRef {
  handle: string;
  title: string;
  products: number;
  url: string;
}

interface CollectionRecord {
  handle: string;
  title: string;
  products: number;
}

const SITE = 'https://giga.ba';

export const COLLECTIONS: CollectionRef[] = (raw as CollectionRecord[]).map((item) => ({
  ...item,
  url: `${SITE}/collections/${item.handle}`,
}));

/** Riječi koje same ne opisuju kategoriju. */
const NOISE = new Set([
  'giga',
  'sve',
  'svi',
  'all',
  'the',
  'and',
  'sa',
  'za',
  'od',
  'i',
  'u',
  'na',
  'do',
  'cm',
  'kom',
  'komada',
  'set',
  'setovi',
  'novo',
  'akcija',
  'rasprodaja',
  'kolekcija',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/[žš]/g, 's')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Korijen riječi: „grebalice” i „grebalica” moraju pasti na isto. */
function stem(word: string): string {
  const clean = normalize(word).replace(/-/g, '');
  if (clean.length <= 5) return clean;
  return clean.slice(0, 5);
}

export function stems(value: string): string[] {
  return normalize(value)
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !NOISE.has(w))
    .map(stem);
}

/**
 * Najbolja kategorija za ono što je kupac napisao.
 * Vraća `null` kada ništa ne odgovara — tada se link ne izmišlja.
 */
export function matchCollection(text: string): CollectionRef | null {
  const wanted = new Set(stems(text));
  if (!wanted.size) return null;

  let best: { item: CollectionRef; score: number } | null = null;
  for (const item of COLLECTIONS) {
    const have = new Set([...stems(item.title), ...stems(item.handle)]);
    let score = 0;
    for (const token of wanted) if (have.has(token)) score += 1;
    if (!score) continue;
    // Kod istog broja poklapanja prednost ima veća kategorija („GIGA Komode sve”
    // prije „TV Komode”), pa kraći naziv — nikad manja podkolekcija.
    const better =
      !best ||
      score > best.score ||
      (score === best.score && item.products > best.item.products) ||
      (score === best.score && item.products === best.item.products && item.title.length < best.item.title.length);
    if (better) best = { item, score };
  }
  if (!best) return null;
  // Jedna zajednička riječ je dovoljna samo ako nije opšta („polica”, „stolica”).
  return best.item;
}

/** Kratka rečenica sa linkom koju kupac može odmah otvoriti. */
export function collectionLinkLine(collection: CollectionRef): string {
  return `Sve modele iz ove kategorije možete pogledati ovdje: ${collection.url}`;
}

/** Blok za prompt asistenta (nije za kupca). */
export function collectionPromptBlock(collection: CollectionRef | null, fallbackLabel: string | null): string | null {
  if (!collection) return null;
  return [
    'PITANJE O CIJELOJ PONUDI: kupac pita šta sve imate.',
    `Kategorija: ${collection.title} (${collection.products} proizvoda) — ${collection.url}`,
    'Uputi kupca na taj link i zamoli ga da pogleda modele i javi koji mu se sviđa / na koji je mislio.',
    'Nije potrebno nabrajati sve proizvode; dovoljno je 2–3 primjera ako baš želiš, ali link je obavezan.',
    fallbackLabel ? `Ako link ne radi, kategorija se zove: ${fallbackLabel}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Korijeni svih naziva kategorija — riječi koje opisuju vrstu, ne model. */
export const CATEGORY_STEMS: Set<string> = new Set(
  COLLECTIONS.flatMap((item) => [...stems(item.title), ...stems(item.handle)]),
);
