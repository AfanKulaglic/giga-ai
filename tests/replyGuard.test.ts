import { describe, expect, it } from 'vitest';
import { buildSafeReply, applyDeterministicFixes, checkCustomerReply } from '@/lib/ai/replyGuard';
import type { Product } from '@/lib/domain/types';

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: 'p1',
    name: 'RIPADO NOĆNI ORMARIĆ 45X60CM',
    sku: '63533',
    brand: null,
    category: 'Namještaj',
    price: 150,
    compareAtPrice: null,
    currency: 'BAM',
    discountPercent: null,
    availability: { status: 'in_stock', checkedAt: null, source: 'site', note: null },
    images: [],
    variants: [],
    tags: [],
    specifications: {},
    shortDescription: null,
    description: null,
    url: 'https://giga.ba/p',
    source: 'shopify-json',
    sourceUpdatedAt: null,
    scrapedAt: '2026-01-01T00:00:00.000Z',
    missingFields: [],
    extractionStatus: 'complete',
    ...over,
  }) as Product;

const withWeight = (weightKg: number | null) => ({
  product: product(),
  additional: {
    productId: 'p1',
    fields: [],
    weightKg,
    dimensionsCm: weightKg ? { lengthCm: 45, widthCm: 60, heightCm: 40 } : null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'agent',
  },
});

const CTX = (weightKg: number | null) => ({
  products: [withWeight(weightKg)],
  customerMessage: 'Koliko kosta i kolika je dostava?',
  deliveryAmounts: [10, 15, 20],
});

describe('customer reply guard', () => {
  it('accepts a correct reply', () => {
    const body =
      'Poštovani, RIPADO NOĆNI ORMARIĆ 45X60CM je dostupan po cijeni od 150,00 KM, dostava: ________ KM.';
    expect(checkCustomerReply(body, CTX(null))).toEqual([]);
  });

  it('flags a price that is not in the data', () => {
    const issues = checkCustomerReply('Cijena je 199,00 KM, dostava 15,00 KM.', CTX(null));
    expect(issues.map((i) => i.code)).toContain('invented_price');
  });

  it('flags denying a product that exists', () => {
    const issues = checkCustomerReply('Trenutno nemamo taj proizvod u ponudi.', CTX(5));
    expect(issues.map((i) => i.code)).toContain('catalogue_denied');
  });

  it('flags a missing weight statement', () => {
    const issues = checkCustomerReply('Poštovani, proizvod je dostupan po cijeni 150,00 KM.', CTX(null));
    expect(issues.map((i) => i.code)).toContain('missing_weight_not_stated');
  });

  it('flags delivery price when weight is unknown', () => {
    const issues = checkCustomerReply(
      'Cijena je 150,00 KM, a dostava 15,00 KM. Težina nije unesena, provjerit ćemo.',
      CTX(null),
    );
    expect(issues.map((i) => i.code)).toContain('delivery_price_without_weight');
  });

  it('flags singular voice, free shipping and warehouse wording', () => {
    const issues = checkCustomerReply('Ja mogu poslati odmah, dostava je besplatna, imamo na lageru.', CTX(5));
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('first_person_singular');
    expect(codes).toContain('free_shipping');
    expect(codes).toContain('warehouse_leak');
  });

  it('flags a source leak and a delivery promise', () => {
    const issues = checkCustomerReply('Provjereno 21.11.2026, dostava za 2 dana.', CTX(5));
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('source_leak');
    expect(codes).toContain('shipping_promise');
  });

  it('builds a safe reply that only repeats real data', () => {
    const safe = buildSafeReply(CTX(null));
    expect(safe).toContain('150,00');
    // Težina nije unesena: u sigurnoj poruci ostaje praznina za ručni upis iznosa.
    expect(safe).toContain('Dostava: ________ KM');
    expect(checkCustomerReply(safe, CTX(null))).toEqual([]);
  });
});

describe('akcija traje do isteka zaliha (R19)', () => {
  it('requires the sentence when the customer asks about the action', () => {
    const ctx = { ...CTX(5), customerMessage: 'Dokad traje akcija na ovaj proizvod?' };
    const bad = checkCustomerReply('Akcija traje do kraja mjeseca.', ctx);
    expect(bad.map((i) => i.code)).toContain('action_duration_not_stated');
  });

  it('accepts the exact wording and does not treat it as warehouse talk', () => {
    const ctx = { ...CTX(5), customerMessage: 'Dokad traje akcija?' };
    const good = checkCustomerReply('Akcija traje do isteka zaliha.', ctx);
    expect(good).toEqual([]);
  });

  it('ne dodaje rečenicu uz običnu ponudu (R25)', () => {
    const issues = checkCustomerReply('Imamo 20% popusta na ovaj proizvod, dostava 15,00 KM.', CTX(5));
    expect(issues.map((i) => i.code)).not.toContain('action_duration_not_stated');
  });

  it('adds the sentence to the safe reply when asked how long the action lasts', () => {
    const safe = buildSafeReply({ ...CTX(5), customerMessage: 'Dokad traje akcija?' });
    expect(safe).toContain('Akcija traje do isteka zaliha.');
  });

  it('ne dodaje rečenicu kad kupac samo pita koliki je popust (R25)', () => {
    const safe = buildSafeReply({ ...CTX(5), customerMessage: 'Koliki je popust?' });
    expect(safe).not.toContain('Akcija traje do isteka zaliha.');
  });
});

describe('potvrda cijene (R20)', () => {
  it('rejects a bare confirmation without the amount', () => {
    const ctx = { ...CTX(5), customerMessage: 'Jel to ta cijena za ripado?' };
    const issues = checkCustomerReply('Da, to je ta cijena.', ctx);
    expect(issues.map((i) => i.code)).toContain('price_confirmation_missing');
  });

  it('accepts an answer that repeats the exact amount', () => {
    const ctx = { ...CTX(5), customerMessage: 'Jel to ta cijena?' };
    expect(checkCustomerReply('Da, cijena za RIPADO NOĆNI ORMARIĆ je 150,00 KM.', ctx)).toEqual([]);
  });

  it('accepts a corrected amount', () => {
    const ctx = { ...CTX(5), customerMessage: 'Je li ovo cijena tog artikla?' };
    expect(checkCustomerReply('Cijena je 150,00 KM.', ctx)).toEqual([]);
  });
});

describe('više dimenzija (R21)', () => {
  const ctxWithSizes = {
    ...CTX(5),
    customerMessage: 'Koliko kosta alba dnevna komoda?',
    dimensionOptions: [
      {
        productId: 'p1',
        options: [{ sizeKey: '180x80', label: '180 × 80 cm', available: true, price: 165, currency: 'BAM' }],
      },
    ],
  };

  it('traži da se pita koja dimenzija i navede dostupne', () => {
    const issues = checkCustomerReply('Cijena je 150,00 KM.', ctxWithSizes);
    expect(issues.map((i) => i.code)).toContain('dimension_choice_missing');
  });

  it('prihvata pitanje sa navedenim dimenzijama', () => {
    const body =
      'Imamo ovaj model u dimenzijama 180 × 40 cm i 180 × 80 cm. Koju dimenziju želite? Cijena je 150,00 KM.';
    const codes = checkCustomerReply(body, ctxWithSizes).map((i) => i.code);
    expect(codes).not.toContain('dimension_choice_missing');
  });

  it('ne pita kad je kupac sam napisao dimenziju', () => {
    const ctx = { ...ctxWithSizes, customerMessage: 'Koliko kosta alba komoda 180x80?' };
    const codes = checkCustomerReply('Cijena je 150,00 KM.', ctx).map((i) => i.code);
    expect(codes).not.toContain('dimension_choice_missing');
  });
});

describe('prodajni ciklus (R22)', () => {
  const product = CTX(1).products[0]!;
  const withDelivery = {
    ...CTX(1),
    customerMessage: 'Zanima me ovaj proizvod, ima li ga?',
    products: [product],
    deliveryAmount: { amount: 15, currency: 'BAM' },
    specPairs: [{ label: 'Boja', value: 'bijela' }, { label: 'Materijal', value: 'iverica' }],
  };

  it('traži cijenu dostave kad je težina poznata', () => {
    const codes = checkCustomerReply(
      'Proizvod košta 120,00 KM.\nTežina je 12 kg.',
      withDelivery,
    ).map((issue) => issue.code);
    expect(codes).toContain('delivery_price_missing');
  });

  it('prihvata odgovor sa cijenom dostave', () => {
    const codes = checkCustomerReply(
      'Proizvod košta 120,00 KM, a dostava 15,00 KM.\nTežina je 12 kg.',
      withDelivery,
    ).map((issue) => issue.code);
    expect(codes).not.toContain('delivery_price_missing');
  });

  it('traži podatke za narudžbu i rok 2–5 radnih dana', () => {
    const body = 'Proizvod košta 150,00 KM, dostava 15,00 KM.';
    const codes = checkCustomerReply(body, withDelivery).map((issue) => issue.code);
    expect(codes).toContain('order_data_missing');
  });

  it('podaci za narudžbu bez roka dostave su greška', () => {
    const body =
      'Proizvod košta 120,00 KM, dostava 15,00 KM.\nPošaljite ime i prezime, telefon, adresu, grad i poštanski broj.';
    const codes = checkCustomerReply(body, withDelivery).map((issue) => issue.code);
    expect(codes).toContain('delivery_eta_missing');
  });

  it('kompletan ciklus prolazi bez greške', () => {
    const body = [
      'Proizvod košta 150,00 KM, dostava 15,00 KM. Boja: bijela, materijal: iverica.',
      'Pošaljite ime i prezime, telefon, adresu, grad i poštanski broj.',
      'Dostava dolazi za 2–5 radnih dana.',
    ].join('\n');
    expect(checkCustomerReply(body, withDelivery).map((i) => i.code)).toEqual([]);
  });

  it('detalji se moraju navesti kad kupac pita za boju ili materijal', () => {
    const ctx = { ...withDelivery, customerMessage: 'Koje je boje i od kojeg materijala?' };
    const codes = checkCustomerReply('Ima ga, cijena 150,00 KM.', ctx).map((issue) => issue.code);
    expect(codes).toContain('specs_not_shared');
  });
});

describe('dimenzije sa cijenom i dostavom (R21)', () => {
  const base = CTX(1);
  const ctx = {
    ...base,
    customerMessage: 'Koliko kosta komoda?',
    dimensionOptions: [
      {
        productId: 'p1',
        options: [
          { sizeKey: '180x40', label: '180 × 40 cm', available: true, price: 100, currency: 'BAM', delivery: { amount: 15, currency: 'BAM' } },
          { sizeKey: '180x80', label: '180 × 80 cm', available: true, price: 165, currency: 'BAM', delivery: { amount: 25, currency: 'BAM' } },
        ],
      },
    ],
  };

  it('cijene drugih dimenzija nisu izmišljene', () => {
    const codes = checkCustomerReply(
      '180 × 40 cm košta 100,00 KM, dostava 15,00 KM. 180 × 80 cm košta 165,00 KM, dostava 25,00 KM. Koju dimenziju želite?',
      ctx,
    ).map((issue) => issue.code);
    expect(codes).not.toContain('invented_price');
    expect(codes).not.toContain('dimension_offer_incomplete');
  });

  it('traži cijenu i dostavu za svaku dimenziju', () => {
    const codes = checkCustomerReply('Imamo dimenzije 180 × 40 cm i 180 × 80 cm. Koju dimenziju želite?', ctx).map(
      (issue) => issue.code,
    );
    expect(codes).toContain('dimension_offer_incomplete');
  });

  it('sigurni šablon navodi svaku dimenziju sa cijenom i dostavom', () => {
    const safe = buildSafeReply(ctx).replace(/ | /g, ' ');
    expect(safe).toContain('180 × 40 cm');
    expect(safe).toContain('100,00 KM');
    expect(safe).toContain('dostava 15,00 KM');
    expect(safe).toContain('165,00 KM');
    expect(safe).toContain('Koju dimenziju želite?');
  });
});

describe('dostava uz svaku cijenu (praznina dok nema težine)', () => {
  const ctx = { ...CTX(null), customerMessage: 'Koliko kosta i koliko je dostava?' };

  it('prihvata prazninu „dostava: ______ KM” kao navedenu dostavu', () => {
    const codes = checkCustomerReply(
      'RIPADO komoda 150,00 KM, dostava: ________ KM. Dostava dolazi za 2–5 radnih dana.',
      ctx,
    ).map((issue) => issue.code);
    expect(codes).not.toContain('missing_weight_not_stated');
  });

  it('traži dostavu uz cijenu kada težina nije unesena', () => {
    const codes = checkCustomerReply('RIPADO komoda 150,00 KM. Dostava dolazi za 2–5 radnih dana.', ctx).map(
      (issue) => issue.code,
    );
    expect(codes).toContain('missing_weight_not_stated');
  });

  it('sigurna poruka nikad ne izmišlja iznos dostave', () => {
    const safe = buildSafeReply(ctx);
    expect(safe).toMatch(/Dostava: _{4,} KM/);
    expect(safe).not.toMatch(/dostava\s+\d+,\d{2}\s*KM/i);
  });
});

describe('potvrda narudžbe: zahvala i poštarina (R23)', () => {
  const confirmed = { ...CTX(null), customerMessage: 'Potvrdjujem narudzbu', orderConfirmed: true };

  it('traži zahvalu i poštarinu', () => {
    const codes = checkCustomerReply('Narudžba je zaprimljena. Dostava dolazi za 2–5 radnih dana.', confirmed).map(
      (issue) => issue.code,
    );
    expect(codes).toContain('order_thanks_missing');
    expect(codes).toContain('order_delivery_missing');
  });

  it('prihvata prazninu „Poštarina: ______ KM” kada nema težine', () => {
    const codes = checkCustomerReply(
      'Hvala Vam na narudžbi! Poštarina: ________ KM. Dostava dolazi za 2–5 radnih dana.',
      confirmed,
    ).map((issue) => issue.code);
    expect(codes).not.toContain('order_thanks_missing');
    expect(codes).not.toContain('order_delivery_missing');
  });

  it('prihvata stvarni iznos poštarine', () => {
    const codes = checkCustomerReply(
      'Hvala Vam na narudžbi! Poštarina iznosi 15,00 KM. Dostava dolazi za 2–5 radnih dana.',
      { ...confirmed, deliveryAmount: { amount: 15, currency: 'BAM' } },
    ).map((issue) => issue.code);
    expect(codes).not.toContain('order_delivery_missing');
  });

  it('sigurna poruka potvrde sadrži zahvalu i poštarinu', () => {
    const safe = buildSafeReply(confirmed);
    expect(safe).toContain('Hvala Vam na narudžbi');
    expect(safe).toMatch(/Poštarina|Dostava: _{4,} KM/);
  });
});

describe('R24: kupcu se ne piše da težina nedostaje', () => {
  it('kažnjava rečenicu o težini i o nemogućnosti obračuna dostave', () => {
    const body =
      'RIPADO NOĆNI ORMARIĆ 45X60CM košta 150,00 KM. Težina za ovaj proizvod nije unesena u naš sistem, pa dostavu ne možemo izračunati.';
    expect(checkCustomerReply(body, CTX(null)).map((i) => i.code)).toContain('weight_disclosed_to_customer');
  });

  it('prihvata samo prazninu za dostavu', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM košta 150,00 KM, dostava: ________ KM.';
    expect(checkCustomerReply(body, CTX(null)).map((i) => i.code)).not.toContain('weight_disclosed_to_customer');
  });
});

describe('R25: trajanje akcije samo kad kupac pita', () => {
  it('ne traži rečenicu kad kupac samo traži cijenu', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM je na akciji 150,00 KM, dostava 15,00 KM.';
    expect(
      checkCustomerReply(body, { ...CTX(5), customerMessage: 'Koliko kosta RIPADO nocni ormaric?' }).map((i) => i.code),
    ).not.toContain('action_duration_not_stated');
  });

  it('traži rečenicu kad kupac pita dokad traje akcija', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM je na akciji 150,00 KM, dostava 15,00 KM.';
    expect(
      checkCustomerReply(body, { ...CTX(5), customerMessage: 'Dokad traje akcija?' }).map((i) => i.code),
    ).toContain('action_duration_not_stated');
  });
});

describe('R26: nudi samo ono što je na stanju', () => {
  const outOfStock = {
    product: product({
      id: 'p2',
      name: 'AURA KOMODA LADIČAR 3 LADICE',
      price: 80,
      availability: { status: 'out_of_stock', checkedAt: null, source: 'products.json', raw: null },
      variants: [{ id: 'v2', title: 'Default', price: 80, compareAtPrice: null, available: false, sku: null, options: {} }],
    }),
    additional: null,
  };

  it('kažnjava poruku koja nudi proizvod koji nije na stanju', () => {
    const body = 'Imamo AURA KOMODA LADIČAR 3 LADICE po cijeni 80,00 KM, dostava 20,00 KM.';
    const codes = checkCustomerReply(body, { ...CTX(5), products: [outOfStock] }).map((i) => i.code);
    expect(codes).toContain('unavailable_product_offered');
  });

  it('prihvata poruku koja nudi samo dostupno', () => {
    const body = 'AURA KOMODA LADIČAR 4 LADICE je na stanju, cijena 130,00 KM, dostava 20,00 KM.';
    const codes = checkCustomerReply(body, { ...CTX(5), products: [outOfStock] }).map((i) => i.code);
    expect(codes).not.toContain('unavailable_product_offered');
  });
});

describe('R27: popust na količinu nije objavljen', () => {
  it('kažnjava izmišljeni procenat za više komada', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM košta 150,00 KM, dostava 15,00 KM. Za 2 komada popust 5%.';
    expect(checkCustomerReply(body, CTX(5)).map((i) => i.code)).toContain('quantity_discount_invented');
  });

  it('prihvata odgovor bez procenta', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM košta 150,00 KM, dostava 15,00 KM. Za količinu ćemo provjeriti i javiti tačan iznos.';
    expect(checkCustomerReply(body, CTX(5)).map((i) => i.code)).not.toContain('quantity_discount_invented');
  });
});

describe('R28: procenat smije biti samo podešeni prag', () => {
  it('dozvoljava podešeni prag (2 kom = 5%)', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM košta 150,00 KM, dostava 15,00 KM. Za 2 komada popust 5%.';
    const codes = checkCustomerReply(body, {
      ...CTX(5),
      quantityDiscounts: [{ minQuantity: 2, percent: 5 }],
    }).map((i) => i.code);
    expect(codes).not.toContain('quantity_discount_invented');
  });

  it('kažnjava procenat kojeg nema u Postavkama (3 kom = 12%)', () => {
    const body = 'RIPADO NOĆNI ORMARIĆ 45X60CM košta 150,00 KM, dostava 15,00 KM. Za 3 komada popust 12%.';
    const codes = checkCustomerReply(body, {
      ...CTX(5),
      quantityDiscounts: [{ minQuantity: 2, percent: 5 }],
    }).map((i) => i.code);
    expect(codes).toContain('quantity_discount_invented');
  });
});

describe('potpunost ponude („koje grebalice imate”)', () => {
  const offerList = [
    { name: 'BIFROST PENJALICA GREBALICA ZA MAČKE 58X200CM MT51', price: '180,00 KM', amount: 180, note: null },
    { name: 'HILI PENJALICA GREBALICA ZA MAČKE 38X48CM MD01', price: '30,00 KM', amount: 30, note: null },
  ];

  it('prihvata odgovor koji navodi sve stavke sa tačnim cijenama', () => {
    const body =
      'u ponudi imamo:\n- BIFROST PENJALICA GREBALICA ZA MAČKE 58X200CM MT51: 180,00 KM\n- HILI PENJALICA GREBALICA ZA MAČKE 38X48CM MD01: 30,00 KM\ndostava: ________ KM';
    const codes = checkCustomerReply(body, { ...CTX(5), offerList }).map((issue) => issue.code);
    expect(codes).not.toContain('offer_list_incomplete');
    expect(codes).not.toContain('invented_price');
  });

  it('hvata preskočenu stavku i dopunjava je deterministički', () => {
    const body = 'u ponudi imamo:\n- BIFROST PENJALICA GREBALICA ZA MAČKE 58X200CM MT51: 180,00 KM';
    const ctx = { ...CTX(5), offerList };
    const issues = checkCustomerReply(body, ctx);
    expect(issues.map((issue) => issue.code)).toContain('offer_list_incomplete');
    const patched = applyDeterministicFixes(body, ctx, issues);
    expect(patched).toContain('HILI');
    expect(checkCustomerReply(patched, ctx).map((issue) => issue.code)).not.toContain('offer_list_incomplete');
  });
});

describe('link na kategoriju kada kupac pita šta sve imate', () => {
  const url = 'https://giga.ba/collections/penjalice-grebalice-za-macke';
  const ctx = {
    ...CTX(5),
    offerLink: url,
    offerLinkLine: `Sve modele možete pogledati ovdje: ${url}`,
    offerCategory: 'GIGA penjalice/grebalice za mačke',
  };

  it('hvata odgovor bez linka i dodaje ga', () => {
    const body = 'Imamo više modela penjalica za mačke. Koji Vam se sviđa?';
    const issues = checkCustomerReply(body, ctx);
    expect(issues.map((issue) => issue.code)).toContain('offer_link_missing');
    const patched = applyDeterministicFixes(body, ctx, issues);
    expect(patched).toContain(url);
    expect(patched).toContain('koji model Vam se sviđa');
    expect(checkCustomerReply(patched, ctx).map((issue) => issue.code)).not.toContain('offer_link_missing');
  });

  it('sigurna poruka sadrži link, a ne nabrajanje', () => {
    const safe = buildSafeReply(ctx);
    expect(safe).toContain(url);
    expect(safe).toContain('Recite nam koji model');
  });
});

describe('R29 — ime i prezime', () => {
  it('ispravi „ime, prezimenom” u „ime i prezime”', () => {
    const body =
      'AURA KOMODA je dostupna po cijeni od 130,00 KM.\n\nMolimo Vas da nam pošaljete Vaše ime, prezimenom, kontakt telefon, adresu, grad i poštanski broj.';
    const fixed = applyDeterministicFixes(body, { products: [{ product: product(), additional: null }], customerMessage: '' }, []);
    expect(fixed).toContain('ime i prezime');
    expect(fixed).not.toMatch(/prezimenom/i);
  });

  it('ne pravi duplikat kad je već ispravno', () => {
    const body = 'Molimo Vas da nam pošaljete ime i prezime i adresu.';
    const fixed = applyDeterministicFixes(body, { products: [{ product: product(), additional: null }], customerMessage: '' }, []);
    expect(fixed).toContain('ime i prezime');
    expect(fixed).not.toContain('prezime i prezime');
  });
});
