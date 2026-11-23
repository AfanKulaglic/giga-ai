import { calculateOrder, type CalcItemInput } from './calculator';
import { formatMoney } from './money';
import type { CalculatorConfig } from './types';

/**
 * Obračun za CIJELU narudžbu — jedan paket, jedna dostava (R30).
 *
 * Kupac koji uzima više proizvoda ne plaća dostavu po proizvodu: pošiljka je
 * jedan paket, pa se kilaža sabira, a dostava se računa jednom za ukupnu
 * težinu. Zato ovaj modul uvijek vraća: cijene po proizvodu, zbir proizvoda,
 * popust na količinu (samo isti proizvod, R28), jednu dostavu i ukupno za
 * plaćanje. Sav novac ide kroz `calculateOrder` — model ništa ne sabira.
 */

export interface PackageLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  weightKg: number | null;
  /** weightKg × quantity, ili null kada kilaža nije unesena. */
  lineWeightKg: number | null;
}

export interface PackageQuote {
  currency: string;
  lines: PackageLine[];
  /** Zbir svih linija bez popusta. */
  subtotal: number;
  /** Ukupan iznos popusta na količinu (samo isti proizvod). */
  discountAmount: number;
  /** Npr. „2 kom → 5%”. */
  discountLabels: string[];
  subtotalAfterDiscount: number;
  /** Ukupna težina paketa; null kada bilo koja linija nema kilažu. */
  totalWeightKg: number | null;
  /** Dostava za cijeli paket; null kada kilaža nije unesena. */
  deliveryAmount: number | null;
  /** subtotalAfterDiscount + dostava; null kada dostava nije poznata. */
  total: number | null;
  /** Nazivi proizvoda bez unesene kilaže — agent ih mora dopuniti. */
  missingWeights: string[];
}

export interface PackageItemInput {
  productId: string;
  name: string;
  sku?: string | null;
  unitPrice: number | null;
  quantity: number | null;
  weightKg?: number | null;
}

/**
 * Vraća obračun paketa samo kada je narudžba zaista „više od jednog komada”:
 * dva ili više proizvoda, ili jedan proizvod u količini većoj od 1. U
 * suprotnom vraća null — jedan komad ne treba blok ukupnog iznosa.
 */
export function buildPackageQuote(
  items: PackageItemInput[],
  config: CalculatorConfig,
  currency = 'BAM',
): PackageQuote | null {
  const priced = items.filter((item) => typeof item.unitPrice === 'number' && item.unitPrice > 0);
  const totalPieces = priced.reduce((sum, item) => sum + Math.max(1, Math.round(item.quantity ?? 1)), 0);
  if (priced.length < 2 && totalPieces < 2) return null;

  const calcItems: CalcItemInput[] = priced.map((item) => ({
    productId: item.productId,
    name: item.name,
    sku: item.sku ?? null,
    unitPrice: item.unitPrice,
    quantity: Math.max(1, Math.round(item.quantity ?? 1)),
    weightKg: item.weightKg ?? null,
    currentCatalogPrice: item.unitPrice,
  }));

  const result = calculateOrder({ items: calcItems, config });

  const lines: PackageLine[] = result.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    weightKg: line.weightKg,
    lineWeightKg: line.lineWeightKg,
  }));

  const discountLabels = result.discounts.map(
    (discount) =>
      discount.percent !== null && !discount.name.includes('%')
        ? `${discount.name} (${discount.percent}%)`
        : discount.name,
  );

  const missingWeights = lines
    .filter((line) => line.weightKg === null || line.weightKg <= 0)
    .map((line) => line.name);

  const deliveryAmount =
    result.delivery.status === 'applied' && typeof result.delivery.amount === 'number'
      ? result.delivery.amount
      : null;

  return {
    currency: result.currency || currency,
    lines,
    subtotal: result.subtotal,
    discountAmount: result.discountTotal,
    discountLabels,
    subtotalAfterDiscount: result.subtotalAfterDiscount,
    totalWeightKg: result.totalWeightKg,
    deliveryAmount,
    total: deliveryAmount === null ? null : result.subtotalAfterDiscount + deliveryAmount,
    missingWeights,
  };
}


/** Prva riječ naziva je „familija” proizvoda (AURA, PULSAR, SPECTRA…). */
function familyKey(name: string): string {
  const first = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)[0] ?? '';
  return first.length >= 5 ? first.slice(0, 5) : first;
}

/**
 * Sužava kandidate na ono što kupac STVARNO traži u poruci: samo familije koje
 * je imenovao, a unutar familije samo dimenzija/broj ladica koje je napisao.
 * Tako paket ne sadrži sve slične proizvode iz kataloga.
 */
/**
 * Suzava kandidate na ono sto kupac STVARNO trazi u poruci: samo familije koje
 * je imenovao, a unutar familije samo dimenziju/broj ladica koje je napisao.
 * Tako paket ne sadrzi sve slicne proizvode iz kataloga.
 * (Bez regex klasa sa escape sekvencama: samo [0-9] i obicni split.)
 */
export function narrowPackageCandidates<T extends { name: string }>(candidates: T[], customerText: string): T[] {
  const tokens = customerText
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(' ')
    .filter(Boolean);

  const families = new Set<string>();
  for (const token of tokens) {
    if (token.length >= 4) families.add(token.length >= 5 ? token.slice(0, 5) : token);
  }

  const named = candidates.filter((item) => families.has(familyKey(item.name)));
  if (!named.length) return [];

  // Dimenzije iz poruke: token oblika 150x40 (ili 150X40).
  const wantedNumbers: number[] = [];
  for (const token of tokens) {
    const parts = token.split('x');
    if (parts.length !== 2) continue;
    if (!/^[0-9]{2,3}$/.test(parts[0] ?? '') || !/^[0-9]{2,3}$/.test(parts[1] ?? '')) continue;
    wantedNumbers.push(Number(parts[0] ?? 0), Number(parts[1] ?? 0));
  }

  // Broj ladica iz poruke: token broj neposredno prije rijeci koja pocinje sa "ladic".
  const wantedDrawers: string[] = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index]!;
    const next = tokens[index + 1]!;
    if (/^[0-9]$/.test(token) && next.startsWith('ladic')) wantedDrawers.push(token);
  }

  const byFamily = new Map<string, T[]>();
  for (const item of named) {
    const key = familyKey(item.name);
    byFamily.set(key, [...(byFamily.get(key) ?? []), item]);
  }

  const numbersOf = (name: string): number[] =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, ' ')
      .split(' ')
      .filter((token) => /^[0-9]{2,3}$/.test(token))
      .map(Number);

  const result: T[] = [];
  for (const group of byFamily.values()) {
    let kept = group;

    // 1) Tracena dimenzija: poredimo GLAVNI broj (sirinu), ne bilo koji broj,
    //    jer sve police imaju 40 u nazivu pa bi se filtriralo na sve.
    if (wantedNumbers.length && group.some((item) => numbersOf(item.name).length)) {
      const wanted = wantedNumbers[0]!;
      const mainNumber = (name: string): number | null => numbersOf(name)[0] ?? null;
      const exact = group.filter((item) => mainNumber(item.name) === wanted);
      if (exact.length) {
        kept = exact;
      } else {
        // 2) Priblizna dimenzija (150x40 umjesto 153x40): najbliza sirina.
        const scored = group
          .map((item) => {
            const value = mainNumber(item.name);
            return { item, distance: value === null ? Number.MAX_SAFE_INTEGER : Math.abs(value - wanted) };
          })
          .sort((a, b) => a.distance - b.distance);
        const closest = scored[0]?.distance ?? Number.MAX_SAFE_INTEGER;
        if (closest !== Number.MAX_SAFE_INTEGER) {
          kept = scored.filter((entry) => entry.distance === closest).map((entry) => entry.item);
        }
      }
    }
    // 3) Broj ladica, samo u familiji koja ladice ima u nazivu.
    if (wantedDrawers.length && group.some((item) => item.name.toLowerCase().includes('ladic'))) {
      const filtered = kept.filter((item) =>
        wantedDrawers.some((count) => item.name.toLowerCase().includes(`${count} ladic`)),
      );
      if (filtered.length) kept = filtered;
    }

    // 4) Ako kupac nije rekao boju, u paket ide JEDAN model, ne obje boje.
    const mentionColors = ['bez', 'bijel', 'crn', 'bijela', 'crna', 'bez', 'siv', 'hrast', 'orah'];
    const namedColor = mentionColors.some((color) => tokens.some((token) => token.startsWith(color.slice(0, 4))));
    if (!namedColor && kept.length > 1) kept = [kept[0]!];

    // Familija bez poklapanja ne smije nestati: bolje sve iz nje nego nista.
    result.push(...(kept.length ? kept : group));
  }

  return result.slice(0, 6);
}
/** Red po proizvodu: naziv × količina — cijena. */
export function packageLineText(line: PackageLine, currency: string): string {
  const pieces = line.quantity > 1 ? ` × ${line.quantity}` : '';
  return `${line.name}${pieces} — ${formatMoney(line.lineTotal, currency)}`;
}

/** Blok koji model dobije u promptu — svi brojevi su već izračunati. */
export function packagePromptBlock(quote: PackageQuote): string {
  const cur = quote.currency;
  const rows = quote.lines.map((line) => `    - ${packageLineText(line, cur)}`);
  const parts = [
    'NARUDŽBA JE JEDAN PAKET — JEDNA DOSTAVA (R30). Kilaža se sabira za sve proizvode i dostava se računa JEDNOM za cijeli paket.',
    'CIJENE PO PROIZVODU (napiši svaku):',
    ...rows,
    `PROIZVODI UKUPNO: ${formatMoney(quote.subtotal, cur)}`,
  ];
  if (quote.discountAmount > 0) {
    parts.push(
      `POPUST (${quote.discountLabels.join(', ')}): -${formatMoney(quote.discountAmount, cur)} — navedi ga jer ga kupac ostvaruje`,
      `PROIZVODI NAKON POPUSTA: ${formatMoney(quote.subtotalAfterDiscount, cur)}`,
    );
  }
  if (quote.deliveryAmount !== null) {
    parts.push(
      `DOSTAVA ZA CIJELI PAKET (ukupno ${quote.totalWeightKg ?? 0} kg): ${formatMoney(quote.deliveryAmount, cur)}`,
      `UKUPNO ZA PLAĆANJE: ${formatMoney(quote.total ?? 0, cur)}`,
    );
  } else {
    parts.push(
      'DOSTAVA ZA CIJELI PAKET: ________ KM (kilaža nije unesena — napiši prazninu, nikad iznos)',
      `UKUPNO ZA PLAĆANJE: ${formatMoney(quote.subtotalAfterDiscount, cur)} + ________ KM (dostava)`,
    );
  }
  parts.push(
    'Nikad ne piši dostavu pojedinačno za svaki proizvod. Ukupan iznos piši uvijek, jer kupac plaća sve zajedno. Pojedinačnu dostavu navodi samo ako kupac izričito traži dostavu za svaki proizvod posebno.',
  );
  return parts.join('\n');
}

/** Deterministički završetak poruke — ne zavisi od modela. */
export function packageTotalsText(quote: PackageQuote): string {
  const cur = quote.currency;
  const rows = quote.lines.map((line) => `• ${packageLineText(line, cur)}`);
  const tail: string[] = [];
  if (quote.lines.length > 1) tail.push('', 'Ukupno za sve proizvode:');
  tail.push(...rows);
  tail.push('', `Proizvodi ukupno: ${formatMoney(quote.subtotal, cur)}`);
  if (quote.discountAmount > 0) {
    tail.push(
      `Popust (${quote.discountLabels.join(', ')}): -${formatMoney(quote.discountAmount, cur)}`,
      `Nakon popusta: ${formatMoney(quote.subtotalAfterDiscount, cur)}`,
    );
  }
  if (quote.deliveryAmount !== null) {
    tail.push(
      `Dostava za cijeli paket: ${formatMoney(quote.deliveryAmount, cur)}`,
      `UKUPNO ZA PLAĆANJE: ${formatMoney(quote.total ?? 0, cur)}`,
    );
  } else {
    tail.push('Dostava za cijeli paket: ________ KM', `UKUPNO ZA PLAĆANJE: ${formatMoney(quote.subtotalAfterDiscount, cur)} + ________ KM`);
  }
  return tail.join('\n');
}

/** Da li poruka već sadrži ukupan iznos (bilo koji oblik)? */
export function hasPackageTotal(text: string): boolean {
  return /ukupno\s+za\s+pla[ćc]anje|ukupan\s+iznos|sve\s+ukupno|ukupno\s*[::]\s*\d/i.test(text);
}


/**
 * Model ponekad prepiše cijeli paketni blok iz prompta i doda svoj sažetak,
 * pa kupac dobije dva puta iste stavke. Ovim se zadržava prvi blok, a drugi
 * (do zadnjeg „UKUPNO ZA PLAĆANJE” reda) uklanja.
 */
export function collapseDuplicatePackageTotals(text: string): string {
  const rows = text.split(/\n/u);
  const starts = rows
    .map((row, index) => (/^ukupno za sve proizvode/iu.test(row.trim()) ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length < 2) return text;
  const lastTotal = rows.map((row) => /ukupno za plaćanje/iu.test(row)).lastIndexOf(true);
  if (lastTotal <= (starts[1] ?? 0)) return text;
  rows.splice(starts[1] ?? 0, lastTotal - (starts[1] ?? 0) + 1);
  return rows.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}
