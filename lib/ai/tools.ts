import 'server-only';
import { z } from 'zod';
import { formatMoney } from '@/lib/domain/money';
import { calculateOrder } from '@/lib/domain/calculator';
import {
  addOutstandingQuestion,
  mergeCustomerDetails,
  normalizeContextProduct,
  resolveOutstandingQuestions,
  serializeContext,
  setOrderIntent,
  upsertContextProduct,
} from '@/lib/domain/sessionContext';
import { identifyProduct, searchProductCatalog } from '@/lib/domain/productSearch';
import { lookupPostalCodes } from '@/lib/domain/postalCodes';
import type {
  AiCitation,
  AiToolTrace,
  AppSettings,
  CompanyProcedure,
  CustomerSession,
  Product,
  ProductAdditionalData,
  SessionContext,
} from '@/lib/domain/types';
import type { Store } from '@/lib/store/types';
import type { ToolDefinition } from './client';

export interface ToolContext {
  userId: string;
  sessionId: string;
  session: CustomerSession;
  store: Store;
  settings: AppSettings;
  procedures: CompanyProcedure[];
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data: unknown;
  citations: AiCitation[];
  /** Catalogue products the tool actually touched; used to remember the session. */
  productIds: string[];
  trace: AiToolTrace;
}

const truncate = (text: string | null | undefined, max = 1200): string | null =>
  text ? (text.length > max ? `${text.slice(0, max)}…` : text) : null;

function productSummary(p: Product, additional?: ProductAdditionalData | null) {
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    brand: p.brand,
    category: p.category,
    url: p.url,
    price: p.price,
    currency: p.currency,
    compareAtPrice: p.compareAtPrice,
    discountPercent: p.discountPercent,
    availability: p.availability,
    variants: p.variants.slice(0, 12).map((v) => ({
      title: v.title,
      sku: v.sku,
      price: v.price,
      available: v.available,
    })),
    shortDescription: p.shortDescription,
    specifications: p.specifications,
    additionalFields: additional?.fields.map((f) => ({ name: f.fieldName, value: f.value, unit: f.unit, note: f.note })) ?? [],
    weightKg: additional?.weightKg ?? null,
    weightEntered: typeof additional?.weightKg === 'number' && additional.weightKg > 0,
    deliveryNote:
      typeof additional?.weightKg === 'number' && additional.weightKg > 0
        ? 'Dostava se računa po težini.'
        : 'Težina nije unesena u sistem — cijenu dostave nije moguće izračunati. Reci to kupcu, ne nagađaj.',
    dimensionsCm: additional?.dimensionsCm ?? null,
    dimensionsEntered: Boolean(
      additional?.dimensionsCm &&
        [additional.dimensionsCm.lengthCm, additional.dimensionsCm.widthCm, additional.dimensionsCm.heightCm].some(
          (v) => typeof v === 'number' && v > 0,
        ),
    ),
    source: p.source,
    sourceUrl: p.url,
    sourceUpdatedAt: p.sourceUpdatedAt,
    scrapedAt: p.scrapedAt,
    missingFields: p.missingFields,
    extractionStatus: p.extractionStatus,
  };
}

const toolsDefs: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'searchProducts',
      description:
        'Pretraži GIGA.ba katalog proizvoda. Koristi SAMO kada pitanje zahtijeva podatke o konkretnom proizvodu (cijena, specifikacije, dostupnost). Ne koristi za opšta pitanja o firmi, dostavi, plaćanju, garanciji ili povratu.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Naziv, dio naziva ili SKU proizvoda.' },
          limit: { type: 'number', description: 'Maksimalan broj rezultata (1–10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProduct',
      description: 'Vrati pune podatke jednog proizvoda iz kataloga, uključujući ručno dodane specifikacije.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProductAvailability',
      description:
        'Vrati zabilježenu dostupnost proizvoda i vrijeme provjere. Postojanje proizvoda ne znači da je na stanju.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProductSpecifications',
      description: 'Vrati tehničke specifikacije iz izvora i ručno dodane specifikacije, uz naznake konflikata.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCompanyProcedure',
      description:
        'Vrati konfigurisanu proceduru firme (salon, dostava, plaćanje, garancija, povrat, reklamacije). Obavezno koristi za opšta pitanja umjesto pretrage kataloga. Ako je procedura nekonfigurisana, prenesi to agentu.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['showroom', 'delivery', 'payment', 'warranty', 'returns', 'complaints', 'company_info', 'other'],
          },
          query: { type: 'string', description: 'Tekst pitanja radi pronalaženja procedure po ključnim riječima.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSessionContext',
      description: 'Vrati strukturirani kontekst trenutne sesije (proizvodi, status narudžbe, nedostajući podaci).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateSessionContext',
      description:
        'Ažuriraj strukturirani kontekst sesije kada saznaš provjerene činjenice iz razgovora. Koristi samo podatke koje je kupac ili agent izričito naveo. Za proizvode koristi isključivo productId dobijene iz kataloga.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Ažurirani sažetak razgovora (opciono).' },
          products: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string' },
                quantity: { type: 'number' },
                note: { type: 'string' },
              },
              required: ['productId'],
            },
          },
          customer: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' },
              address: { type: 'string' },
              city: { type: 'string' },
              postalCode: { type: 'string' },
              note: { type: 'string' },
            },
          },
          orderIntent: { type: 'string', enum: ['unknown', 'browsing', 'interested', 'confirmed', 'declined'] },
          orderIntentConfidence: { type: 'number' },
          confirmedFacts: { type: 'array', items: { type: 'string' } },
          missingInfo: { type: 'array', items: { type: 'string' } },
          outstandingQuestions: { type: 'array', items: { type: 'string' } },
          resolvedFacts: { type: 'array', items: { type: 'string' } },
          agentCorrections: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculateOrder',
      description:
        'Deterministički izračun narudžbe iz kataloških cijena i konfigurisanih pravila. Koristi za sve izračune; nikada ne računaj ručno.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string' },
                quantity: { type: 'number' },
              },
              required: ['productId', 'quantity'],
            },
          },
          deliveryRuleId: { type: 'string' },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listQuickReplies',
      description: 'Vrati spisak konfigurisanih brzih odgovora (naziv, kategorija, sadržaj).',
      parameters: {
        type: 'object',
        properties: { category: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookupPostalCode',
      description:
        'Vrati tačan poštanski broj za grad ili naselje u BiH iz sistemske baze (577 pošta). Obavezno koristi za narudžbe i adrese. Ako vrati prazno, poštanski broj NIJE potvrđen — ne izmišljaj ga.',
      parameters: {
        type: 'object',
        properties: {
          place: { type: 'string', description: 'Naziv grada ili naselja, npr. "Zenica", "Banja Luka", ili petocifreni broj.' },
        },
        required: ['place'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getOrderFormConfiguration',
      description: 'Vrati konfiguraciju polja GigaHub obrasca (redoslijed, obaveznost, izvor podataka).',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const argsSchemas = {
  searchProducts: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(10).optional() }),
  getProduct: z.object({ productId: z.string().min(1) }),
  getProductAvailability: z.object({ productId: z.string().min(1) }),
  getProductSpecifications: z.object({ productId: z.string().min(1) }),
  getCompanyProcedure: z.object({
    topic: z
      .enum(['showroom', 'delivery', 'payment', 'warranty', 'returns', 'complaints', 'company_info', 'other'])
      .optional(),
    query: z.string().max(300).optional(),
  }),
  getSessionContext: z.object({}),
  updateSessionContext: z.object({
    summary: z.string().max(4000).optional(),
    products: z
      .array(z.object({ productId: z.string(), quantity: z.number().int().positive().optional(), note: z.string().max(300).optional() }))
      .max(20)
      .optional(),
    customer: z
      .object({
        name: z.string().max(120).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().max(120).optional(),
        address: z.string().max(200).optional(),
        city: z.string().max(80).optional(),
        postalCode: z.string().max(20).optional(),
        note: z.string().max(300).optional(),
      })
      .optional(),
    orderIntent: z.enum(['unknown', 'browsing', 'interested', 'confirmed', 'declined']).optional(),
    orderIntentConfidence: z.number().min(0).max(1).optional(),
    confirmedFacts: z.array(z.string().max(300)).max(20).optional(),
    missingInfo: z.array(z.string().max(300)).max(20).optional(),
    outstandingQuestions: z.array(z.string().max(300)).max(20).optional(),
    resolvedFacts: z.array(z.string().max(300)).max(20).optional(),
    agentCorrections: z.array(z.string().max(300)).max(20).optional(),
  }),
  calculateOrder: z.object({
    items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1).max(30),
    deliveryRuleId: z.string().optional(),
  }),
  listQuickReplies: z.object({ category: z.string().max(80).optional() }),
  lookupPostalCode: z.object({ place: z.string().min(2).max(120) }),
  getOrderFormConfiguration: z.object({}),
} satisfies Record<string, z.ZodTypeAny>;

function mergeUnique(base: string[], additions: string[], max = 30): string[] {
  const seen = new Set(base.map((s) => s.toLowerCase()));
  const out = [...base];
  for (const a of additions) {
    const key = a.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(a.trim());
    }
  }
  return out.slice(-max);
}

async function findProductById(ctx: ToolContext, productId: string): Promise<Product | null> {
  const direct = await ctx.store.getProduct(productId);
  if (direct) return direct;
  // Accept a raw Shopify source id too.
  if (!productId.startsWith('giga_')) return ctx.store.getProduct(`giga_${productId}`);
  return null;
}

export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const build = async (
    ok: boolean,
    summary: string,
    data: unknown,
    citations: AiCitation[] = [],
    productIds: string[] = [],
  ): Promise<ToolResult> => ({
    ok,
    summary,
    data,
    citations,
    productIds,
    trace: { name, args: rawArgs, ok, summary, citations },
  });

  try {
    switch (name) {
      case 'searchProducts': {
        const args = argsSchemas.searchProducts.parse(rawArgs);
        const hits = searchProductCatalog(
          // Bounded catalogue scan is delegated to the store for Firestore.
          await ctx.store.searchProducts(args.query, Math.max(args.limit ?? 6, 8)),
          args.query,
          args.limit ?? 6,
        );
        if (!hits.length) {
          return build(true, `Nema rezultata za "${args.query}".`, { query: args.query, results: [] });
        }
        const identification = identifyProduct(
          await ctx.store.searchProducts(args.query, 8),
          args.query,
        );
        const results = await Promise.all(
          hits.map(async (h) => ({
            score: h.score,
            matchedOn: h.matchedOn,
            ...productSummary(h.product, await ctx.store.getProductAdditional(h.product.id)),
          })),
        );
        const ambiguous = identification.confidence === 'ambiguous' || identification.confidence === 'none';
        return build(
          true,
          ambiguous
            ? `Pronađeno ${results.length} mogućih proizvoda za "${args.query}" — potrebno pojašnjenje agenta.`
            : `Pronađen proizvod: ${hits[0]!.product.name}.`,
          {
            query: args.query,
            identification: { confidence: identification.confidence, reason: identification.reason },
            ambiguous,
            // The shopper may have mistyped the name ("pulsat" -> "pulsar");
            // the assistant then offers the real product without correcting them.
            typos: hits[0]?.typos ?? [],
            results,
          },
          results.map((r) => ({
            kind: 'product',
            label: `${r.name}${r.sku ? ` (SKU ${r.sku})` : ''}`,
            url: r.url,
            detail: `Katalog GIGA.ba, provjereno ${r.scrapedAt ?? 'nepoznato'}`,
            updatedAt: r.scrapedAt ?? undefined,
          })),
          results.map((r) => r.productId),
        );
      }

      case 'getProduct': {
        const { productId } = argsSchemas.getProduct.parse(rawArgs);
        const product = await findProductById(ctx, productId);
        if (!product) {
          return build(false, `Proizvod ${productId} nije u katalogu.`, { error: 'not_found', productId });
        }
        const additional = await ctx.store.getProductAdditional(product.id);
        const citations: AiCitation[] = [
          { kind: 'product', label: product.name, url: product.url, detail: `Katalog, provjereno ${product.scrapedAt}` },
        ];
        if (additional?.fields.length) {
          citations.push({
            kind: 'additional_data',
            label: `Ručno dodane specifikacije (${additional.fields.length})`,
            detail: `Ažurirano ${additional.updatedAt}`,
            updatedAt: additional.updatedAt,
          });
        }
        return build(true, `Podaci za ${product.name}.`, {
          ...productSummary(product, additional),
          description: truncate(product.descriptionHtml ? product.descriptionHtml.replace(/<[^>]+>/g, ' ') : null, 1600),
        }, citations, [product.id]);
      }

      case 'getProductAvailability': {
        const { productId } = argsSchemas.getProductAvailability.parse(rawArgs);
        const product = await findProductById(ctx, productId);
        if (!product) return build(false, `Proizvod ${productId} nije u katalogu.`, { error: 'not_found' });
        return build(
          true,
          `Dostupnost: ${product.availability.status} (provjereno ${product.availability.checkedAt ?? 'nepoznato'}).`,
          {
            productId: product.id,
            name: product.name,
            availability: product.availability,
            variants: product.variants.map((v) => ({ title: v.title, available: v.available })),
            note:
              product.availability.status === 'unknown' || product.availability.status === 'not_verified'
                ? 'Dostupnost nije moguće pouzdano potvrditi iz izvora.'
                : 'Dostupnost je izvedena iz podataka izvora u navedenom trenutku.',
          },
          [
            {
              kind: 'product',
              label: `${product.name} — dostupnost`,
              url: product.url,
              detail: `Provjereno ${product.availability.checkedAt ?? 'nepoznato'} (${product.availability.source})`,
            },
          ],
        );
      }

      case 'getProductSpecifications': {
        const { productId } = argsSchemas.getProductSpecifications.parse(rawArgs);
        const product = await findProductById(ctx, productId);
        if (!product) return build(false, `Proizvod ${productId} nije u katalogu.`, { error: 'not_found' });
        const additional = await ctx.store.getProductAdditional(product.id);
        const addMap = new Map((additional?.fields ?? []).map((f) => [f.fieldName.toLowerCase(), f]));
        const conflicts = Object.entries(product.specifications ?? {})
          .filter(([k]) => addMap.has(k.toLowerCase()))
          .map(([k, v]) => ({ field: k, scraped: v, manual: addMap.get(k.toLowerCase())!.value }));
        return build(
          true,
          `Specifikacije: ${Object.keys(product.specifications).length} iz izvora, ${additional?.fields.length ?? 0} ručnih.`,
          {
            productId: product.id,
            name: product.name,
            scraped: product.specifications,
            // Material, dimensions and use are often only in the description.
            description:
              (product.shortDescription ??
                (product.descriptionHtml ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())?.slice(0, 900) ||
              null,
            manual: (additional?.fields ?? []).map((f) => ({
              field: f.fieldName,
              value: f.value,
              unit: f.unit,
              addedAt: f.addedAt,
              note: f.note,
            })),
            conflicts,
            missing: product.missingFields,
            source: product.url,
            scrapedAt: product.scrapedAt,
          },
          [
            { kind: 'product', label: `${product.name} — specifikacije`, url: product.url, detail: `Katalog, ${product.scrapedAt}` },
            ...(additional?.fields.length
              ? [{ kind: 'additional_data' as const, label: 'Ručno dodane specifikacije', updatedAt: additional.updatedAt }]
              : []),
          ],
        );
      }

      case 'getCompanyProcedure': {
        const args = argsSchemas.getCompanyProcedure.parse(rawArgs);
        let proc: CompanyProcedure | undefined;
        if (args.topic) proc = ctx.procedures.find((p) => p.topic === args.topic);
        if (!proc && args.query) {
          const q = args.query.toLowerCase();
          proc = ctx.procedures
            .map((p) => ({ p, score: p.keywords.filter((k) => q.includes(k.toLowerCase())).length }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)[0]?.p;
        }
        if (!proc) {
          return build(true, 'Procedura nije pronađena ni konfigurisana.', {
            found: false,
            message: 'Odgovarajuća procedura nije unesena u Postavkama. Ne izmišljaj odgovor.',
          });
        }
        return build(
          true,
          proc.verified ? `Procedura: ${proc.title}.` : `Procedura "${proc.title}" nije konfigurisana.`,
          {
            topic: proc.topic,
            title: proc.title,
            verified: proc.verified,
            answer: proc.verified ? proc.answer : '',
            note: proc.verified ? null : 'Nije konfigurisano — agent mora unijeti sadržaj u Postavkama.',
            updatedAt: proc.updatedAt,
          },
          proc.verified
            ? [{ kind: 'procedure', label: proc.title, detail: 'Konfigurisana procedura firme', updatedAt: proc.updatedAt }]
            : [],
        );
      }

      case 'getSessionContext': {
        return build(true, 'Kontekst sesije.', {
          sessionId: ctx.sessionId,
          label: ctx.session.label,
          context: ctx.session.context,
          serialized: serializeContext(ctx.session.context),
        });
      }

      case 'updateSessionContext': {
        const args = argsSchemas.updateSessionContext.parse(rawArgs);
        const latest = (await ctx.store.getSession(ctx.userId, ctx.sessionId)) ?? ctx.session;
        let context: SessionContext = { ...latest.context };

        if (args.summary?.trim()) context.summary = args.summary.trim();
        if (args.products?.length) {
          for (const item of args.products) {
            const product = await findProductById(ctx, item.productId);
            if (!product) {
              return build(false, `Nepoznat productId "${item.productId}" — kontekst nije ažuriran.`, {
                error: 'unknown_product',
                productId: item.productId,
                hint: 'Koristi productId iz searchProducts rezultata.',
              });
            }
            const normalized = normalizeContextProduct({
              productId: product.id,
              name: product.name,
              sku: product.sku,
              unitPrice: product.price,
              currency: product.currency,
              quantity: item.quantity ?? null,
              priceCheckedAt: product.scrapedAt,
              priceSource: 'scraped',
              note: item.note,
            });
            if (normalized) context = upsertContextProduct(context, normalized);
          }
        }
        if (args.customer) context = mergeCustomerDetails(context, args.customer);
        if (args.orderIntent) context = setOrderIntent(context, args.orderIntent, args.orderIntentConfidence ?? 0.6);
        if (args.confirmedFacts?.length) context.confirmedFacts = mergeUnique(context.confirmedFacts, args.confirmedFacts);
        if (args.missingInfo) context.missingInfo = mergeUnique([], args.missingInfo, 15);
        if (args.agentCorrections?.length) context.agentCorrections = mergeUnique(context.agentCorrections, args.agentCorrections);
        if (args.outstandingQuestions?.length) {
          for (const q of args.outstandingQuestions) context = addOutstandingQuestion(context, q);
        }
        if (args.resolvedFacts?.length) {
          for (const fact of args.resolvedFacts) context = resolveOutstandingQuestions(context, fact);
        }

        const updated = await ctx.store.updateSession(ctx.userId, ctx.sessionId, { context });
        ctx.session = updated;
        return build(true, 'Kontekst sesije je ažuriran.', {
          context: updated.context,
          serialized: serializeContext(updated.context),
        });
      }

      case 'calculateOrder': {
        const args = argsSchemas.calculateOrder.parse(rawArgs);
        const products = await ctx.store.getProductsByIds(args.items.map((i) => i.productId));
        const missing = args.items.filter((i) => !products.some((p) => p.id === i.productId));
        if (missing.length) {
          return build(false, 'Neki proizvodi nisu u katalogu — izračun nije moguć.', {
            error: 'unknown_products',
            productIds: missing.map((m) => m.productId),
          });
        }
        const result = calculateOrder({
          items: args.items.map((i) => {
            const p = products.find((x) => x.id === i.productId)!;
            return {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              unitPrice: p.price,
              quantity: i.quantity,
              currentCatalogPrice: p.price,
              priceCheckedAt: p.scrapedAt,
            };
          }),
          config: ctx.settings.calculator,
          deliveryRuleId: args.deliveryRuleId ?? null,
        });
        return build(
          true,
          result.total === null
            ? 'Izračun nije moguće završiti — nedostaju podaci.'
            : `Ukupno: ${formatMoney(result.total, result.currency)}.`,
          { breakdown: result, formattedTotal: formatMoney(result.total, result.currency) },
          [{ kind: 'settings', label: 'Kalkulator i poslovna pravila', detail: `Izračunato ${result.computedAt}` }],
        );
      }

      case 'listQuickReplies': {
        const args = argsSchemas.listQuickReplies.parse(rawArgs);
        const all = await ctx.store.listQuickReplies(ctx.userId);
        const filtered = args.category
          ? all.filter((q) => q.category.toLowerCase().includes(args.category!.toLowerCase()))
          : all;
        return build(true, `${filtered.length} brzih odgovora.`, {
          quickReplies: filtered.map((q) => ({
            id: q.id,
            label: q.label,
            category: q.category,
            message: q.message,
            requiresReview: q.requiresReview,
          })),
        });
      }

      case 'lookupPostalCode': {
        const args = argsSchemas.lookupPostalCode.parse(rawArgs);
        const matches = lookupPostalCodes(args.place, 5);
        if (!matches.length) {
          return build(
            true,
            `Poštanski broj za „${args.place}" nije u sistemskoj bazi. Ne izmišljaj broj — reci agentu da poštanski broj treba provjeriti.`,
            { verified: false, place: args.place, matches: [] },
          );
        }
        return build(true, `Poštanski broj: ${matches.map((m) => `${m.place} ${m.code}`).join(', ')}.`, {
          verified: true,
          source: 'Sistemska baza poštanskih brojeva BiH',
          matches: matches.map((m) => ({ place: m.place, code: m.code, post: m.post, exact: m.exact })),
        });
      }

      case 'getOrderFormConfiguration': {
        const fields = [...ctx.settings.orderForm.fields].sort((a, b) => a.sortOrder - b.sortOrder);
        return build(true, `GigaHub obrazac: ${fields.length} polja.`, {
          fields: fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            order: f.sortOrder,
            source: f.source,
          })),
        });
      }

      default:
        return build(false, `Nepoznat alat: ${name}.`, { error: 'unknown_tool' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return build(false, `Alat ${name} nije uspio: ${message}`, { error: 'tool_failed', message });
  }
}

export function assistantToolDefinitions(): ToolDefinition[] {
  return toolsDefs;
}
