import { findPostalCodesInText, lookupPostalCodes } from './postalCodes';
import { normalizeOrderPhone } from './phone';
import type { CustomerDetails } from './types';

/**
 * Pulls order details out of what the customer actually wrote.
 *
 * The assistant usually fills these through a tool, but a customer often just
 * pastes "Marko Marković, bb, Zenica 72101, 061 123 456" into the chat. This
 * deterministic reader guarantees the GigaHub form is not empty in that case,
 * and it never overwrites a value the agent confirmed earlier.
 */
const PHONE = /(?:\+?387|00387|0)\s?(?:3\d|[4-6]\d)\s?[\d\s/-]{5,12}/g;

const NAME_LABEL_FULL = /(?:ime\s*i\s*prezime|kontakt\s+osoba)\s*[:\-–]?\s*([A-ZŠĐČĆŽ][\p{L}]+(?:\s+[A-ZŠĐČĆŽ][\p{L}]+){0,3})/iu;
const NAME_LABEL =
  /(?<![\p{L}])(?:[Ii]me(?:\s*[Ii]\s*[Pp]rezime)?|[Pp]rezime|[Ii]me\s+[Kk]upca)\s*[:\-–]?\s+([\p{Lu}][\p{L}\-]+(?:\s+[\p{Lu}][\p{L}\-]+){0,3})/u;
const NAME_INLINE = /\b(?:ja\s+sam|moje\s+ime\s+je|zovem\s+se)\s+([A-ZŠĐČĆŽ][\p{L}]+(?:\s+[A-ZŠĐČĆŽ][\p{L}]+){1,3})/iu;

const ADDRESS_LABEL = /(?:adresa|ulica|dostava\s+na|pošaljite\s+na|posaljite\s+na)\s*[:\-–]\s*([^\n,;]{3,80})/iu;
const STREET_INLINE = /\b([A-ZŠĐČĆŽ][\p{L}.\-]*(?:\s+[\p{L}.\-]+){0,3}\s+(?:bb|\d{1,4}[a-zA-Z]?))\b/u;

/**
 * Riječi koje se često nađu na početku rečenice i zbog kojih bi obična rečenica
 * („Treba mi ona sa 4 ladice”) izgledala kao adresa.
 */
const NOT_AN_ADDRESS = new Set([
  'treba', 'trebam', 'trebamo', 'molim', 'hvala', 'imate', 'imam', 'imamo', 'zelim', 'želim',
  'uzeo', 'uzela', 'uzecu', 'uzeću', 'uzimam', 'dajte', 'daj', 'posaljite', 'pošaljite', 'zanima',
  'kako', 'koja', 'koji', 'koje', 'koliko', 'gdje', 'kada', 'posto', 'pošto',
  'ona', 'onaj', 'ono', 'ovaj', 'ova', 'ovo', 'sa', 'sam', 'sve', 'samo', 'moze', 'može',
  'ladice', 'ladica', 'komada', 'komad', 'kom', 'dimenzija', 'cijena', 'dostava', 'mogu',
  // Nazivi proizvoda nisu adrese: „Aura komoda sa 4” nije ulica.
  'komoda', 'komode', 'komodu', 'ormar', 'ormara', 'ormaric', 'ormarić', 'ormarici', 'polica',
  'police', 'stolica', 'stolice', 'sto', 'stola', 'stočić', 'krevet', 'krevetac', 'trosjed',
  'fotelja', 'madrac', 'dušek', 'vitrina', 'klupa', 'fotelje', 'stolice', 'set', 'garnitura',
]);

function looksLikeAddress(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const tail = words[words.length - 1]!.toLowerCase().replace(/[.,;]+$/, '');
  if (!/^(?:bb|\d{1,4}[a-z]?)$/.test(tail)) return false;
  const body = words.slice(0, -1).map((word) => word.toLowerCase().replace(/[.,;]+$/, ''));
  if (!body.some((word) => /[\p{L}]{3,}/u.test(word))) return false;
  // Bilo koja riječ iz naziva proizvoda ili iz obične rečenice ruši kandidata.
  return !body.some((word) => NOT_AN_ADDRESS.has(word));
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
}

function normalizePhone(raw: string): string {
  // Isti format kao GigaHub: 062576456 — bez 387 i bez crtica.
  return normalizeOrderPhone(tidy(raw));
}

export function extractCustomerDetails(text: string): Partial<CustomerDetails> {
  const out: Partial<CustomerDetails> = {};
  if (!text.trim()) return out;

  // Kupac često pošalje dva broja: "062576456, 066234888". Za GigaHub se
  // spremaju oba, uvijek u formatu bez 387 i bez crtica.
  const phones = (text.match(PHONE) ?? [])
    .map(normalizePhone)
    .filter((value) => value.replace(/\D/g, '').length >= 8);
  const uniquePhones = [...new Set(phones)];
  if (uniquePhones.length) out.phone = uniquePhones.join(', ');

  const email = text.match(EMAIL)?.[0];
  if (email) out.email = email;

  const name = NAME_LABEL_FULL.exec(text)?.[1] ?? NAME_LABEL.exec(text)?.[1] ?? NAME_INLINE.exec(text)?.[1];
  if (name) out.name = tidy(name);

  // Postal code: written by the customer or resolved from a mentioned place.
  const written = text.match(/\b\d{5}\b/)?.[0];
  if (written) {
    const known = lookupPostalCodes(written, 1)[0];
    out.postalCode = written;
    if (known?.place) out.city = known.place;
  } else {
    const place = findPostalCodesInText(text, 1)[0];
    if (place) {
      out.postalCode = place.code;
      out.city = place.place;
    }
  }

  const labelled = ADDRESS_LABEL.exec(text)?.[1];
  const inline = STREET_INLINE.exec(text)?.[1];
  const street = labelled ?? (inline && looksLikeAddress(inline) ? inline : undefined);
  if (street) {
    const cleaned = tidy(street)
      .replace(/\b\d{5}\b/g, '')
      .replace(/,\s*$/, '')
      .trim();
    if (cleaned.length >= 3) out.address = cleaned;
  }

  // "Zenica 72101" is a city, not a street.
  if (out.address && out.city && out.address.toLowerCase().includes(out.city.toLowerCase())) {
    out.address = tidy(out.address.replace(new RegExp(out.city, 'i'), '')) || out.address;
  }

  return out;
}

/** Same reader across the whole conversation, newest message wins. */
export function extractCustomerDetailsFromMessages(contents: string[]): Partial<CustomerDetails> {
  const merged: Partial<CustomerDetails> = {};
  for (const content of contents) {
    const found = extractCustomerDetails(content);
    for (const [key, value] of Object.entries(found) as [keyof CustomerDetails, string | undefined][]) {
      if (value) merged[key] = value;
    }
  }
  return merged;
}

/**
 * Očisti vrijednosti koje očito nisu podaci kupca.
 *
 * Postojeći razgovori su mogli dobiti pogrešnu „adresu” iz rečenice
 * („Aura komoda sa 4”), a takva vrijednost završi u GigaHub obrascu. Adresa
 * zato mora imati broj ili „bb”, telefon mora imati dovoljno cifara, a ime i
 * grad ne smiju sadržavati cifre.
 */
export function sanitizeCustomerDetails(details: Partial<CustomerDetails>): Partial<CustomerDetails> {
  const out: Partial<CustomerDetails> = { ...details };

  if (out.address) {
    const value = out.address.trim();
    const hasNumber = /(?:^|\s)(?:bb|\d{1,4}[a-zA-Z]?)$/u.test(value);
    if (!hasNumber || value.split(/\s+/).length < 2) delete out.address;
  }
  if (out.phone && out.phone.replace(/\D/g, '').length < 8) delete out.phone;
  if (out.name && /\d/.test(out.name)) delete out.name;
  if (out.city && /\d/.test(out.city)) delete out.city;

  return out;
}
