import 'server-only';
import { randomUUID } from 'node:crypto';
import { ApiError } from '@/lib/api/errors';
import type { AiCitation, AppSettings, CompanyProcedure, CustomerSession, GeneratedReply, Product } from '@/lib/domain/types';
import { messagesForModel, serializeContext } from '@/lib/domain/sessionContext';
import { appendSignature, renderSignature } from '@/lib/domain/signature';
import { formatMoney } from '@/lib/domain/money';
import type { Store } from '@/lib/store/types';
import { sanitizeReplyText } from '@/lib/domain/text';
import { findTypos } from '@/lib/domain/productSearch';
import { availableColors, extractSize, familyBlock, familySizes, isAvailable, modelKey } from '@/lib/domain/productVariants';
import { calculateOrder } from '@/lib/domain/calculator';
import { findPostalCodesInText, postalCodesPromptBlock } from '@/lib/domain/postalCodes';
import { parseQuantity } from '@/lib/domain/contextSync';
import { serverEnv } from '@/lib/config/env';
import { chatCompletion } from './client';
import { CORE_RULES, HARD_STOPS, buildReplySystemPrompt, transcriptBlock } from './prompts';
import { REPLY_CHECKLIST } from './rules';
import { applyDeterministicFixes, buildSafeReply, checkCustomerReply, type ReplyGuardContext } from './replyGuard';
import { buildPackageQuote, collapseDuplicatePackageTotals, narrowPackageCandidates, packagePromptBlock, type PackageQuote, type PackageItemInput } from '@/lib/domain/packageQuote';
import { liveCheckNotes, refreshLiveProducts, type LiveCheck } from '@/lib/site/gigaLive';
import {
  isOfferQuestion,
  mentionsSpecificModel,
  offerCandidates,
  offerLines,
  offerPromptBlock,
  type OfferLine,
} from './offer';
import { collectionLinkLine, collectionPromptBlock, matchCollection } from '@/lib/domain/collections';
import { syncSessionFromText } from '@/lib/api/sessionContextSync';

function productFactsBlock(
  products: { product: Product; additional: import('@/lib/domain/types').ProductAdditionalData | null }[],
): string {
  if (!products.length) {
    return 'PROIZVODI: nijedan proizvod nije potvrđen u ovoj sesiji. Ne navodi cijene ni specifikacije i ne tvrdi da proizvod imamo.';
  }
  const blocks = products.map(({ product, additional }) => {
    const lines = [
      `- NAZIV: ${product.name}`,
      `  ID: ${product.id}${product.sku ? ` | SKU: ${product.sku}` : ''}`,
      `  CIJENA: ${product.price !== null ? formatMoney(product.price, product.currency) : 'NIJE POZNATA'}`,
      `  DOSTUPNOST: ${product.availability.status === 'in_stock' ? 'NA STANJU — smije se ponuditi' : 'NIJE NA STANJU — NE SMIJE SE PONUDITI (R26)'} (provjereno ${product.availability.checkedAt ?? 'nepoznato'}, izvor: ${product.availability.source})`,
      `  IZVOR: ${product.url} (ažurirano ${product.scrapedAt ?? 'nepoznato'})`,
    ];
    const specs = Object.entries(product.specifications ?? {}).slice(0, 6);
    if (specs.length) lines.push(`  SPECIFIKACIJE IZ IZVORA: ${specs.map(([k, v]) => `${k}=${v}`).join('; ')}`);
    // Customers ask about material, dimensions and use, which often live only in
    // the source description. It is quoted as-is; nothing is added to it.
    const described = (product.descriptionHtml ?? product.shortDescription ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (described) {
      lines.push(
        `  OPIS IZ IZVORA (citiraj samo ono što ovdje piše): ${described.length > 240 ? `${described.slice(0, 240)}…` : described}`,
      );
    }
    if (additional?.weightKg !== null && additional?.weightKg !== undefined) {
      lines.push(`  TEŽINA: ${additional.weightKg} kg (koristi se za dostavu)`);
    } else {
      lines.push(
        '  TEŽINA: NIJE UNESENA U SISTEM — ovo je INTERNO, kupcu se o tome NE PIŠE NIŠTA. ' +
          'Uz cijenu ovog proizvoda napiši samo „dostava: ________ KM” (praznina koju agent dopuni). ' +
          'Nikad ne nagađaj iznos i nikad ne objašnjavaj kupcu da težina nedostaje (R24).',
      );
    }
    if (!additional?.dimensionsCm) {
      lines.push('  DIMENZIJE: nijesu unesene u sistem — ako kupac traži dimenzije, reci da ih nemamo u sistemu i da ćemo ih provjeriti.');
    }
    if (additional?.dimensionsCm) {
      const d = additional.dimensionsCm;
      const parts = [
        d.lengthCm !== null ? `D=${d.lengthCm}` : null,
        d.widthCm !== null ? `Š=${d.widthCm}` : null,
        d.heightCm !== null ? `V=${d.heightCm}` : null,
      ].filter(Boolean);
      if (parts.length) lines.push(`  DIMENZIJE: ${parts.join(' × ')} cm`);
    }
    if (additional?.fields?.length) {
      lines.push(
        `  RUČNO DODANO (provjerio agent): ${additional.fields.map((f) => `${f.fieldName}=${f.value}${f.unit ? ` ${f.unit}` : ''}`).join('; ')}`,
      );
    }
    if (product.missingFields?.length) lines.push(`  NEDOSTAJE U IZVORU: ${product.missingFields.join(', ')}`);
    return lines.join('\n');
  });
  return `PROVJERENI PODACI O PROIZVODIMA (koristi isključivo ovo; ništa ne dodaj iz sjećanja):
${blocks.join('\n')}`;
}

export interface ReplyGenerationResult {
  reply: GeneratedReply;
  warning: string | null;
  /** Šta AI nije imao u podacima — agent to vidi prije slanja. */
  notes: string[];
}

export async function generateCustomerReply(args: {
  userId: string;
  sessionId: string;
  store: Store;
  tone?: 'concise' | 'balanced' | 'detailed';
  instruction?: string | null;
  signal?: AbortSignal;
}): Promise<ReplyGenerationResult> {
  const { userId, sessionId, store } = args;

  const loaded = await store.getSession(userId, sessionId);
  if (!loaded) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');

  // Prije odgovora uskladi sesiju sa zadnjom kupčevom porukom (dimenzija, boja,
  // količina, podaci kupca) — kartice i prompt koriste isto stanje.
  const lastCustomerText = (await store.listMessages(userId, sessionId))
    .filter((m) => m.senderType === 'customer')
    .slice(-1)[0]?.content;
  const session = lastCustomerText
    ? ((await syncSessionFromText({ store, userId, sessionId, text: lastCustomerText })).session ?? loaded)
    : loaded;

  const [settings, procedures, messages, turns] = await Promise.all([
    store.getSettings(userId),
    store.listProcedures(userId),
    store.listMessages(userId, sessionId),
    store.listTurns(userId, sessionId),
  ]);

  if (!messages.some((m) => m.senderType === 'customer' || m.senderType === 'agent')) {
    throw new ApiError(400, 'Sesija nema poruka. Unesite razgovor prije generisanja odgovora.', 'empty_session');
  }

  // Ground the draft in real catalogue facts: products the assistant already
  // touched in this session, plus a direct catalogue lookup of the customer's
  // last message. Without the lookup a draft can answer "nemamo u ponudi"
  // while the catalogue clearly has matching items.
  const lastCustomerMessage = [...messages].reverse().find((m) => m.senderType === 'customer');
  const lookupQuery = [lastCustomerMessage?.content ?? '', session.context.summary].filter(Boolean)
    .join(' ')
    .trim();

  // Pitanje o cijeloj ponudi („koje grebalice imate”) traži širu pretragu od
  // pitanja o jednom proizvodu — inače odgovor preskoči dio asortimana.
  const asksForOffer = isOfferQuestion(lastCustomerMessage?.content ?? '');
  const [contextProducts, lookupHitsRaw] = await Promise.all([
    Promise.all(session.context.products.map((p) => store.getProduct(p.productId))),
    lookupQuery ? store.searchProductsWithAdditional(lookupQuery, asksForOffer ? 40 : 6) : Promise.resolve([]),
  ]);

  const lookupHits = [...lookupHitsRaw];

  // Kupac cesto u istoj poruci imenuje vise modela („Aura 4 ladice i Pulsar
  // 102x40”), a jedna pretraga vrati samo najbolje pogotke za prvi. Zato se
  // svaka imenovana familija trazi posebno; prihvata se samo ako katalog
  // stvarno ima proizvode koji POCINJU tom riječju (da „komada” ne prođe).
  const familyHits: { product: Product; additional: import('@/lib/domain/types').ProductAdditionalData | null }[] = [];
  const words = (lastCustomerMessage?.content ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9čćžšđ ]/gu, ' ')
    .split(/[ ]+/u)
    .filter((word) => word.length >= 4);
  for (const word of [...new Set(words)]) {
    if (lookupHits.some((hit) => hit.product.name.toLowerCase().startsWith(word.slice(0, 5)))) continue;
    const familyKey = word.length >= 5 ? word.slice(0, 5) : word;
    const hits = await store.searchProductsWithAdditional(word, 4);
    for (const hit of hits) {
      if (!hit.product.name.toLowerCase().startsWith(familyKey)) continue;
      familyHits.push(hit);
    }
  }
  lookupHits.push(...familyHits);

  const seen = new Set<string>();
  const knownProducts: { product: Product; additional: import('@/lib/domain/types').ProductAdditionalData | null }[] = [];
  for (const hit of lookupHits) {
    if (seen.has(hit.product.id)) continue;
    seen.add(hit.product.id);
    knownProducts.push(hit);
  }
  for (const product of contextProducts) {
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);
    knownProducts.push({ product, additional: await store.getProductAdditional(product.id) });
  }
  // Which product is the conversation actually about? The catalogue lookup uses
  // only the last message ("dal je ovo ta cijena?"), so without ranking the
  // first product ever added would win and the topic product would be ignored.
  const customerText = messages
    .filter((m) => m.senderType === 'customer')
    .slice(-3)
    .map((m) => m.content.toLowerCase())
    .join(' ');
  const topicTokens = new Set(
    customerText
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
  // Poređenje ide po korijenu riječi, jer kupac piše „grebalice”, a u katalogu
  // piše „grebalica” — bez toga se relevantni proizvodi ne prepoznaju.
  const stem = (word: string): string => (word.length >= 5 ? word.slice(0, 5) : word);
  const topicStems = new Set([...topicTokens].map(stem));
  const relevance = (name: string): number => {
    const words = name.toLowerCase().split(/\s+/);
    return words.reduce((score, word) => (word.length >= 4 && topicStems.has(stem(word)) ? score + 1 : score), 0);
  };
  const scoredProducts = knownProducts
    .map((entry, index) => ({ entry, index, score: relevance(entry.product.name) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const rankedProducts = scoredProducts.map((item) => item.entry);
  const confirmedProducts = rankedProducts.slice(0, 5);

  // Potpuna ponuda dolazi iz šire pretrage: sve što je na stanju, do 15 stavki.
  // U ponudu ulazi samo ono što je stvarno traženo (kupac pita za grebalice =>
  // grebalice, ne grijalica koja se slučajno našla u pretrazi).
  const relevantOffer = asksForOffer
    ? scoredProducts.filter((item) => item.score > 0).map((item) => item.entry.product)
    : [];
  const offerProducts = asksForOffer
    ? offerCandidates(relevantOffer.length ? relevantOffer : rankedProducts.map((entry) => entry.product), 15)
    : [];
  // Pitanje o cijeloj ponudi → link na kategoriju giga.ba, ne prepisivanje
  // spiska u chat. Kategorija se traži po onome što je kupac napisao, a ako tu
  // nema poklapanja, po nazivu prvog pronađenog proizvoda.
  // Link na kategoriju ide samo za OPŠTE pitanje. Ako kupac traži konkretan
  // model („Aura 4 ladice”, „58x200”), odgovor mora imati cijenu tog proizvoda.
  const offerQuestionText = [lastCustomerMessage?.content ?? '', args.instruction ?? ''].join(' ');
  const specificModel = mentionsSpecificModel(
    offerQuestionText,
    offerProducts.map((product) => product.name),
  );
  const offerCollection =
    asksForOffer && !specificModel
      ? matchCollection(offerQuestionText) ?? matchCollection(offerProducts[0]?.name ?? '')
      : null;
  // Sa linkom se ne traži nabrajanje; bez linka (nema kategorije) traži se.
  const offerList: OfferLine[] = offerCollection ? [] : offerLines(offerProducts);

  // Baza je kopija; cijena i stanje se na giga.ba mijenjaju. Prije nego asistent
  // napiše cijenu ili dostupnost, provjerimo baš proizvode iz ovog razgovora
  // (najviše 5, jedan zahtjev po proizvodu, uz pauzu i TTL zaštitu).
  let liveChecks: LiveCheck[] = [];
  if ((process.env.LIVE_SITE_CHECK ?? 'true').toLowerCase() !== 'false' && confirmedProducts.length) {
    const live = await refreshLiveProducts(
      store,
      confirmedProducts.map((entry) => entry.product),
      { max: 5 },
    );
    liveChecks = live.checks;
    for (const entry of confirmedProducts) {
      const fresh = live.updated.get(entry.product.id);
      if (fresh) entry.product = fresh;
    }
  }

  /**
   * Delivery for one product, always from the real weight and the configured
   * tiers. Never guessed, never taken from the model (R13/R14/R22).
   */
  /**
   * R30: narudzba je jedan paket. Kada kupac uzima vise proizvoda (ili vise
   * komada), kilaze se sabiraju i dostava se racuna JEDNOM - nikad po proizvodu.
   * Sav novac racuna kalkulator, model samo prepisuje brojeve.
   */
  const packageItems: PackageItemInput[] = [];
  const packageSeen = new Set<string>();
  const contextRefs = session.context.products ?? [];
  const textQuantity = parseQuantity(lastCustomerMessage?.content ?? '') ?? 1;
  // Kolicina se cita IZ PORUKE za svaki proizvod posebno: „2 komada Aura i
  // jednu Pulsar” ne smije znaciti dvije Pulsar komode.
  const NUMBER_WORDS: Record<string, number> = {
    jedan: 1, jednu: 1, jedna: 1, jedne: 1, dva: 2, dvije: 2, dve: 2, tri: 3,
    četiri: 4, cetiri: 4, pet: 5, šest: 6, sest: 6, sedam: 7, osam: 8, devet: 9, deset: 10,
  };
  const quantityFor = (name: string, text: string): number | null => {
    const tokens = text.toLowerCase().replace(/[^a-z0-9čćžšđ ]/gu, ' ').split(/[ ]+/u).filter(Boolean);
    const key = (name.toLowerCase().split(' ')[0] ?? '').slice(0, 5);
    const at = tokens.findIndex((token) => token.startsWith(key));
    if (at < 0) return null;
    for (let index = at - 1; index >= Math.max(0, at - 4); index--) {
      const token = tokens[index]!;
      if (/^[0-9]{1,3}$/.test(token)) return Number(token);
      const word = NUMBER_WORDS[token];
      if (word) return word;
    }
    return null;
  };
  const addPackageItem = (entry: { product: Product; additional: { weightKg?: number | null } | null }) => {
    if (packageSeen.has(entry.product.id)) return;
    // R26/R31: proizvod kojeg GigaHub nema na stanju ne ulazi u paket (kolicina <= 1).
    if (!isAvailable(entry.product)) return;
    packageSeen.add(entry.product.id);
    const ref = contextRefs.find((item) => item.productId === entry.product.id);
    packageItems.push({
      productId: entry.product.id,
      name: entry.product.name,
      sku: entry.product.sku,
      unitPrice: entry.product.price ?? ref?.unitPrice ?? null,
      quantity: quantityFor(entry.product.name, lastCustomerMessage?.content ?? '') ?? ref?.quantity ?? textQuantity,
      weightKg: entry.additional?.weightKg ?? null,
    });
  };
  // 1) proizvodi koje je kupac izricito imenovao (familija + dimenzija/ladice iz poruke)
  for (const entry of narrowPackageCandidates(
    confirmedProducts.map((item) => ({ ...item, name: item.product.name })),
    lastCustomerMessage?.content ?? '',
  )) {
    addPackageItem(entry);
  }
  // 2) proizvodi koje sesija vec zna (dodani rucno ili ranije u razgovoru)
  for (const entry of confirmedProducts) {
    if (!contextRefs.some((ref) => ref.productId === entry.product.id)) continue;
    addPackageItem(entry);
  }
  const packageQuote: PackageQuote | null = buildPackageQuote(packageItems, settings.calculator);

  const deliveryFor = (
    product: Product,
    price: number | null,
    weightKg: number | null,
    currency: string,
  ): { amount: number; currency: string } | null => {
    if (weightKg === null || weightKg <= 0) return null;
    const calc = calculateOrder({
      items: [
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: price,
          quantity: 1,
          weightKg,
          currentCatalogPrice: price,
        },
      ],
      config: settings.calculator,
    });
    return typeof calc.delivery.amount === 'number' && calc.delivery.amount > 0
      ? { amount: calc.delivery.amount, currency: calc.currency || currency }
      : null;
  };

  // R21: isti model postoji u više dimenzija i boja (svaka kombinacija je
  // poseban proizvod). Kupac mora dobiti SVE opcije, ne samo prvu pronađenu.
  const dimensionGroups: {
    productId: string;
    options: {
      sizeKey: string;
      label: string;
      available: boolean;
      price: number | null;
      currency: string;
      delivery: { amount: number; currency: string } | null;
      weightKg: number | null;
    }[];
  }[] = [];
  const dimensionBlocks: string[] = [];
  const colorOptions: { label: string }[] = [];
  // A customer who already wrote "102 x 40" picked a size — never ask again.
  const customerNamedSize = /\b\d{2,3}\s*[x×]\s*\d{2,3}\b/i.test(customerText);
  // The topic product is the first ranked one that really has several options;
  // without this, a set of unrelated products would hide the real question.
  for (const { product } of customerNamedSize ? [] : confirmedProducts.slice(0, 3)) {
    if (!extractSize(product.name)) continue;
    if (dimensionGroups.length) break;
    const catalogue = await store.searchProducts(modelKey(product.name), 20);
    const sizes = familySizes(product, catalogue);
    if (sizes.length < 2) continue;

    const options = [];
    // R26: samo dimenzije koje se stvarno mogu kupiti ulaze u ponudu.
    for (const size of sizes.filter((item) => item.variants.some((variant) => variant.available))) {
      const best = size.variants.find((variant) => variant.available) ?? size.variants[0]!;
      const weightKg = (await store.getProductAdditional(best.productId))?.weightKg ?? null;
      options.push({
        productId: best.productId,
        sizeKey: size.sizeKey,
        label: size.label,
        available: best.available,
        price: best.price,
        currency: best.currency,
        weightKg,
        delivery: deliveryFor({ ...product, id: best.productId }, best.price, weightKg, best.currency),
        colors: size.variants
          .map((variant) => `${variant.color || 'bez oznake boje'}${variant.available ? '' : ' (nije na stanju)'}`)
          .join(', '),
      });
    }
    for (const color of availableColors(sizes)) colorOptions.push({ label: color });
    dimensionGroups.push({ productId: product.id, options });
    dimensionBlocks.push(familyBlock(sizes.filter((item) => item.variants.some((variant) => variant.available))));
  }

  // Dostava ide uz SVAKU cijenu. Kada težina nije unesena, iznos se ne izmišlja:
  // u poruci ostaje praznina „dostava: ________ KM” koju agent dopuni.
  const deliveryBlocks: string[] = [];
  // R30: kod više proizvoda dostava se NE piše po proizvodu — samo za cijeli paket.

  for (const group of packageQuote ? [] : dimensionGroups) {
    const rows = group.options.map(
      (option) =>
        `    - ${option.label}${option.available === false ? ' (trenutno nije na stanju)' : ''}: cijena ${
          option.price !== null ? formatMoney(option.price, option.currency) : 'nije poznata'
        }, ${option.delivery ? `dostava ${formatMoney(option.delivery.amount, option.delivery.currency)}` : 'dostava: ________ KM (težina nije unesena)'}`,
    );
    deliveryBlocks.push(
      ['  CIJENA I DOSTAVA PO DIMENZIJI (napiši oba podatka u svakom redu):', ...rows].join('\n'),
    );
  }

  // R23: potvrđena narudžba mora dobiti zahvalu i poštarinu.
  const orderConfirmed = session.context.orderIntent?.value === 'confirmed';
  const orderConfirmedBlock = orderConfirmed
    ? 'KUPAC JE POTVRDIO NARUDŽBU: zahvali mu na narudžbi i napiši cijenu poštarine. ' +
      'Ako težina nije unesena, napiši tačno „Poštarina: ________ KM” — nikad ne izmišljaj iznos.'
    : '';

  // A mistyped product name must still lead to the real product. The shopper is
  // never corrected for the typo; the assistant simply offers what was meant.
  // R26: proizvod koji nije na stanju ne smije se naći u ponudi; ako ga kupac
  // baš traži, model dobija jasnu napomenu da ga ne nudi kao dostupnog.
  const notAvailable = confirmedProducts.filter(({ product }) => product.availability.status !== 'in_stock');
  const notAvailableBlock = notAvailable.length
    ? `NIJE NA STANJU (ne nuditi, ne navoditi cijenu, ne pisati da imamo): ${notAvailable
        .map(({ product }) => product.name)
        .join('; ')}. Ako kupac pita za nešto od ovoga, reci da trenutno nije dostupno i ponudi ono što jeste (R26).`
    : '';

  // R28: popust na količinu istog proizvoda — tačni pragovi iz Postavki.
  const qtyRules = (settings.calculator.discountRules ?? []).filter(
    (rule) => rule.enabled && rule.type === 'quantity' && (rule.percent ?? 0) > 0 && (rule.minQuantity ?? 0) > 1,
  );
  const quantityBlock = qtyRules.length
    ? `POPUST NA KOLIČINU (samo isti proizvod — ista boja i iste dimenzije, nikad različiti): ${qtyRules
        .map((rule) => `${rule.minQuantity} kom → ${rule.percent}%`)
        .join('; ')}. Primer: 2 iste stolice iste boje = 5%, ali 2 različite stolice ili 2 boje = bez popusta. Ako je u narudžbi više različitih proizvoda a jedan je naručen više puta, popust važi samo za taj proizvod. Uvijek se primjenjuje najviši dostignuti prag; procente nikad ne mijenjaj ni ne izmišljaj (R28). R33: kada kupac traži dva ili više proizvoda, popust se MORA spomenuti u istoj poruci — nikad se ne čeka da kupac pita.`
    : 'POPUST NA KOLIČINU: nije podešen. Ne nudi nikakav popust na količinu (R28).';

  const typoPairs = findTypos(lastCustomerMessage?.content ?? '', confirmedProducts.map(({ product }) => product));
  const typoBlock = typoPairs.length
    ? `KUPAC JE VJEROVATNO MISLIO NA: ${typoPairs
        .map((pair) => `napisano „${pair.wrote}" = u katalogu „${pair.catalog}"`)
        .join('; ')}. Nemoj ispravljati kupca ni spominjati grešku — samo ponudi odgovarajući proizvod iz podataka.`
    : '';

  const tone = args.tone ?? settings.ai.responseStyle;
  const system = buildReplySystemPrompt({ procedures, settings, style: tone });
  // Repair and retry passes only need the safety rules, not the whole brief:
  // a second full prompt would double the cost of every corrected reply.
  const compactSystem = [CORE_RULES, REPLY_CHECKLIST, HARD_STOPS].join('\n');

  const transcript = transcriptBlock(messagesForModel(messages, session.context, serverEnv.ai.contextMessages));
  const contextText = serializeContext(session.context);

  // Postal codes come from the shipped official table, never from the model,
  // so an address request always contains the correct code.
  const postalBlock = postalCodesPromptBlock(
    findPostalCodesInText([lastCustomerMessage?.content ?? '', args.instruction ?? ''].join(' '), 3),
  );

  const offerBlock = offerCollection
    ? collectionPromptBlock(offerCollection, offerProducts[0]?.name ?? null) ?? ''
    : offerPromptBlock(offerProducts, offerProducts.length);
  const offerLinkLine = offerCollection ? collectionLinkLine(offerCollection) : null;

  const userContent = [
    `KONTEKST SESIJE:
${contextText || '(nema strukturiranih podataka)'}`,
    productFactsBlock(confirmedProducts),
    ...dimensionBlocks,
    packageQuote ? packagePromptBlock(packageQuote) : '',
    ...(packageQuote ? [] : deliveryBlocks),
    offerBlock,
    orderConfirmedBlock,
    notAvailableBlock,
    quantityBlock,
    typoBlock,
    postalBlock,
    transcript,
    args.instruction?.trim() ? `DODATNA UPUTA AGENTA ZA OVAJ ODGOVOR: ${args.instruction.trim()}` : '',
    'Napiši samo poruku kupcu, bez potpisa i bez objašnjenja.',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature: 0.5,
    maxTokens: 900,
    signal: args.signal,
  });

  let body = sanitizeReplyText(result.content);

  const deniesCatalogue = /nemamo|ne (imamo|posjedujemo)|nema(mo)? u ponudi|trenutno (ga )?nemamo/i.test(body);
  if (body && deniesCatalogue && confirmedProducts.length) {
    const names = confirmedProducts
      .map(({ product }) => `- ${product.name}: ${product.price !== null ? formatMoney(product.price, product.currency) : 'cijena nije poznata'} (${product.availability.status})`)
      .join('\n');
    const retry = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            userContent,
            'TVOJ PRETHODNI NACRT JE BIO NETAČAN — rekao si da nemamo proizvod, a katalog ga ima.',
            `U poruci OBAVEZNO navedi ove proizvode iz kataloga:
${names}`,
            'Napiši samo poruku kupcu, bez potpisa i bez objašnjenja.',
          ].join('\n'),
        },
      ],
      temperature: 0.3,
      maxTokens: 900,
      signal: args.signal,
    });
    const retried = sanitizeReplyText(retry.content);
    if (retried) body = retried;
  }

  if (!body) throw new ApiError(502, 'AI nije vratio tekst poruke. Pokušajte ponovo.', 'ai_empty_reply');

  /**
   * Rule gate: the rules that protect the customer from invented data are
   * checked in code, not trusted to the model. One repair attempt, then a safe
   * template that cannot contain made-up numbers.
   */
  // R22 step 2: the delivery price the reply must quote, computed from the real
  // weight and the configured tiers — the model is not asked to invent it.
  const primary = confirmedProducts[0];
  const deliveryAmount = primary
    ? deliveryFor(primary.product, primary.product.price, primary.additional?.weightKg ?? null, primary.product.currency)
    : null;
  // Kod paketa je mjerodavan ukupan iznos dostave za sve proizvode zajedno.
  const packageDelivery = packageQuote?.deliveryAmount != null
    ? { amount: packageQuote.deliveryAmount, currency: packageQuote.currency }
    : null;
  // Dostava glavnog proizvoda: iznos kada težina postoji, inače praznina za agenta.
  if (primary && !packageQuote) {
    deliveryBlocks.push(
      deliveryAmount
        ? `  DOSTAVA ZA GLAVNI PROIZVOD: ${formatMoney(deliveryAmount.amount, deliveryAmount.currency)}`
        : '  DOSTAVA ZA GLAVNI PROIZVOD: težina nije unesena — u poruci ostavi tačno „dostava: ________ KM” (bez izmišljenog iznosa).',
    );
  }

  // R22 step 1: everything we really know about the product.
  const specPairs: { label: string; value: string }[] = [];
  for (const { product, additional } of confirmedProducts) {
    for (const [label, value] of Object.entries(product.specifications ?? {})) {
      if (typeof value === 'string' && value.trim()) specPairs.push({ label, value: value.trim() });
    }
    const dims = additional?.dimensionsCm;
    if (dims) {
      const parts = [dims.lengthCm, dims.widthCm, dims.heightCm].filter(
        (value): value is number => typeof value === 'number' && value > 0,
      );
      if (parts.length) specPairs.push({ label: 'Dimenzije', value: `${parts.join(' × ')} cm` });
    }
  }

  const guardCtx: ReplyGuardContext = {
    products: confirmedProducts,
    deliveryAmount: packageDelivery ?? deliveryAmount,
    packageQuote,
    specPairs,
    customerMessage: lastCustomerMessage?.content ?? '',
    deliveryAmounts: settings.calculator.weightTiers.filter((tier) => tier.enabled).map((tier) => tier.amount),
    dimensionOptions: dimensionGroups,
    colorOptions,
    orderConfirmed,
    quantityDiscounts: qtyRules.map((rule) => ({ minQuantity: rule.minQuantity ?? 2, percent: rule.percent ?? 0 })),
    offerList,
    offerLink: offerCollection?.url ?? null,
    offerLinkLine,
    offerCategory: offerCollection?.title ?? null,
  };
  let guardWarning: string | null = null;
  let guardIssues = checkCustomerReply(body, guardCtx);
  if (guardIssues.length) {
    if (process.env.NODE_ENV !== 'production') {
      // Helps diagnose why a reply was rejected, without storing customer text.
      console.warn('[reply-guard]', guardIssues.map((issue) => `${issue.code} (${issue.hint.slice(0, 120)})`).join(' | '), '| text:', body.slice(0, 300));
    }
    const repair = await chatCompletion({
      messages: [
        { role: 'system', content: compactSystem },
        {
          role: 'user',
          content: [
            userContent,
            'ISPRAVI OVE GREŠKE U PORUCI:',
            ...guardIssues.map((issue) => `- ${issue.hint}`),
            'Napiši samo ispravljenu poruku kupcu, bez objašnjenja i bez potpisa.',
          ].join('\n'),
        },
      ],
      temperature: 0.2,
      maxTokens: 900,
      signal: args.signal,
    });
    const repaired = sanitizeReplyText(repair.content);
    if (repaired) body = repaired;
    guardIssues = checkCustomerReply(body, guardCtx);
    if (guardIssues.length) {
      // Approved sentences are appended deterministically before giving up on
      // the model's wording — that keeps the useful text and still obeys R15/R19/R21.
      const patched = applyDeterministicFixes(body, guardCtx, guardIssues);
      if (patched !== body) {
        const remaining = checkCustomerReply(patched, guardCtx);
        if (!remaining.length) {
          body = patched;
          guardIssues = [];
        }
      }
    }
    if (guardIssues.length) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[reply-guard:poslije-popravki]', guardIssues.map((issue) => issue.code).join(','), '| text:', body.slice(0, 200));
      }
      body = buildSafeReply(guardCtx);
      guardWarning = `AI nacrt nije prošao provjeru pravila (${guardIssues
        .map((issue) => issue.message)
        .join(' ')}). Zato je sastavljena sigurna poruka iz podataka kataloga — provjeri je prije slanja.`;
    }
  }

  // Kod paketa model ponekad zalijepi dva puta isti blok sa stavkama —
  // zadrzava se prvi, da kupac ne dobije duple redove.
  if (packageQuote) body = collapseDuplicatePackageTotals(body);

  // R26/R31 — kupac traži proizvod kojeg GigaHub nema na stanju (kolicina 0 ili 1):
  // poruka to mora reći, bez obzira kako je model sastavio ostatak.
  if (notAvailable.length) {
    const askedWords = (lastCustomerMessage?.content ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4);
    // Samo najbolje poklapanje: kupac koji pita za jedan adapter ne dobija
    // spisak svih adaptera kojih trenutno nema.
    const scoreFor = (name: string) => {
      const nameWords = name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 3);
      const hits = askedWords.filter((word) => nameWords.some((nameWord) => nameWord.startsWith(word.slice(0, 5)))).length;
      return { hits, score: nameWords.length ? hits / nameWords.length : 0 };
    };
    const bestAvailable = Math.max(
      0,
      ...confirmedProducts
        .filter(({ product }) => isAvailable(product))
        .map(({ product }) => scoreFor(product.name).score),
    );
    const scored = notAvailable
      .map(({ product }) => ({ name: product.name, ...scoreFor(product.name) }))
      .filter((entry) => entry.hits >= 2 && entry.score > bestAvailable)
      .sort((a, b) => b.score - a.score);
    const askedUnavailable = scored.filter((entry) => entry.score === scored[0]?.score).map((entry) => entry.name);
    if (askedUnavailable.length && !/nemamo|nema na stanju|nije na stanju|nije dostupno/i.test(body)) {
      body = `Trenutno nemamo na stanju: ${askedUnavailable.slice(0, 2).join(', ')}.\n\n${body}`;
    }
  }
  const signatureConfigured = Boolean(renderSignature(settings.signature));
  // Praznina za dostavu uvijek isto dugačka (i poslije popravki), da agent ima
  // isto mjesto za ručni upis iznosa.
  body = body.replace(/(dostava|po[šs]tarina)\s*:?\s*_{1,}\s*KM/gi, 'dostava: ________ KM');
  // Sitne gramatičke ispravke: „uz dostava:” -> „uz dostavu:”.
  body = body.replace(/uz\s+dostava\s*:/gi, 'uz dostavu:').replace(/uz\s+po[šs]tarina\s*:/gi, 'uz poštarinu:');
  // Samostalan red „dostava: ________ KM” nema smisla kada svaka cijena već ima
  // svoju dostavu — uklanja se da poruka ne izgleda dvaput.
  {
    const isBlankOnly = (line: string) => /^\s*(?:dostava|po[šs]tarina)\s*:?\s*_{2,}\s*KM\s*$/i.test(line);
    const lines = body.split('\n');
    const blanks = lines.filter(isBlankOnly).length;
    const withPrice = lines.filter((line) => /_{2,}\s*KM/.test(line)).length;
    if (blanks && withPrice > blanks) {
      body = lines.filter((line) => !isBlankOnly(line)).join('\n').replace(/\n{3,}/g, '\n').trim();
    }
  }
  const fullText = appendSignature(body, settings.signature);

  const citations: AiCitation[] = [
    ...confirmedProducts.map((p) => ({
      kind: 'product' as const,
      label: p.product.name,
      url: p.product.url,
      detail: `Provjereno ${p.product.scrapedAt ?? 'nepoznato'}`,
      updatedAt: p.product.scrapedAt ?? undefined,
    })),
    ...procedures
      .filter((p) => p.verified)
      .map((p) => ({ kind: 'procedure' as const, label: p.title, updatedAt: p.updatedAt })),
  ];

  const reply: GeneratedReply = {
    id: randomUUID(),
    sessionId,
    userId,
    body,
    fullText,
    signatureApplied: signatureConfigured,
    tone,
    createdAt: new Date().toISOString(),
    editedByAgent: false,
    citations,
    model: result.model,
  };

  await store.addReply(userId, reply);

  // Agent mora vidjeti šta AI nije imao, a kupac dobija prazninu za ručni upis.
  const notes: string[] = [...liveCheckNotes(liveChecks)];
  const withoutWeight = confirmedProducts
    .filter(({ additional }) => typeof additional?.weightKg !== 'number' || additional.weightKg <= 0)
    .map(({ product }) => product.name);
  if (packageQuote) {
    // Kod paketa je dostava jedna — i napomena agentu mora biti jedna.
    notes.push(
      packageQuote.deliveryAmount === null
        ? `Dostava za cijeli paket je prazna jer nema kilaže za: ${packageQuote.missingWeights.join(', ')}. Unesi kilažu u /products da se iznos izračuna sam.`
        : `Dostava za cijeli paket (ukupno ${packageQuote.totalWeightKg} kg): ${formatMoney(packageQuote.deliveryAmount, packageQuote.currency)}. Ukupno za plaćanje: ${formatMoney(packageQuote.total ?? 0, packageQuote.currency)}.`,
    );
  } else if (withoutWeight.length === 1) {
    notes.push(`Nemam podatak o težini za „${withoutWeight[0]}” — u poruci je ostavljeno „dostava: ________ KM”.`);
  } else if (withoutWeight.length > 1) {
    notes.push(
      `Nemam podatak o težini za ${withoutWeight.length} proizvoda (${withoutWeight
        .slice(0, 2)
        .join(', ')}…) — u poruci je za svaku cijenu ostavljeno „dostava: ________ KM”.`,
    );
  }
  for (const group of dimensionGroups) {
    const unknown = group.options.filter((option) => !option.delivery).length;
    if (unknown > 0 && !notes.length) {
      notes.push(`Dostavu ne mogu izračunati za ${unknown} dimenzij(e) jer težina nije unesena — iznos je ostavljen prazan.`);
    }
  }

  return {
    reply,
    notes,
    warning:
      guardWarning ??
      (signatureConfigured
        ? null
        : 'Potpis nije konfiguriran. Unesite ime agenta i podatke firme u Postavkama → Potpis.'),
  };
}
