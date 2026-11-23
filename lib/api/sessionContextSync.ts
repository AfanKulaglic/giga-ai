import type { CustomerSession } from '@/lib/domain/types';
import type { Store } from '@/lib/store/types';
import { syncContextWithCustomerMessage } from '@/lib/domain/contextSync';
import { promoteContextProducts } from '@/lib/domain/sessionContext';
import { isOfferQuestion } from '@/lib/ai/offer';

/**
 * Jedno mjesto na kojem se sesija uskladi sa tekstom razgovora.
 *
 * Poziva se za svaku poruku kupca, za poruku agenta (jer agent često prepiše
 * ono što je kupac rekao) i za uputstvo koje agent napiše AI-ju. Bez ovoga
 * kartice „Kupac” i „Proizvodi u sesiji” prate samo jedan od tih puteva.
 */
export async function syncSessionFromText(args: {
  store: Store;
  userId: string;
  sessionId: string;
  text: string;
  touchActivity?: boolean;
}): Promise<{ session: CustomerSession | null; changed: boolean }> {
  const { store, userId, sessionId } = args;
  const text = (args.text ?? '').trim();
  if (!text) return { session: null, changed: false };

  const session = await store.getSession(userId, sessionId);
  if (!session) return { session: null, changed: false };

  // Pitanje o ponudi traži širu pretragu: kartica tada pokazuje cijelu kategoriju.
  const offerQuestion = isOfferQuestion(text);
  let matches: Awaited<ReturnType<Store['searchProducts']>> = [];
  try {
    matches = await store.searchProducts(text, offerQuestion ? 40 : 5);
  } catch {
    // Pretraga ne smije blokirati ništa; bez nje se i dalje čitaju podaci kupca.
  }

  const synced = syncContextWithCustomerMessage(session.context, {
    text,
    matches,
    maxAdd: offerQuestion ? 15 : 3,
  });
  let context = synced.context;
  const discussed = [...synced.changed.addedProductIds, ...synced.changed.quantitySet.map((q) => q.productId)];
  if (discussed.length) context = promoteContextProducts(context, discussed);

  const changed =
    synced.changed.customerFields.length > 0 ||
    synced.changed.droppedProductIds.length > 0 ||
    synced.changed.quantitySet.length > 0 ||
    synced.changed.addedProductIds.length > 0;

  if (!changed && !args.touchActivity) return { session, changed: false };

  const updated = await store.updateSession(userId, sessionId, {
    context: changed ? context : session.context,
    ...(args.touchActivity ? { lastMessageAt: new Date().toISOString() } : {}),
  });
  return { session: updated ?? session, changed };
}
