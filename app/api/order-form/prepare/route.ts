import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { orderFormPrepareSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import { calculateOrder } from '@/lib/domain/calculator';
import { buildOrderFormValues } from '@/lib/domain/orderForm';
import { mergeCustomerDetails } from '@/lib/domain/sessionContext';
import { extractCustomerDetailsFromMessages } from '@/lib/domain/customerExtraction';
import { liveCheckNotes, refreshLiveProducts } from '@/lib/site/gigaLive';

export const dynamic = 'force-dynamic';

/** Builds the GigaHub preparation payload. It never submits anything anywhere. */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = orderFormPrepareSchema.parse(await req.json());
    const store = getStore();
    const [session, settings] = await Promise.all([
      store.getSession(auth.userId, body.sessionId),
      store.getSettings(auth.userId),
    ]);
    if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');

    /**
     * Customers usually paste their details straight into the chat. Fill any
     * missing field from the conversation so the form is not empty, but never
     * overwrite something the agent already confirmed.
     */
    const messages = await store.listMessages(auth.userId, session.id);
    const fromChat = extractCustomerDetailsFromMessages(
      messages.filter((m) => m.senderType === 'customer').map((m) => m.content),
    );
    const missingFromChat = Object.fromEntries(
      Object.entries(fromChat).filter(([key, value]) => {
        const existing = session.context.customer[key as keyof typeof session.context.customer];
        return Boolean(value) && !String(existing ?? '').trim();
      }),
    );
    const filledFromChat = Object.keys(missingFromChat);
    const activeSession = filledFromChat.length
      ? ((await store.updateSession(auth.userId, session.id, {
          context: mergeCustomerDetails(session.context, missingFromChat),
        })) ?? session)
      : session;

    // Narudžba se pravi prema STVARNOM stanju na sajtu: cijena i dostupnost se
    // provjere na giga.ba prije nego se iznos izračuna (najviše 6 proizvoda).
    const storedProducts = await store.getProductsByIds(body.items.map((i) => i.productId));
    let products = storedProducts;
    let liveNotes: string[] = [];
    if ((process.env.LIVE_SITE_CHECK ?? 'true').toLowerCase() !== 'false' && storedProducts.length) {
      const live = await refreshLiveProducts(store, storedProducts, { max: 6 });
      liveNotes = liveCheckNotes(live.checks);
      products = storedProducts.map((product) => live.updated.get(product.id) ?? product);
    }
    // Weight lives in the agent-entered product extras and drives delivery pricing.
    const additionalRows = await Promise.all(
      body.items.map((i) => store.getProductAdditional(i.productId)),
    );
    const items = body.items.map((item, index) => {
      const catalog = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        name: catalog?.name ?? item.name ?? 'Nepoznat proizvod',
        sku: catalog?.sku ?? item.sku ?? null,
        unitPrice: catalog ? catalog.price : item.unitPrice,
        quantity: item.quantity,
        currentCatalogPrice: catalog?.price ?? item.currentCatalogPrice ?? null,
        priceCheckedAt: catalog?.scrapedAt ?? item.priceCheckedAt ?? null,
        weightKg: additionalRows[index]?.weightKg ?? item.weightKg ?? null,
      };
    });

    const calculation = calculateOrder({
      items,
      config: settings.calculator,
      deliveryRuleId: body.deliveryRuleId ?? null,
      manualDiscountPercent: body.manualDiscountPercent ?? null,
    });

    const prepared = buildOrderFormValues(settings.orderForm, activeSession, calculation);

    return ok({
      calculation,
      // `prepared` is { values, missingRequired }; the client expects a plain list.
      values: prepared.values,
      missingRequired: prepared.missingRequired,
      formConfigured: settings.orderForm.fields.length > 0,
      provisional: settings.orderForm.fields.some((f) => f.provisional),
      filledFromChat,
      liveNotes,
    });
  } catch (err) {
    return jsonError(err);
  }
}
