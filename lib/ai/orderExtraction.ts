import 'server-only';
import { z } from 'zod';
import { chatJson, isAIAvailable } from './client';
import { CORE_RULES } from './prompts';
import { identifyProduct } from '@/lib/domain/productSearch';
import type { Product } from '@/lib/domain/types';
import type { Store } from '@/lib/store/types';
import { serverEnv } from '@/lib/config/env';
import { messagesForModel } from '@/lib/domain/sessionContext';
import { serializeContext } from '@/lib/domain/sessionContext';

const ExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().optional(),
        query: z.string().max(200).optional(),
        quantity: z.number().int().positive().optional(),
        note: z.string().max(200).optional(),
      }),
    )
    .max(30)
    .default([]),
  missingInfo: z.array(z.string().max(200)).max(20).default([]),
  notes: z.string().max(500).optional(),
});

export interface ExtractedOrderItem {
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number | null;
  quantity: number;
  currency: string;
  priceCheckedAt: string | null;
  currentCatalogPrice: number | null;
}

export interface UnresolvedOrderItem {
  requested: string;
  reason: string;
  candidates: { productId: string; name: string; sku: string | null; price: number | null }[];
}

export interface OrderExtractionResult {
  items: ExtractedOrderItem[];
  unresolved: UnresolvedOrderItem[];
  missingInfo: string[];
  notes: string | null;
  source: 'ai' | 'context';
  model: string | null;
}

/**
 * Extract order contents from the session. Prices always come from the
 * catalogue — the model only identifies products and quantities, and any
 * uncertain match is returned as unresolved instead of being guessed.
 */
export async function extractOrderFromSession(args: {
  userId: string;
  sessionId: string;
  store: Store;
}): Promise<OrderExtractionResult> {
  const { userId, sessionId, store } = args;
  const session = await store.getSession(userId, sessionId);
  if (!session) throw new Error('Sesija nije pronađena.');
  const messages = await store.listMessages(userId, sessionId);

  let proposed: z.infer<typeof ExtractionSchema> = { items: [], missingInfo: [] };
  let source: 'ai' | 'context' = 'context';
  let model: string | null = null;

  if (isAIAvailable() && messages.length) {
    const { data, model: usedModel } = await chatJson({
      messages: [
        {
          role: 'system',
          content: `${CORE_RULES}

ZADATAK: izvuci stavke narudžbe iz razgovora. Ne izmišljaj proizvode ni cijene.
Vrati JSON:
{"items":[{"productId":"ako je poznat iz sesije","query":"naziv proizvoda ako ID nije poznat","quantity":1,"note":"opciono"}],
 "missingInfo":["šta nedostaje za narudžbu"],
 "notes":"kratka napomena"}
Ako kupac nije naveo količinu, ostavi quantity prazno i navedi u missingInfo.
Proizvode traži samo ako ih kupac zaista spominje.`,
        },
        {
          role: 'user',
          content: `KONTEKST:
${serializeContext(session.context)}

RAZGOVOR:
${messagesForModel(messages, session.context, serverEnv.ai.contextMessages)
            .map((m) => `${m.senderType === 'customer' ? 'Kupac' : 'Agent'}: ${m.content}`)
            .join('\n')}`,
        },
      ],
      maxTokens: 900,
    });
    const parsed = ExtractionSchema.safeParse(data);
    if (parsed.success) {
      proposed = parsed.data;
      source = 'ai';
      model = usedModel;
    }
  }

  if (!proposed.items.length && session.context.products.length) {
    proposed.items = session.context.products.map((p) => ({
      productId: p.productId,
      quantity: p.quantity ?? undefined,
    }));
    baselineMissing(proposed, session.context.products.map((p) => p.quantity === null));
    source = 'context';
  }

  const items: ExtractedOrderItem[] = [];
  const unresolved: UnresolvedOrderItem[] = [];

  for (const item of proposed.items) {
    let product: Product | null = null;

    if (item.productId) {
      product = await store.getProduct(item.productId);
      if (!product) product = await store.getProduct(`giga_${item.productId}`);
    }

    if (!product && item.query) {
      const candidates = await store.searchProducts(item.query, 6);
      const identification = identifyProduct(candidates, item.query);
      if (identification.best && identification.confidence !== 'ambiguous' && identification.confidence !== 'none') {
        product = identification.best.product;
      } else if (identification.best) {
        unresolved.push({
          requested: item.query,
          reason: 'Više proizvoda odgovara — potrebno je odabrati tačan proizvod.',
          candidates: candidates.slice(0, 5).map((p) => ({ productId: p.id, name: p.name, sku: p.sku, price: p.price })),
        });
        continue;
      } else {
        unresolved.push({
          requested: item.query,
          reason: 'Proizvod nije pronađen u katalogu.',
          candidates: [],
        });
        continue;
      }
    }

    if (!product) {
      unresolved.push({ requested: item.query ?? item.productId ?? 'nepoznato', reason: 'Proizvod nije identificiran.', candidates: [] });
      continue;
    }

    if (!item.quantity) {
      unresolved.push({
        requested: product.name,
        reason: 'Količina nije poznata — unesite je u kalkulatoru.',
        candidates: [],
      });
      continue;
    }

    const existing = items.find((i) => i.productId === product!.id);
    if (existing) existing.quantity += item.quantity;
    else
      items.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unitPrice: product.price,
        quantity: item.quantity,
        currency: product.currency,
        priceCheckedAt: product.scrapedAt,
        currentCatalogPrice: product.price,
      });
  }

  return {
    items,
    unresolved,
    missingInfo: [...proposed.missingInfo],
    notes: proposed.notes ?? null,
    source,
    model,
  };
}

function baselineMissing(proposed: z.infer<typeof ExtractionSchema>, missingQuantity: boolean[]) {
  if (missingQuantity.some(Boolean) && !proposed.missingInfo.includes('Količina za neke proizvode nije poznata.')) {
    proposed.missingInfo.push('Količina za neke proizvode nije poznata.');
  }
}
