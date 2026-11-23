import type { Product, ProductAdditionalData } from '@/lib/domain/types';
import { formatMoney } from '@/lib/domain/money';
import { isAvailable } from '@/lib/domain/productVariants';
import { hasPackageTotal, packageTotalsText, type PackageQuote } from '@/lib/domain/packageQuote';

/**
 * Deterministic gate for every customer-facing reply.
 *
 * A small model can drift even with a long rule list, so the rules that matter
 * are checked in code after generation. Only when a check fails do we spend one
 * extra model call to repair; if it still fails, a safe, template-built message
 * is used that cannot contain invented data.
 */
export interface ReplyGuardContext {
  products: { product: Product; additional: ProductAdditionalData | null }[];
  /** Other in-stock sizes of the same model (R21). */
  /** Boje koje su stvarno na stanju u ovom modelu. */
  colorOptions?: { label: string }[];
  /** Sesija je potvrđena kao narudžba — poruka mora imati zahvalu i poštarinu. */
  orderConfirmed?: boolean;
  /** Važeći pragovi popusta na količinu iz Postavki (R28). */
  quantityDiscounts?: { minQuantity: number; percent: number }[];
  /** Potpuna ponuda koju je kupac tražio („koje grebalice imate”). */
  offerList?: { name: string; price: string; amount?: number | null; note: string | null }[];
  /** Link kategorije na giga.ba — obavezan dio odgovora na „šta sve imate”. */
  offerLink?: string | null;
  offerLinkLine?: string | null;
  offerCategory?: string | null;
  dimensionOptions?: {
    productId: string;
    options: {
      sizeKey: string;
      label: string;
      available: boolean;
      price: number | null;
      currency: string;
      delivery?: { amount: number; currency: string } | null;
    }[];
  }[];
  customerMessage: string;
  /** Delivery tier amounts that are real configuration, not invention. */
  deliveryAmounts?: number[];
  /** Delivery price computed from the product's weight (R22 step 2). */
  deliveryAmount?: { amount: number; currency: string } | null;
  /** R30: obračun cijelog paketa (više proizvoda = jedna dostava). */
  packageQuote?: PackageQuote | null;
  /** Real specifications from catalogue + agent data, for R22 step 1. */
  specPairs?: { label: string; value: string }[];
}

export interface ReplyGuardIssue {
  code: string;
  /** Added to the repair prompt. */
  hint: string;
  /** Shown to the agent in the warning. */
  message: string;
}

const WEIGHT_STATEMENT = /(te[žz]in\w*|kila[žz]\w*)[^.!?\n]{0,120}(nije\s+unes|nijesu\s+unes|nemamo|provjer)/i;
const DIMENSION_STATEMENT = /(dimenzij\w*)[^.!?\n]{0,120}(nije|nijesu|nemamo|provjer)/i;
const DENIAL = /nemamo|ne\s+(imamo|posjedujemo)|nema(mo)?\s+u\s+ponudi|trenutno\s+(ga\s+)?nemamo/i;
const FIRST_PERSON = /\b(ja|mene|meni|moj|moja|moje|mogao\s+sam|poslao\s+sam)\b/i;
const FREE_SHIPPING = /besplatn\w*\s+(dostav|isporuk)|(dostav|isporuk)\w*\s+(je\s+)?besplatn/i;
const SHIPPING_PROMISE = /(?:za|u\s+roku\s+od)\s+\d+\s*(?:dan|dana|radnih)/i;
const SOURCE_LEAK = /(izvor|provjereno\s+\d{1,2}\.\d{1,2}\.\d{4}|https?:\/\/|giga\.ba\/)/i;
// "zalihe" alone is allowed because R19 requires the phrase "do isteka zaliha".
// R22 requires telling the customer we have it, so "na stanju" is allowed;
// only the internal warehouse picture must never leak.
const WAREHOUSE_LEAK = /(skladi[šs]t|na\s+lageru|lager|magacin)/i;
const STOCK_UNTIL_GONE = /do\s+isteka\s+zaliha|dok\s+traju\s+zalihe|dok\s+ima\s+na\s+stanju/i;
const ASKS_ACTION =
  /(do\s+kada|dokad|koliko\s+(dugo\s+)?traje|dok\s+traje|traje\s+(ta\s+)?akcij|kada\s+(zavrsava|završava|prestaje|istjece|istječe))/i;
// R20: asking whether a price is correct must produce the exact amount again,
// never a bare "da, to je ta cijena".
const ASKS_PRICE_CONFIRM =
  /(jel+|je\s+li|da\s+li\s+je)\s+(to|ovo|ov[ao])?\s*(ta|to[cč]na|tacna)?\s*cijena|(jel+|je\s+li)\s+to\s+ta[cč]no|cijena\s+je\s+ta[cč]na|potvrdite?\s+cijenu|ta[cč]na\s+cijena/i;
// Agent još nije unio težinu: u poruci ostaje praznina za ručni upis iznosa.
const DELIVERY_BLANK = /(?:dostava|po[šs]tarina)\s*:?\s*[_….]{2,}\s*KM/i;
// Bilo koja napomena o dostavi (iznos, praznina ili „ne možemo izračunati”).
const DELIVERY_MENTIONED = /dostav[aei]\b/i;
const MONEY_IN_TEXT = /\d[\d.\s]*(?:[.,]\d{1,2})?\s*(?:KM|BAM)/i;
// R27: popust na količinu nije objavljen nigdje na sajtu — ne smije se izmisliti.
const QUANTITY_DISCOUNT =
  /(\d+\s*komada|kolicin\w*|količin\w*|dva\s+komada|drugi\s+komad)[^.\n]{0,60}\d{1,2}\s*%|\d{1,2}\s*%\s*(popusta\s+)?(na|za)\s+kolicin\w*|\d{1,2}\s*%\s*(popusta\s+)?(na|za)\s+količin\w*/i;
// R24: kupcu se nikad ne objašnjava da težina nedostaje — samo praznina.
const WEIGHT_DISCLOSURE =
  /(te[žz]in\w*|kila[žz]\w*)[^.!?\n]{0,80}(nije\s+unes|nijesu\s+unes|nemamo|nedostaje|nepoznat)|(ne\s+mo[žz]emo\s+(izračunati|izracunati)|ne\s+znamo\s+(cijenu\s+)?dostav|dostav\w*\s+(ćemo|cemo)\s+(vam\s+)?javiti|iznos\s+dostave\s+će(te|mo))/i;
// R26: rečenica koja tvrdi da imamo nešto (za proizvode koji nisu na stanju).
const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9čćžšđ ]/gi, '');
const CLAIM_HAVE = /(imamo|dostupn|na\s+stanju|mo[žz]ete\s+naru[čc]iti)/i;
// R21: several sizes exist and the customer did not name one.
const NAMES_A_SIZE = /\b\d{2,3}\s*[x×]\s*\d{2,3}\b/i;
const ASKS_SIZE = /(koju\s+dimenzij|koja\s+dimenzij|koju\s+veli[čc]in|koju\s+od\s+ovih|koju\s+dimenziju)/i;
const ASKS_DIMENSIONS = /(dimenzij|visin|[šs]irin|du[žz]in|\d+\s*cm|staje|mjera|prolaz|vrata)/i;
// R22: the mandatory sales cycle.
const ASKS_DETAILS = /(koje\s+boje|boja|materijal|detalj|specifikacij|karakteristik|sastav|kvalitet)/i;
const ETA = /2\s*[–-]\s*5\s*radnih\s*dana|2\s*do\s*5\s*radnih\s*dana/i;
const THANKS = /(hvala|zahvaljuj|zahvalni)/i;
const WANTS_ORDER = /(naru[čc]|narud[žz]b|kupujem|uzimam|po[šs]alji|dostavite)/i;

function moneyNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:KM|BAM|km\b)/gi;
  for (const match of text.matchAll(re)) {
    const raw = match[1]!.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const value = Number(raw);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

export function checkCustomerReply(body: string, ctx: ReplyGuardContext): ReplyGuardIssue[] {
  const issues: ReplyGuardIssue[] = [];
  const text = body.trim();
  if (!text) return issues;
  const products = ctx.products;

  const missingWeight = ctx.products.filter(
    ({ additional }) => typeof additional?.weightKg !== 'number' || (additional?.weightKg ?? 0) <= 0,
  );
  const missingDims = ctx.products.filter(({ additional }) => !additional?.dimensionsCm);

  if (ctx.products.length && DENIAL.test(text)) {
    issues.push({
      code: 'catalogue_denied',
      hint: 'Katalog ima traženi proizvod — NE smiješ reći da ga nemamo. Navedi naziv i cijenu iz podataka.',
      message: 'Model je rekao da proizvoda nema, a katalog ga ima.',
    });
  }

  if (missingWeight.length && !WEIGHT_STATEMENT.test(text) && !DELIVERY_BLANK.test(text)) {
    issues.push({
      code: 'missing_weight_not_stated',
      hint: 'Uz cijenu napiši i dostavu. Težina nije unesena, pa ostavi prazninu: „dostava: ________ KM”.',
      message: 'Uz cijenu nije navedena dostava, a težina nije unesena (ostavi „dostava: ________ KM”).',
    });
  }

  if (missingDims.length && ASKS_DIMENSIONS.test(ctx.customerMessage) && !DIMENSION_STATEMENT.test(text)) {
    issues.push({
      code: 'missing_dimensions_not_stated',
      hint: 'Kupac pita za dimenzije: napiši da dimenzije nijesu unesene u naš sistem i da ćemo ih provjeriti.',
      message: 'Nije navedeno da dimenzije nijesu unesene u sistem.',
    });
  }

  // Prices may only repeat real catalogue prices or configured delivery amounts.
  const allowedPrices = new Set<number>();
  for (const { product } of ctx.products) {
    if (typeof product.price === 'number') {
      allowedPrices.add(product.price);
      allowedPrices.add(Math.round(product.price * 100) / 100);
    }
  }
  // Cijene cijele ponude („koje grebalice imate”) su takođe iz kataloga.
  for (const item of ctx.offerList ?? []) {
    if (typeof item.amount === 'number') allowedPrices.add(item.amount);
  }
  for (const amount of ctx.deliveryAmounts ?? []) allowedPrices.add(amount);
  // Prices of the other sizes are catalogue prices too: they must never be
  // reported as invented.
  for (const group of ctx.dimensionOptions ?? []) {
    for (const option of group.options) {
      if (option.price !== null) allowedPrices.add(option.price);
      if (option.delivery) allowedPrices.add(option.delivery.amount);
    }
  }
  if (ctx.deliveryAmount) allowedPrices.add(ctx.deliveryAmount.amount);
  // Iznosi paketa su izračunati kalkulatorom — nisu izmišljeni.
  if (ctx.packageQuote) {
    const quote = ctx.packageQuote;
    for (const line of quote.lines) {
      allowedPrices.add(line.unitPrice);
      allowedPrices.add(line.lineTotal);
    }
    for (const amount of [quote.subtotal, quote.discountAmount, quote.subtotalAfterDiscount, quote.total]) {
      if (typeof amount === 'number') allowedPrices.add(amount);
    }
    if (quote.deliveryAmount !== null) allowedPrices.add(quote.deliveryAmount);
  }

  const invented = moneyNumbers(text).filter(
    (value) => ![...allowedPrices].some((allowed) => Math.abs(allowed - value) < 0.01),
  );
  if (invented.length) {
    issues.push({
      code: 'invented_price',
      hint: `Iznosi ${invented.join(', ')} ne postoje u podacima. Koristi isključivo cijene iz kataloga (${[
        ...allowedPrices,
      ].join(', ') || 'nema cijena'}).`,
      message: `Model je naveo iznos koji nije u podacima: ${invented.join(', ')}.`,
    });
  }

  if (missingWeight.length && moneyNumbers(text).some((value) => (ctx.deliveryAmounts ?? []).includes(value))) {
    issues.push({
      code: 'delivery_price_without_weight',
      hint: 'Bez unesene težine NE smiješ navesti cijenu dostave. Napiši da ćemo provjeriti tačan iznos.',
      message: 'Navedena je cijena dostave iako težina nije unesena.',
    });
  }

  if (FIRST_PERSON.test(text)) {
    issues.push({
      code: 'first_person_singular',
      hint: 'Firma govori u množini („možemo“, „imamo“). Nikad „ja“, „meni“, „moj“.',
      message: 'Poruka govori u prvom licu jednine umjesto u ime firme.',
    });
  }

  if (FREE_SHIPPING.test(text)) {
    issues.push({
      code: 'free_shipping',
      hint: 'Nikada ne tvrdi da je dostava besplatna — dostava se računa po težini.',
      message: 'Model je naveo besplatnu dostavu.',
    });
  }

  if (SHIPPING_PROMISE.test(text)) {
    issues.push({
      code: 'shipping_promise',
      hint: 'Ne obećavaj rok dostave ako nije u provjerenoj proceduri. Reci da ćemo provjeriti.',
      message: 'Model je obećao rok dostave bez potvrđenog podatka.',
    });
  }

  // Link na kategoriju giga.ba je dio odgovora na „šta sve imate”, pa se prije
  // provjere izvora uklanja — sve ostalo (npr. link na proizvod) ostaje zabrana.
  const textForSourceCheck = text.replace(/https?:\/\/giga\.ba\/collections\/[\w-]+/gi, '');
  if (SOURCE_LEAK.test(textForSourceCheck)) {
    issues.push({
      code: 'source_leak',
      hint: 'U poruci kupcu ne smije biti izvora, linkova ni datuma provjere.',
      message: 'U poruci kupcu se nalazi izvor, link ili datum provjere.',
    });
  }

  // R21: when the same model exists in several available sizes, ask which one.
  if (!NAMES_A_SIZE.test(ctx.customerMessage)) {
    for (const group of ctx.dimensionOptions ?? []) {
      const available = group.options.filter((option) => option.available);
      if (!available.length) continue;
      const normalized = text.replace(/[\s.]/g, '').replace(/[x×]/g, 'x').toLowerCase();
      const mentioned = available.filter((option) => normalized.includes(option.sizeKey)).length;
      if (!ASKS_SIZE.test(text) || mentioned < available.length) {
        issues.push({
          code: 'dimension_choice_missing',
          hint: `Pitaj koju dimenziju želi i navedi dostupne: ${available
            .map((option) => option.label)
            .join(', ')} — svaku sa njenom cijenom.`,
          message: 'Model ima više dostupnih dimenzija, a odgovor ne pita koju kupac želi.',
        });
        break;
      }
    }
  }

  // R21 (part 2): every available size must come with its own price and its own
  // weight-based delivery price — the customer must not have to ask for it.
  for (const group of ctx.dimensionOptions ?? []) {
    const available = group.options.filter((option) => option.available);
    if (available.length < 2) continue;
    const amounts = moneyNumbers(text);
    const missing = available.filter((option) => {
      if (option.price === null) return false;
      const hasPrice = amounts.some((value) => Math.abs(value - option.price!) < 0.01);
      if (!hasPrice) return true;
      if (option.delivery && typeof option.delivery.amount === 'number') {
        return !amounts.some((value) => Math.abs(value - option.delivery!.amount) < 0.01);
      }
      // Težina te dimenzije nije unesena: u redu je praznina „dostava: ____ KM”
      // koju agent dopuni, ili izričita rečenica da dostavu ne možemo izračunati.
      return !DELIVERY_BLANK.test(text) && !WEIGHT_STATEMENT.test(text) && !/ne mo[žz]emo izra[čc]unati/i.test(text);
    });
    if (missing.length) {
      issues.push({
        code: 'dimension_offer_incomplete',
        hint: `Navedi svaku dimenziju sa njenom cijenom i cijenom dostave: ${available
          .map(
            (option) =>
              `${option.label} — ${option.price !== null ? formatMoney(option.price, option.currency) : 'cijena nije poznata'}, ${
                option.delivery
                  ? `dostava ${formatMoney(option.delivery.amount, option.delivery.currency)}`
                  : 'dostava: ________ KM (težina nije unesena — ostavi prazninu)'
              }`,
          )
          .join('; ')}.`,
        message: 'Ponuda više dimenzija nema cijenu i dostavu za svaku dimenziju (R21).',
      });
      break;
    }
  }

  // R21 (part 3): sve dostupne boje moraju biti navedene. Ako model postoji u
  // dvije boje, kupac mora vidjeti obje — inače misli da imamo samo jednu.
  const availableColors = (ctx.colorOptions ?? []).filter((color) => color.label.trim().length > 1);
  if (availableColors.length >= 2) {
    const normalized = text.toLowerCase();
    const missingColors = availableColors.filter(
      (color) => !new RegExp(`(^|[^\p{L}])${color.label.toLowerCase()}([^\p{L}]|$)`, 'u').test(normalized),
    );
    if (missingColors.length) {
      issues.push({
        code: 'color_options_missing',
        hint: `Navedi sve boje koje su na stanju: ${availableColors.map((color) => color.label).join(', ')}.`,
        message: 'Odgovor ne navodi sve dostupne boje (R21).',
      });
    }
  }

  // R24: nikad ne objašnjavaj kupcu da težina nedostaje ili da dostava nije poznata.
  if (WEIGHT_DISCLOSURE.test(text)) {
    issues.push({
      code: 'weight_disclosed_to_customer',
      hint: 'Obriši svaku rečenicu o težini i o tome da dostava nije poznata. Ostavi samo „dostava: ________ KM” uz cijenu.',
      message: 'Kupcu se ne smije pisati da težina/dostava nedostaje — samo praznina.',
    });
  }

  // R28: procenat smije biti samo onaj koji je vlasnik podesio u Postavkama.
  // R26 + potpunost: kad je kupac pitao šta imamo, svaka stavka iz ponude
  // mora biti u odgovoru. Preskočena stavka = kupcu se nudi manje nego što ima.
  if (ctx.offerLink) {
    // Kupcu je dovoljan link na kategoriju; ali bez linka nema potpune ponude.
    if (!text.includes(ctx.offerLink)) {
      issues.push({
        code: 'offer_link_missing',
        hint: `Dodaj link na kategoriju${ctx.offerCategory ? ` „${ctx.offerCategory}”` : ''}: ${ctx.offerLink} i zamoli kupca da izabere model koji mu se sviđa.`,
        message: 'Nedostaje link na cijelu ponudu (kategoriju) sa giga.ba.',
      });
    }
  } else if (ctx.offerList?.length) {
    const flat = normalize(text);
    const missing = ctx.offerList.filter((item) => {
      const brand = item.name.split(' ')[0]?.toLowerCase() ?? '';
      const size = /(\d+[.,]?\d*)\s*[x×]\s*(\d+)/u.exec(item.name.toLowerCase());
      if (!brand || !flat.includes(brand)) return true;
      if (!size) return false;
      const wanted = `${size[1]}x${size[2]}`.replace(/[^0-9x]/g, '');
      return !flat.replace(/[^a-z0-9x]/g, '').includes(wanted);
    });
    if (missing.length) {
      issues.push({
        code: 'offer_list_incomplete',
        hint: `Navedi SVE stavke iz ponude, i ove koje si preskočio: ${missing.map((item) => item.name).join('; ')}.`,
        message: `U ponudi nedostaje ${missing.length} stavki koje su na stanju.`,
      });
    }
  }

  const allowedPercents = new Set((ctx.quantityDiscounts ?? []).map((tier) => Number(tier.percent)));
  const inventedQuantityPercent = QUANTITY_DISCOUNT.test(text)
    ? (text.match(/(\d{1,2})\s*%/g) ?? []).some((token) => !allowedPercents.has(Number(token.replace(/[^\d]/g, ''))))
    : false;
  if (inventedQuantityPercent) {
    issues.push({
      code: 'quantity_discount_invented',
      hint: 'Obriši procenat popusta na količinu. Napiši da ćemo provjeriti i javiti tačan iznos za tu količinu.',
      message: 'Popust na količinu nije objavljen na sajtu — procenat se ne smije izmisliti.',
    });
  }

  // R26: proizvod koji nije na stanju ne smije se predstaviti kao da ga imamo.
  const unavailableNames = ctx.products
    .filter(({ product }) => !isAvailable(product))
    .map(({ product }) => product.name);
  const offeredUnavailable = unavailableNames.filter(
    (name) => normalize(text).includes(normalize(name)) && CLAIM_HAVE.test(text),
  );
  if (offeredUnavailable.length) {
    issues.push({
      code: 'unavailable_product_offered',
      hint: 'Ukloni proizvode koji nisu na stanju iz ponude. Navedi samo ono što je na stanju; za ostalo reci da trenutno nije dostupno.',
      message: `Poruka nudi proizvod koji nije na stanju: ${offeredUnavailable.join(', ')}.`,
    });
  }

  // R23: potvrda narudžbe = zahvala + iznos poštarine (ili praznina „____ KM”).
  if (ctx.orderConfirmed) {
    if (!THANKS.test(text)) {
      issues.push({
        code: 'order_thanks_missing',
        hint: 'Zahvali kupcu na narudžbi (npr. „Hvala Vam na narudžbi!”).',
        message: 'U potvrdi narudžbe nedostaje zahvala kupcu.',
      });
    }
    const hasDeliveryAmount =
      ctx.deliveryAmount !== null &&
      ctx.deliveryAmount !== undefined &&
      moneyNumbers(text).some((value) => Math.abs(value - ctx.deliveryAmount!.amount) < 0.01);
    if (!hasDeliveryAmount && !DELIVERY_BLANK.test(text)) {
      issues.push({
        code: 'order_delivery_missing',
        hint: ctx.deliveryAmount
          ? `Napiši cijenu poštarine: ${formatMoney(ctx.deliveryAmount.amount, ctx.deliveryAmount.currency)}.`
          : 'Težina nije unesena: napiši „Poštarina: ________ KM” (praznina za ručni upis).',
        message: 'U potvrdi narudžbe nedostaje iznos poštarine.',
      });
    }
  }

  // ---- R22: obavezni prodajni ciklus -------------------------------------
  const mentionsMoney = MONEY_IN_TEXT.test(text);
  if (ctx.deliveryAmount && mentionsMoney && products.length) {
    const delivery = ctx.deliveryAmount;
    if (!moneyNumbers(text).some((value) => Math.abs(value - delivery.amount) < 0.01)) {
      issues.push({
        code: 'delivery_price_missing',
        hint: `Dodaj tačnu cijenu dostave po težini: ${formatMoney(delivery.amount, delivery.currency)}.`,
        message: 'Ponuda nema cijenu dostave (R22, korak 2).',
      });
    }
  }

  const asksForOrderData = (text.match(/ime|telefon|adres|grad|po[šs]tansk/gi) ?? []).length >= 3;
  const atOrderStage = Boolean(ctx.deliveryAmount) || WANTS_ORDER.test(ctx.customerMessage);
  if (products.length && atOrderStage && !asksForOrderData) {
    issues.push({
      code: 'order_data_missing',
      hint: 'Zatraži podatke za narudžbu: ime i prezime, telefon, adresa, grad i poštanski broj.',
      message: 'Nedostaje traženje podataka za GigaHub narudžbu (R22, korak 3).',
    });
  }
  if (asksForOrderData && !ETA.test(text)) {
    issues.push({
      code: 'delivery_eta_missing',
      hint: 'Napiši da dostava dolazi za 2–5 radnih dana.',
      message: 'Nedostaje rok dostave 2–5 radnih dana (R22, korak 4).',
    });
  }
  if (ASKS_DETAILS.test(ctx.customerMessage) && (ctx.specPairs ?? []).length && products.length) {
    const lower = text.toLowerCase();
    const shared = (ctx.specPairs ?? []).some(
      (pair) => pair.value.length >= 3 && lower.includes(pair.value.toLowerCase().slice(0, 24)),
    );
    if (!shared) {
      const sample = (ctx.specPairs ?? [])
        .slice(0, 4)
        .map((pair) => `${pair.label}: ${pair.value}`)
        .join('; ');
      issues.push({
        code: 'specs_not_shared',
        hint: `Navedi specifikacije koje imamo: ${sample}.`,
        message: 'Kupac pita za detalje, a odgovor ne navodi specifikacije iz sistema (R22, korak 1).',
      });
    }
  }

  // R20: a price question gets the number repeated, not just "yes".
  if (ASKS_PRICE_CONFIRM.test(ctx.customerMessage)) {
    const askedPrice = ctx.products.find(({ product }) => typeof product.price === 'number');
    if (askedPrice && !MONEY_IN_TEXT.test(text)) {
      issues.push({
        code: 'price_confirmation_missing',
        hint: 'Ponovi tačan iznos, npr. „Da, cijena za <naziv> je <iznos> KM.” Nikad samo „da, to je ta cijena”. Dodaj i cijenu dostave ili napomenu da se ne može izračunati bez težine.',
        message: 'Kupac pita da li je cijena tačna, a odgovor ne sadrži iznos.',
      });
    }
  }

  // R25: rečenica o trajanju akcije ide SAMO kad kupac pita dokad traje.
  if (ASKS_ACTION.test(ctx.customerMessage) && !STOCK_UNTIL_GONE.test(text)) {
    issues.push({
      code: 'action_duration_not_stated',
      hint: 'Napiši tačno: „Akcija traje do isteka zaliha.” Nikada ne navodi datum, broj dana ni „još kratko”.',
      message: 'Nedostaje pravilo da akcija traje do isteka zaliha.',
    });
  }

  if (WAREHOUSE_LEAK.test(text)) {
    issues.push({
      code: 'warehouse_leak',
      hint: 'Ne spominji skladište, zalihe ni lager. Dostupnost opiši kao „dostupno“ ili „trenutno nije dostupno“.',
      message: 'Model je spomenuo skladište/zalihe.',
    });
  }

  // R30: kod više proizvoda kupac plaća JEDAN paket — poruka mora imati ukupan
  // iznos svih proizvoda i jednu dostavu za cijeli paket.
  const quote = ctx.packageQuote;
  if (quote && (quote.lines.length > 1 || quote.lines.some((line) => line.quantity > 1)) && !hasPackageTotal(text)) {
    issues.push({
      code: 'package_total_missing',
      hint: 'Napiši ukupan iznos za sve proizvode zajedno i jednu dostavu za cijeli paket (npr. „Proizvodi ukupno: X KM”, „Dostava za cijeli paket: Y KM”, „UKUPNO ZA PLAĆANJE: Z KM”). Nikad dostavu po proizvodu.',
      message: 'Nedostaje ukupan iznos i ukupna dostava za narudžbu od više proizvoda (R30).',
    });
  }
  // R30: dostava je jedna za cijeli paket. Ako se u poruci pojavljuje vise
  // puta (po proizvodu), poruka se popravlja ili se koristi sigurna poruka.
  if (quote) {
    // Broje se samo CJENOVNE dostave (uz KM); obična rečenica o roku dostave nije greška.
    const pricedDeliveries = (text.match(/dostav[a-zčćžšđ]*[^.!?\n]{0,30}KM/giu) ?? []).length;
    if (pricedDeliveries > 1) {
      issues.push({
        code: 'package_delivery_split',
        hint: 'Dostavu napiši SAMO JEDNOM, za cijeli paket. Nikad po proizvodu i nikad uz svaku cijenu.',
        message: 'Dostava je navedena više puta — kod paketa se piše jedna dostava za sve (R30).',
      });
    }
  }

  return issues;
}

const WEIGHT_SENTENCE =
  'Težina za ovaj proizvod nije unesena u naš sistem, pa dostavu ne možemo izračunati — provjerit ćemo i javiti Vam tačan iznos.';

/**
 * Fixes that need no model call: the approved sentences are appended to an
 * otherwise good reply instead of throwing the whole text away.
 */
export function applyDeterministicFixes(
  body: string,
  ctx: ReplyGuardContext,
  issues: ReplyGuardIssue[],
): string {
  let text = body.trim();
  const codes = new Set(issues.map((issue) => issue.code));

  // R29 — gramatika koju model cesto pokvari: "ime, prezimenom" nije bosanski.
  text = text
    .replace(/\bime\s*[,/]?\s*prezimenom\b/giu, 'ime i prezime')
    .replace(/\bime\s+i\s+prezimenom\b/giu, 'ime i prezime')
    .replace(/\bprezimenom\b/giu, 'prezime')
    .replace(/\bprezimeom\b/giu, 'prezime')
    .replace(/\bime\s+i\s+prezime\s+i\s+prezime\b/giu, 'ime i prezime');

  if (codes.has('missing_weight_not_stated') && !WEIGHT_STATEMENT.test(text) && !DELIVERY_BLANK.test(text)) {
    text = `${text}

Dostava: ________ KM (težina nije unesena u sistem — dopunite iznos)`;
  }
  if (codes.has('package_total_missing') && ctx.packageQuote) {
    text = `${text.replace(/\s+$/, '')}` + '\n\n' + packageTotalsText(ctx.packageQuote);
  }
  if (ctx.packageQuote && (codes.has('package_delivery_split') || codes.has('package_total_missing'))) {
    // Kod paketa se svaka pojedinacna dostava uklanja; ostaje jedna, za cijeli paket.
    const keepLine = (line: string) =>
      !/dostav/i.test(line) || /ukupno|paket|rok|dana|radnih/i.test(line);
    text = text
      .split(/\n/u)
      .filter(keepLine)
      .join('\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
    // Cijena proizvoda i dalje mora ostati u poruci — ako je linija nestala,
    // paketni blok je vraća zajedno sa ukupnim iznosom.
    if (!hasPackageTotal(text)) {
      text = `${text}\n\n${packageTotalsText(ctx.packageQuote)}`;
    }
  }

  if (codes.has('offer_link_missing') && ctx.offerLink) {
    const line = ctx.offerLinkLine ?? `Sve modele možete pogledati ovdje: ${ctx.offerLink}`;
    text = `${text.replace(/\s+$/, '')}` + '\n\n' + line + '\nRecite nam koji model Vam se sviđa i za njega Vam šaljem tačnu cijenu i dostavu.';
  }
  if (codes.has('offer_list_incomplete') && ctx.offerList?.length) {
    const flat = normalize(text);
    const missing = ctx.offerList.filter((item) => {
      const brand = item.name.split(' ')[0]?.toLowerCase() ?? '';
      const size = /(\d+[.,]?\d*)\s*[x×]\s*(\d+)/u.exec(item.name.toLowerCase());
      if (!brand || !flat.includes(brand)) return true;
      if (!size) return false;
      const wanted = `${size[1]}x${size[2]}`.replace(/[^0-9x]/g, '');
      return !flat.replace(/[^a-z0-9x]/g, '').includes(wanted);
    });
    if (missing.length) {
      const extra = missing
        .map((item) => `• ${item.name} — ${item.price} (dostava: ________ KM)`)
        .join('\n');
      text = `${text}

${extra}`;
    }
  }
  if (codes.has('action_duration_not_stated') && !STOCK_UNTIL_GONE.test(text)) {
    text = `${text}

Akcija traje do isteka zaliha.`;
  }
  if (codes.has('delivery_price_missing') && ctx.deliveryAmount) {
    text = `${text}\
\
Dostava za ovaj proizvod iznosi ${formatMoney(ctx.deliveryAmount.amount, ctx.deliveryAmount.currency)}.`;
  }
  if (codes.has('order_data_missing')) {
    text = `${text}\
\
Da bismo poslali narudžbu, potrebni su nam: ime i prezime, telefon, adresa, grad i poštanski broj.`;
  }
  if (codes.has('delivery_eta_missing') && !ETA.test(text)) {
    text = `${text}\
\
Dostava dolazi za 2–5 radnih dana.`;
  }
  if (codes.has('specs_not_shared')) {
    const pairs = (ctx.specPairs ?? []).slice(0, 4);
    if (pairs.length) {
      text = `${text}\
\
${pairs.map((pair) => `${pair.label}: ${pair.value}`).join('\n')}`;
    }
  }
  if (codes.has('quantity_discount_invented')) {
    text = text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !QUANTITY_DISCOUNT.test(sentence))
      .join(' ')
      .replace(/\n{3,}/g, '\n')
      .trim();
  }
  if (codes.has('weight_disclosed_to_customer')) {
    // R24: izbaci rečenice o težini/dostavi koje ne smiju ići kupcu.
    text = text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !WEIGHT_DISCLOSURE.test(sentence))
      .join(' ')
      .replace(/\n{3,}/g, '\n')
      .trim();
  }
  if (codes.has('unavailable_product_offered')) {
    // R26: redovi s proizvodom koji nije na stanju se uklanjaju iz ponude.
    const names = ctx.products.filter(({ product }) => !isAvailable(product)).map(({ product }) => product.name);
    const rows = text.split('\n');
    const kept = rows.filter((row) => {
      const stripped = row.trim();
      if (!stripped) return true;
      return !names.some((name) => normalize(stripped).includes(normalize(name)));
    });
    text = kept.join('\n').replace(/\n{3,}/g, '\n').trim();
  }
  if (codes.has('order_thanks_missing')) {
    if (!text.includes('Hvala')) text = `Hvala Vam na narudžbi!

${text}`;
  }
  if (codes.has('order_delivery_missing')) {
    const line = ctx.deliveryAmount
      ? `Poštarina iznosi ${formatMoney(ctx.deliveryAmount.amount, ctx.deliveryAmount.currency)}.`
      : 'Poštarina: ________ KM';
    if (!DELIVERY_BLANK.test(text)) text = `${text}

${line}`;
  }
  if (codes.has('color_options_missing')) {
    const colors = (ctx.colorOptions ?? []).map((color) => color.label).filter(Boolean);
    if (colors.length) text = `${text}

Dostupne boje: ${colors.join(', ')}.`;
  }
  if (codes.has('dimension_offer_incomplete')) {
    const group = (ctx.dimensionOptions ?? []).find(
      (entry) => entry.options.filter((option) => option.available).length >= 2,
    );
    if (group) {
      const rows = group.options
        .filter((option) => option.available)
        .map(
          (option) =>
            `- ${option.label}: ${option.price !== null ? formatMoney(option.price, option.currency) : 'cijena nije poznata'}, ${
              option.delivery
                ? `dostava ${formatMoney(option.delivery.amount, option.delivery.currency)}`
                : 'dostava: ________ KM'
            }`,
        );
      text = `${text}\
\
${rows.join('\n')}`;
    }
  }
  if (codes.has('dimension_choice_missing')) {
    const group = (ctx.dimensionOptions ?? []).find((entry) => entry.options.some((option) => option.available));
    if (group) {
      const available = group.options.filter((option) => option.available);
      const sizes = available
        .map((option) => `${option.label}${option.price !== null ? ` (${formatMoney(option.price, option.currency)})` : ''}`)
        .join(', ');
      const compact = text.replace(/[\s.]/g, '').replace(/[x×]/g, 'x').toLowerCase();
      const allListed = available.every((option) => compact.includes(option.sizeKey));
      // Never repeat a question the reply already asks: only add what is missing.
      if (!allListed) text = `${text}

Da li ste mislili na dimenziju ${sizes}?`;
      if (!ASKS_SIZE.test(text)) text = `${text}

Koju dimenziju želite?`;
    }
  }
  return text;
}

/** Cannot invent anything: it only repeats product names and catalogue prices. */
export function buildSafeReply(ctx: ReplyGuardContext): string {
  if (!ctx.products.length) {
    return 'Poštovani,\\n\\nhvala Vam na javljanju. Provjerit ćemo tražene podatke i javit ćemo Vam se sa tačnim informacijama.';
  }
  const sizes = (ctx.dimensionOptions ?? []).find(
    (group) => group.options.filter((option) => option.available).length >= 2,
  );
  const missingWeight = ctx.products.some(
    ({ additional }) => typeof additional?.weightKg !== 'number' || (additional?.weightKg ?? 0) <= 0,
  );
  const actionLine = ASKS_ACTION.test(ctx.customerMessage) ? ['Akcija traje do isteka zaliha.', ''] : [];
  const specLine = (() => {
    const seen = new Set<string>();
    const pairs = (ctx.specPairs ?? []).filter((pair) => {
      const key = `${pair.label}: ${pair.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const line = pairs
      .slice(0, 3)
      .map((pair) => `${pair.label}: ${pair.value}`)
      .join(', ');
    return line ? [`${line.replace(/[.\s]+$/, '')}.`, ''] : [];
  })();
  // When the model exists in several sizes, those sizes ARE the offer: each one
  // with its own price and its own weight-based delivery (R21).
  // Kupac je pitao šta imamo: sigurna poruka mora navesti SVE iz ponude, sa
  // cijenom i prazninom za dostavu (R26 + potpunost ponude).
  // Kad postoji kategorija na giga.ba, sigurna poruka upućuje na link — kupac
  // tamo vidi sve, sa slikama, i kaže koji model je mislio.
  const offerBlock = ctx.offerLink
    ? [
        ctx.offerCategory ? `Imamo cijelu kategoriju „${ctx.offerCategory}”.` : 'Imamo cijelu kategoriju na giga.ba.',
        `Sve modele možete pogledati ovdje: ${ctx.offerLink}`,
        '',
        'Recite nam koji model Vam se sviđa i za njega Vam šaljem tačnu cijenu i dostavu.',
        '',
      ]
    : (ctx.offerList ?? []).length
      ? [
          'u ponudi imamo:',
          ...(ctx.offerList ?? []).map((item) => `- ${item.name}: ${item.price}`),
          '',
          'dostava: ________ KM',
          '',
        ]
      : null;
  const sizeBlock = ctx.packageQuote ? [] : offerBlock ?? (sizes
    ? [
        'Imamo ovaj model u više dimenzija:',
        ...sizes.options
          .filter((option) => option.available)
          .map(
            (option) =>
              `- ${option.label} — ${option.price !== null ? formatMoney(option.price, option.currency) : 'cijena nije poznata'}${
                option.available === false ? ' (trenutno nije na stanju)' : ''
              }, ${
                option.delivery
                  ? `dostava ${formatMoney(option.delivery.amount, option.delivery.currency)}`
                  : 'dostava: ________ KM'
              }`,
          ),
        '',
        'Koju dimenziju želite?',
        '',
        ...((ctx.colorOptions ?? []).length
          ? [`Dostupne boje: ${(ctx.colorOptions ?? []).map((color) => color.label).join(', ')}.`, '']
          : []),
      ]
    : [
        'u ponudi imamo:',
        ...ctx.products.map(({ product }) =>
          product.price !== null
            ? `- ${product.name}: ${formatMoney(product.price, product.currency)}`
            : `- ${product.name}`,
        ),
        '',
      ]);

  // R30: kod više proizvoda sigurna poruka uvijek sadrži ukupan iznos i jednu
  // dostavu za cijeli paket — nikad pojedinačno po proizvodu.
  const packageBlock = ctx.packageQuote
    ? [packageTotalsText(ctx.packageQuote), '']
    : null;
  const deliveryLine = packageBlock || offerBlock
    ? []
    : sizes
    ? []
    : [
        missingWeight
          ? 'Dostava: ________ KM'
          : ctx.deliveryAmount
            ? `Dostava iznosi ${formatMoney(ctx.deliveryAmount.amount, ctx.deliveryAmount.currency)}.`
            : '',
        '',
      ];
  const orderStage = Boolean(ctx.deliveryAmount) || WANTS_ORDER.test(ctx.customerMessage);
  const orderLines = orderStage
    ? [
        'Da bismo poslali narudžbu, potrebni su nam: ime i prezime, telefon, adresa, grad i poštanski broj.',
        'Dostava dolazi za 2–5 radnih dana.',
        '',
      ]
    : [];
  const orderHead = ctx.orderConfirmed ? ['Hvala Vam na narudžbi!', ''] : [];
  return [
    'Poštovani,',
    '',
    ...orderHead,
    ...actionLine,
    ...specLine,
    ...sizeBlock,
    ...(packageBlock ?? []),
    ...deliveryLine.filter((line) => line !== undefined),
    ...(ctx.orderConfirmed && !sizes && !packageBlock
      ? ['Poštarina: ________ KM', '']
      : []),
    ...orderLines,
    'Stojimo Vam na raspolaganju.',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');
}

