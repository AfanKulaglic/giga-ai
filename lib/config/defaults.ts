import type {
  AIConfiguration,
  AppSettings,
  CalculatorConfig,
  CompanyProcedure,
  CompanySignature,
  OrderFormConfiguration,
  QuickReply,
} from '@/lib/domain/types';
import { renderSignature } from '@/lib/domain/signature';

// ---------------------------------------------------------------------------
// Seed configuration.
//
// IMPORTANT: only the one business rule that was explicitly supplied is marked
// verified. Everything else is an empty, editable placeholder so the app never
// invents GIGA.ba policy, prices, or reply content.
// ---------------------------------------------------------------------------

export const SEED_VERSION = 1;

export function defaultSignature(): CompanySignature {
  return {
    signOff: 'S poštovanjem,',
    agentName: '',
    companyName: 'GIGA.ba',
    website: '',
    template: '{signOff}\n{agentName}\n{companyName}\n{website}',
    updatedAt: new Date(0).toISOString(),
  };
}

export function isSignatureConfigured(sig: CompanySignature): boolean {
  return Boolean(sig.agentName.trim() && sig.companyName.trim());
}

export function defaultProcedures(userId: string): CompanyProcedure[] {
  const base = { userId, keywords: [] as string[], verified: false, updatedAt: new Date(0).toISOString() };
  return [
    {
      ...base,
      id: 'showroom',
      topic: 'showroom',
      title: 'Fizička prodavnica / salon',
      keywords: ['salon', 'prodavnica', 'poslovnica', 'lokacija', 'adresa', 'razgledati', 'uživo', 'posjetiti'],
      answer:
        'GIGA.ba posluje isključivo online, putem internet prodaje i dostave. Nemamo fizički salon u kojem je moguće razgledati proizvode.',
      verified: true,
    },
    {
      ...base,
      id: 'delivery',
      topic: 'delivery',
      title: 'Dostava',
      keywords: ['dostava', 'isporuka', 'poštarina', 'kurir', 'rok dostave', 'kada stiže'],
      answer: '',
    },
    {
      ...base,
      id: 'payment',
      topic: 'payment',
      title: 'Načini plaćanja',
      keywords: ['plaćanje', 'plačanje', 'pouzećem', 'kartica', 'račun', 'avans', 'uplatnica'],
      answer: '',
    },
    {
      ...base,
      id: 'warranty',
      topic: 'warranty',
      title: 'Garancija',
      keywords: ['garancija', 'garantni', 'jamstvo', 'kvara'],
      answer: '',
    },
    {
      ...base,
      id: 'returns',
      topic: 'returns',
      title: 'Povrat i povrat novca',
      keywords: ['povrat', 'vraćanje', 'refund', 'novac nazad', 'odustanak'],
      answer: '',
    },
    {
      ...base,
      id: 'complaints',
      topic: 'complaints',
      title: 'Reklamacije',
      keywords: ['reklamacija', 'žalba', 'nezadovoljan', 'oštećen', 'neispravan'],
      answer: '',
    },
    {
      ...base,
      id: 'company_info',
      topic: 'company_info',
      title: 'Osnovne informacije o firmi',
      keywords: ['giga', 'firma', 'preduzeće', 'kontakt', 'email', 'telefon'],
      answer: '',
    },
  ];
}

const QR = (id: string, label: string, category: string, sortOrder: number, message: string): QuickReply => ({
  id,
  userId: 'seed',
  label,
  category,
  message,
  sortOrder,
  requiresReview: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

/** Labels are from the brief; message bodies are explicit placeholders. */
export function defaultQuickReplies(userId: string): QuickReply[] {
  return [
    QR('qr_refund', 'Rok za povrat novca', 'Povrat', 10, '[DOPUNITI tekst — rok za povrat novca prema vašim uslovima]'),
    QR('qr_delivery', 'Informacije o dostavi', 'Dostava', 20, '[DOPUNITI tekst — način, rok i cijena dostave]'),
    QR('qr_complaint', 'Reklamacija', 'Reklamacije', 30, '[DOPUNITI tekst — procedura reklamacije]'),
    QR('qr_warranty', 'Garancija', 'Garancija', 40, '[DOPUNITI tekst — uslovi garancije]'),
    QR('qr_confirm', 'Potvrda narudžbe', 'Narudžbe', 50, '[DOPUNITI tekst — potvrda zaprimljene narudžbe]'),
    QR('qr_thanks', 'Zahvala kupcu', 'Opšte', 60, '[DOPUNITI tekst — zahvala kupcu]'),
    QR('qr_payment', 'Informacije o plaćanju', 'Plaćanje', 70, '[DOPUNITI tekst — načini plaćanja]'),
    QR('qr_delay', 'Obavijest o kašnjenju', 'Dostava', 80, '[DOPUNITI tekst — obavijest o kašnjenju isporuke]'),
  ].map((q) => ({ ...q, userId }));
}

export function defaultCalculatorConfig(): CalculatorConfig {
  return {
    currency: 'BAM',
    pricesIncludeTax: null,
    // Delivery at GIGA.ba is always priced by weight, so a by-weight rule
    // is enabled by default and priced from the tiers below.
    deliveryRules: [
      {
        id: 'del_weight',
        name: 'Dostava po težini',
        type: 'by_weight',
        enabled: true,
        amount: null,
        freeAbove: null,
        note: 'Cijena zavisi od ukupne težine narudžbe.',
      },
    ],
    // Weight bands the owner asked for: 10 kg → 10 KM, 20 kg → 15 KM, 30 kg → 20 KM.
    weightTiers: [
      { id: 'wt_10', upToKg: 10, amount: 10, enabled: true, note: null },
      { id: 'wt_20', upToKg: 20, amount: 12, enabled: true, note: null },
      { id: 'wt_30', upToKg: 30, amount: 15, enabled: true, note: null },
      { id: 'wt_40', upToKg: 40, amount: 25, enabled: true, note: null },
      { id: 'wt_50', upToKg: 50, amount: 30, enabled: true, note: null },
      { id: 'wt_60', upToKg: 60, amount: 40, enabled: true, note: null },
      { id: 'wt_70', upToKg: 70, amount: 42, enabled: true, note: null },
      { id: 'wt_80', upToKg: 80, amount: 45, enabled: true, note: null },
      { id: 'wt_90', upToKg: 90, amount: 55, enabled: true, note: null },
      { id: 'wt_100', upToKg: 100, amount: 60, enabled: true, note: null },
    ],
    // Popust na količinu istog proizvoda (mijenja se u Postavke -> Kalkulator).
    discountRules: [
      {
        id: 'qty_2',
        name: '2 ista proizvoda — 5%',
        type: 'quantity',
        enabled: true,
        productIds: [],
        minQuantity: 2,
        minSubtotal: null,
        percent: 5,
        amount: null,
        note: 'Popust važi samo za isti proizvod naručen 2 ili više puta. Različiti proizvodi se ne sabiraju.',
        priority: 10,
        stackable: false,
      },
      {
        id: 'qty_5',
        name: '5 istih proizvoda — 7%',
        type: 'quantity',
        enabled: true,
        productIds: [],
        minQuantity: 5,
        minSubtotal: null,
        percent: 7,
        amount: null,
        note: 'Popust važi samo za isti proizvod naručen 5 ili više puta.',
        priority: 20,
        stackable: false,
      },
      {
        id: 'qty_10',
        name: '10 istih proizvoda — 10%',
        type: 'quantity',
        enabled: true,
        productIds: [],
        minQuantity: 10,
        minSubtotal: null,
        percent: 10,
        amount: null,
        note: 'Popust važi samo za isti proizvod naručen 10 ili više puta.',
        priority: 30,
        stackable: false,
      },
    ],
    // No delivery pricing was supplied, so nothing is invented: the calculator
    // asks for manual confirmation instead of charging an invented amount.
    deliveryPolicy: 'rules',
    updatedAt: new Date(0).toISOString(),
  };
}

export function defaultOrderForm(): OrderFormConfiguration {
  const f = (
    id: string,
    key: string,
    label: string,
    type: 'text' | 'multiline' | 'number' | 'select' | 'tel' | 'email',
    required: boolean,
    sortOrder: number,
    source:
      | 'customer.name'
      | 'customer.phone'
      | 'customer.email'
      | 'customer.address'
      | 'customer.city'
      | 'customer.postalCode'
      | 'order.products'
      | 'order.itemsBreakdown'
      | 'order.total'
      | 'order.itemsTotal'
      | 'order.delivery'
      | 'order.discount'
      | 'order.note'
      | 'manual',
  ) => ({
    id,
    key,
    label,
    type,
    required,
    sortOrder,
    source,
    defaultValue: null,
    placeholder: null,
    validation: null,
    // Provisional until the real GigaHub form schema is supplied.
    provisional: true,
  });

  return {
    fields: [
      f('f_name', 'customer_name', 'Ime i prezime kupca', 'text', true, 10, 'customer.name'),
      f('f_phone', 'customer_phone', 'Telefon', 'tel', true, 20, 'customer.phone'),
      f('f_address', 'customer_address', 'Adresa', 'text', true, 30, 'customer.address'),
      f('f_city', 'customer_city', 'Grad', 'text', true, 40, 'customer.city'),
      f('f_postal', 'customer_postal', 'Poštanski broj', 'text', false, 50, 'customer.postalCode'),
      f('f_products', 'products', 'Proizvodi (naziv × količina)', 'multiline', true, 60, 'order.itemsBreakdown'),
      // Cijena proizvoda i dostava su DVA odvojena polja: GigaHub traži iznos
      // robe bez poštarine, a poštarinu posebno. Nema više „ukupno” polja.
      f('f_items', 'items_total', 'Cijena proizvoda (bez dostave)', 'text', true, 70, 'order.itemsTotal'),
      f('f_delivery', 'delivery', 'Dostava', 'text', true, 80, 'order.delivery'),
      f('f_note', 'note', 'Napomena', 'multiline', false, 90, 'order.note'),
    ],
    updatedAt: new Date(0).toISOString(),
  };
}

export function defaultAIConfig(): AIConfiguration {
  return {
    additionalInstructions: '',
    responseStyle: 'balanced',
    protectedRulesVersion: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

export function defaultSettings(): AppSettings {
  return {
    signature: defaultSignature(),
    ai: defaultAIConfig(),
    calculator: defaultCalculatorConfig(),
    orderForm: defaultOrderForm(),
    updatedAt: new Date(0).toISOString(),
  };
}

export function signaturePreview(sig: CompanySignature): string {
  return renderSignature(sig);
}
