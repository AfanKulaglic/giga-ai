import postalCodes from '@/data/postal-codes-bih.json';

/**
 * Bosnian postal codes, taken from the official JP BH Pošta / Pošte Srpske /
 * HP Mostar list (Spisak poštanskih brojeva u Bosni i Hercegovini).
 *
 * The assistant must never guess a postal code: it can only quote what this
 * table returns. When a place is not in the table the agent is told to check
 * with the post office instead of inventing a number.
 */
export interface PostalEntry {
  code: string;
  place: string;
}

export interface PostalMatch extends PostalEntry {
  /** True when the place name matched the query exactly. */
  exact: boolean;
  /** The post office network that owns the code. */
  post: string | null;
}

const ENTRIES: PostalEntry[] = (postalCodes as { code: string; place: string; post?: string | null }[]).map((row) => ({
  code: row.code,
  place: row.place,
}));

const POST_BY_CODE = new Map<string, string | null>(
  (postalCodes as { code: string; post?: string | null }[]).map((row) => [row.code, row.post ?? null]),
);

/** Lowercase, strip diacritics and punctuation so "Bihać" === "bihac". */
export function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NOISE_PREFIXES = /\b(grad|opcina|opstina|naselje|selo|mjesto)\b/g;

function cleanQuery(value: string): string {
  return normalizePlace(value).replace(NOISE_PREFIXES, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Look up postal codes for a place, or the place for a postal code.
 * Exact place matches come first, then prefix matches, then partial matches.
 */
export function lookupPostalCodes(query: string, limit = 5): PostalMatch[] {
  const raw = query.trim();
  if (!raw) return [];

  if (/^\d{5}$/.test(raw)) {
    const place = ENTRIES.filter((entry) => entry.code === raw);
    return place.slice(0, limit).map((entry) => ({
      ...entry,
      exact: true,
      post: POST_BY_CODE.get(entry.code) ?? null,
    }));
  }

  const q = cleanQuery(raw);
  if (!q) return [];

  const scored: { entry: PostalEntry; score: number }[] = [];
  for (const entry of ENTRIES) {
    const place = cleanQuery(entry.place);
    let score = 0;
    if (place === q) score = 100;
    else if (place.startsWith(`${q} `) || place.startsWith(q)) score = 80;
    else if (place.includes(` ${q}`) || place.includes(q)) score = 55;
    if (!score) continue;
    // Shorter place names are better matches for a bare city name.
    score -= Math.min(20, Math.max(0, place.length - q.length));
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
  return scored.slice(0, limit).map(({ entry, score }) => ({
    ...entry,
    exact: score >= 80,
    post: POST_BY_CODE.get(entry.code) ?? null,
  }));
}

export interface PlaceInText extends PostalMatch {
  /** The text fragment that produced the match, e.g. "Zenici". */
  mentioned: string;
}

/**
 * Bosnian place names inflect ("u Zenici", "iz Banje Luke"), so a literal
 * match would miss most real messages. These are the common case endings,
 * including the k→c / g→z palatalisation ("Luka" → "Luci").
 */
function wordForms(word: string): string[] {
  const forms = new Set<string>([word]);
  const stem = /[aeiou]$/.test(word) ? word.slice(0, -1) : word;
  for (const suffix of ['a', 'e', 'i', 'u', 'om', 'oj', 'em', 'ima']) {
    forms.add(stem + suffix);
  }
  if (stem.endsWith('k')) forms.add(`${stem.slice(0, -1)}ci`);
  if (stem.endsWith('g')) forms.add(`${stem.slice(0, -1)}zi`);
  if (stem.endsWith('h')) forms.add(`${stem.slice(0, -1)}si`);
  return [...forms].filter((form) => form.length >= 3);
}

/**
 * Bosnian place names inflect in both words ("Banja Luka" → "Banje Luke"),
 * so short two-word names get the cross product of their word forms.
 */
function placeVariants(normalized: string): string[] {
  const out = new Set<string>([normalized]);
  const words = normalized.split(' ');
  const last = words[words.length - 1] ?? '';
  if (!last) return [...out];

  if (words.length === 2) {
    const first = words[0] ?? '';
    for (const firstForm of wordForms(first)) {
      for (const lastForm of wordForms(last)) {
        out.add(`${firstForm} ${lastForm}`);
      }
    }
    return [...out];
  }

  const prefix = words.length > 2 ? `${words.slice(0, -1).join(' ')} ` : '';
  for (const form of wordForms(last)) {
    out.add(prefix + form);
  }

  return [...out].filter((v) => v.length >= 4);
}

const LOOKUP_INDEX = ENTRIES.map((entry) => {
  const normalized = cleanQuery(entry.place);
  const words = normalized.split(' ');
  // Distinctive last word ("Mostar" in "Sanski Most") only counts as a weak
  // match, otherwise "iz Mostara" would resolve to Sanski Most.
  const lastWordVariants = words.length > 1 ? placeVariants(words[words.length - 1] ?? '').filter((v) => v.length >= 6) : [];
  return { entry, normalized, variants: placeVariants(normalized), lastWordVariants };
})
  // Longest names first so "Istočno Sarajevo" wins over "Sarajevo".
  .sort((a, b) => b.normalized.length - a.normalized.length);

/**
 * Finds postal codes for every place name mentioned in a free-text message,
 * including inflected forms and a written postal code.
 * Deterministic: the same text always yields the same codes.
 */
export function findPostalCodesInText(text: string, limit = 3): PlaceInText[] {
  const cleaned = cleanQuery(text);
  const haystack = ` ${cleaned} `;
  if (!haystack.trim()) return [];

  const found: PlaceInText[] = [];
  const used = new Set<string>();

  const push = (entry: PostalEntry) => {
    if (used.has(entry.code)) return;
    used.add(entry.code);
    found.push({
      ...entry,
      exact: true,
      post: POST_BY_CODE.get(entry.code) ?? null,
      mentioned: entry.place,
    });
  };

  // A postal code written by the customer resolves to its place.
  for (const coded of text.match(/\b\d{5}\b/g) ?? []) {
    const match = ENTRIES.find((entry) => entry.code === coded);
    if (match) push(match);
  }

  const scored: { entry: PostalEntry; full: boolean }[] = [];
  for (const { entry, variants, lastWordVariants } of LOOKUP_INDEX) {
    const full = variants.some((variant) => haystack.includes(` ${variant}`));
    const partial = !full && lastWordVariants.some((variant) => haystack.includes(` ${variant}`));
    if (full || partial) scored.push({ entry, full });
  }

  // Full place name beats a weak last-word hit; longer phrase beats a shorter
  // one inside it ("Istočno Sarajevo" before "Sarajevo").
  scored.sort((a, b) => {
    if (a.full !== b.full) return a.full ? -1 : 1;
    const lenDiff = cleanQuery(b.entry.place).length - cleanQuery(a.entry.place).length;
    if (lenDiff) return lenDiff;
    return a.entry.code.localeCompare(b.entry.code);
  });

  for (const { entry } of scored) {
    if (found.length >= limit) break;
    push(entry);
  }

  return found.slice(0, limit);
}

/** Human-readable prompt block; empty string when nothing matched. */
export function postalCodesPromptBlock(matches: PlaceInText[]): string {
  if (!matches.length) return '';
  const lines = matches.map((m) => `- ${m.place} → ${m.code}${m.post ? ` (${m.post})` : ''}`);
  return `POŠTANSKI BROJEVI IZ SISTEMSKE BAZE (tačni, koristi isključivo ove; nikad ne izmišljaj broj):
${lines.join('\n')}`;
}
