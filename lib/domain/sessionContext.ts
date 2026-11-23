import type {
  ChatMessage,
  ContextProduct,
  CustomerDetails,
  OrderIntent,
  SessionContext,
} from './types';

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const SUMMARY_TRIGGER_MESSAGES = 24;
export const CONTEXT_WINDOW_MESSAGES = 14;

export function emptySessionContext(): SessionContext {
  return {
    summary: '',
    summarizedUpToMessageId: null,
    messageCountAtLastSummary: 0,
    lastSummarizedAt: null,
    products: [],
    customer: {},
    orderIntent: { value: 'unknown', confidence: 0, updatedAt: new Date(0).toISOString() },
    confirmedFacts: [],
    missingInfo: [],
    outstandingQuestions: [],
    agentCorrections: [],
  };
}

export function messageCount(context: SessionContext, messages: ChatMessage[]): number {
  return messages.length;
}

export function shouldSummarize(context: SessionContext, messages: ChatMessage[]): boolean {
  const customerRelevant = messages.filter((m) => m.senderType === 'customer' || m.senderType === 'agent');
  return customerRelevant.length - context.messageCountAtLastSummary >= SUMMARY_TRIGGER_MESSAGES;
}

/**
 * Messages that are sent verbatim to the model: everything after the last
 * summary point, capped to the most recent window (internal notes excluded).
 */
export function messagesForModel(
  messages: ChatMessage[],
  context: SessionContext,
  limit = CONTEXT_WINDOW_MESSAGES,
): ChatMessage[] {
  const relevant = messages.filter((m) => m.senderType === 'customer' || m.senderType === 'agent');
  let startIndex = 0;
  if (context.summarizedUpToMessageId) {
    const idx = relevant.findIndex((m) => m.id === context.summarizedUpToMessageId);
    if (idx >= 0) startIndex = idx + 1;
  }
  return relevant.slice(Math.max(startIndex, relevant.length - limit));
}

export function upsertContextProduct(context: SessionContext, next: ContextProduct): SessionContext {
  const products = [...context.products];
  const idx = products.findIndex((p) => p.productId === next.productId);
  if (idx >= 0) {
    const existing = products[idx]!;
    products[idx] = {
      ...existing,
      ...next,
      quantity: next.quantity ?? existing.quantity,
      unitPrice: next.unitPrice ?? existing.unitPrice,
    };
  } else {
    products.push(next);
  }
  return { ...context, products };
}

/**
 * Keeps the session's product list in step with the conversation: the products
 * just discussed move to the front, so the side panel follows the current topic
 * instead of showing whatever was added first.
 */
export function promoteContextProducts(context: SessionContext, productIds: string[]): SessionContext {
  if (!productIds.length || !context.products.length) return context;
  const rank = new Map(productIds.map((id, index) => [id, index]));
  const products = [...context.products].sort((a, b) => {
    const ra = rank.has(a.productId) ? rank.get(a.productId)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.productId) ? rank.get(b.productId)! : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
  return { ...context, products };
}

export function mergeCustomerDetails(context: SessionContext, patch: Partial<CustomerDetails>): SessionContext {
  const customer: CustomerDetails = { ...context.customer };
  for (const [key, value] of Object.entries(patch) as [keyof CustomerDetails, string | undefined][]) {
    if (typeof value === 'string' && value.trim()) customer[key] = value.trim();
  }
  return { ...context, customer };
}

const INTENTS: OrderIntent[] = ['unknown', 'browsing', 'interested', 'confirmed', 'declined'];

export function setOrderIntent(context: SessionContext, value: string, confidence = 0.5, rationale?: string): SessionContext {
  const intent = (INTENTS.includes(value as OrderIntent) ? value : 'unknown') as OrderIntent;
  return {
    ...context,
    orderIntent: {
      value: intent,
      confidence: Math.max(0, Math.min(1, confidence)),
      rationale,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function addOutstandingQuestion(context: SessionContext, question: string): SessionContext {
  const q = question.trim();
  if (!q || context.outstandingQuestions.some((o) => o.question.toLowerCase() === q.toLowerCase())) {
    return context;
  }
  return {
    ...context,
    outstandingQuestions: [
      ...context.outstandingQuestions,
      { id: newId(), question: q, createdAt: new Date().toISOString(), resolved: false },
    ],
  };
}

export function resolveOutstandingQuestions(context: SessionContext, resolvedText: string): SessionContext {
  const needle = resolvedText.toLowerCase();
  return {
    ...context,
    outstandingQuestions: context.outstandingQuestions.map((o) =>
      needReturnsTrue(o.question, needle) ? { ...o, resolved: true } : o,
    ),
  };
}

function needReturnsTrue(question: string, needle: string): boolean {
  const tokens = question.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  return tokens.some((t) => needle.includes(t));
}

/** Compact, structured representation given to the model instead of a transcript. */
export function serializeContext(context: SessionContext): string {
  const lines: string[] = [];
  if (context.summary) lines.push(`SAŽETAK DOSADAŠNJEG RAZGOVORA:
${context.summary}`);
  if (context.orderIntent.value !== 'unknown') {
    lines.push(
      `STATUS NARUDŽBE: ${context.orderIntent.value} (pouzdanost ${(context.orderIntent.confidence * 100).toFixed(
        0,
      )}%)${context.orderIntent.rationale ? ` — ${context.orderIntent.rationale}` : ''}`,
    );
  }
  if (context.products.length) {
    lines.push('PROIZVODI U RAZGOVORU:');
    for (const p of context.products) {
      lines.push(
        `- ${p.name}${p.sku ? ` (SKU ${p.sku})` : ''}; količina: ${p.quantity ?? 'nepoznata'}; cijena: ${
          p.unitPrice !== null ? `${p.unitPrice} ${p.currency}` : 'nepoznata'
        }; ID: ${p.productId}`,
      );
    }
  }
  const customerEntries = Object.entries(context.customer).filter(([, v]) => v);
  if (customerEntries.length) {
    lines.push(`PODACI KUPCA: ${customerEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (context.confirmedFacts.length) lines.push(`POTVRĐENE ČINJENICE: ${context.confirmedFacts.join(' | ')}`);
  if (context.missingInfo.length) lines.push(`NEDOSTAJE: ${context.missingInfo.join(' | ')}`);
  const openQuestions = context.outstandingQuestions.filter((q) => !q.resolved);
  if (openQuestions.length) lines.push(`OTVORENA PITANJA: ${openQuestions.map((q) => q.question).join(' | ')}`);
  if (context.agentCorrections.length) {
    lines.push(`KOREKCIJE AGENTA (imaju prioritet): ${context.agentCorrections.join(' | ')}`);
  }
  return lines.join('\n');
}

export function contextHasContent(context: SessionContext): boolean {
  return Boolean(
    context.summary ||
      context.products.length ||
      Object.keys(context.customer).length ||
      context.confirmedFacts.length ||
      context.orderIntent.value !== 'unknown',
  );
}

/**
 * Realtime Database drops `null` values, so a context product written by the AI
 * could come back without `quantity`. Every reader must see the same complete
 * shape, otherwise the order looks like it has no quantity.
 */
export function normalizeContextProduct(
  raw: Partial<ContextProduct> & { productId?: string; id?: string },
): ContextProduct | null {
  const productId = raw.productId ?? raw.id;
  if (!productId) return null;
  const quantity = typeof raw.quantity === 'number' && raw.quantity > 0 ? raw.quantity : null;
  const unitPrice = typeof raw.unitPrice === 'number' && Number.isFinite(raw.unitPrice) ? raw.unitPrice : null;
  return {
    productId,
    name: raw.name?.trim() || productId,
    sku: raw.sku ?? null,
    unitPrice,
    currency: raw.currency ?? 'BAM',
    quantity,
    priceCheckedAt: raw.priceCheckedAt ?? null,
    priceSource: raw.priceSource ?? 'unknown',
    ...(raw.note ? { note: raw.note } : {}),
  };
}

export function normalizeSessionContext(context: SessionContext): SessionContext {
  const products = (context.products ?? [])
    .map((p) => normalizeContextProduct(p))
    .filter((p): p is ContextProduct => Boolean(p));
  return { ...context, products };
}
