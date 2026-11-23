import type { Product } from '@/lib/domain/types';
import { CATEGORY_STEMS, stems } from '@/lib/domain/collections';
import { formatMoney } from '@/lib/domain/money';

/**
 * „Koje grebalice imate?” — pitanje o cijeloj ponudi, ne o jednom proizvodu.
 * Na takvo pitanje odgovor mora navesti SVE što je na stanju, a ne prvih pet
 * rezultata pretrage (R26 + potpunost ponude).
 */
export function isOfferQuestion(text: string): boolean {
  if (!text.trim()) return false;
  return /(?<![\p{L}])(koje|koja|koji|koliko|ima(te)?\s+li|imate|imamo|šta|sta|koje\s+sve|sve\s+koje)(?![\p{L}])/iu.test(
    text,
  ) || /asortiman|ponud[au]|koje sve|cijeli spisak|popis/iu.test(text);
}

/** Proizvodi koje smijemo ponuditi: samo na stanju (R26). */
export function offerCandidates(products: Product[], limit = 15): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const product of products) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    if (product.availability.status !== 'in_stock') continue;
    out.push(product);
    if (out.length >= limit) break;
  }
  return out;
}

export interface OfferLine {
  name: string;
  /** Formatirana cijena za tekst poruke. */
  price: string;
  /** Numerička cijena — guard je mora znati da nije izmišljena. */
  amount: number | null;
  note: string | null;
}

export function offerLines(products: Product[]): OfferLine[] {
  return products.map((product) => ({
    name: product.name,
    price: product.price !== null ? formatMoney(product.price, product.currency) : 'cijena nije poznata',
    amount: typeof product.price === 'number' ? product.price : null,
    note: product.sku ? `SKU ${product.sku}` : null,
  }));
}

/** Blok za model: tačan spisak koji mora prenijeti kupcu. */
export function offerPromptBlock(products: Product[], totalInStock: number): string {
  if (!products.length) return '';
  const lines = offerLines(products)
    .map((line, index) => `${index + 1}. ${line.name} — ${line.price} — dostava: ________ KM`)
    .join('\n');
  const remaining = Math.max(0, totalInStock - products.length);
  return [
    'KUPAC PITA ŠTA IMAMO U PONUDI. Navedi SVE stavke iz liste, svaku u svom redu, sa cijenom i sa „dostava: ________ KM”.',
    'Ne spajaj stavke, ne skraćuj spisak i ne izostavljaj nijednu. Ne dodaj proizvod kojeg nema u listi.',
    lines,
    remaining > 0
      ? `Na stanju je ukupno ${totalInStock} modela; u listi su prva ${products.length}. Na kraju napiši da ima još ${remaining} modela i ponudi da pošalješ ostatak.`
      : `Na stanju je ukupno ${totalInStock} modela i svi su u listi.`,
  ].join('\n');
}

/** Redak koji se dodaje kad model preskoči dio ponude. */
export function offerLineText(line: OfferLine): string {
  return `• ${line.name} — ${line.price} (dostava: ________ KM)`;
}

/**
 * Da li kupac pita za KONKRETAN model („Imate li Aura komodu 4 ladice”) ili za
 * cijelu kategoriju („Koje sve komode imate”). Na konkretno pitanje se odgovara
 * cijenom; link na kategoriju ide samo kad je pitanje opšte.
 */
export function mentionsSpecificModel(text: string, productNames: string[]): boolean {
  if (/(\d+\s*[x×]\s*\d+)|(\d+\s*ladic)/iu.test(text)) return true;
  const names = productNames.map((name) => name.toLowerCase());
  const generic = new Set([
    'imate', 'imamo', 'koliko', 'koje', 'koje', 'sve', 'košta', 'kosta', 'cijena', 'cijenu', 'dostava',
    'dostavu', 'model', 'modela', 'komada', 'komad', 'želim', 'zelim', 'treba', 'trebam', 'imate',
  ]);
  return stems(text).some((token) => {
    if (token.length < 4 || generic.has(token) || CATEGORY_STEMS.has(token)) return false;
    return names.some((name) => name.includes(token));
  });
}
