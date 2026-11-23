import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { calculateSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import { calculateOrder } from '@/lib/domain/calculator';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = calculateSchema.parse(await req.json());
    const store = getStore();
    const settings = await store.getSettings(auth.userId);

    // Authoritative prices always come from the catalogue when a product exists.
    const products = await store.getProductsByIds(body.items.map((i) => i.productId));
    // Shipping weight is agent-entered, so it is read from the product extras.
    const additionalRows = await Promise.all(
      body.items.map((i) => store.getProductAdditional(i.productId)),
    );
    const items = body.items.map((item) => {
      const catalog = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        name: catalog?.name ?? item.name ?? 'Nepoznat proizvod',
        sku: catalog?.sku ?? item.sku ?? null,
        unitPrice: catalog ? catalog.price : item.unitPrice,
        quantity: item.quantity,
        currentCatalogPrice: catalog?.price ?? item.currentCatalogPrice ?? null,
        priceCheckedAt: catalog?.scrapedAt ?? item.priceCheckedAt ?? null,
        weightKg:
          additionalRows[body.items.indexOf(item)]?.weightKg ??
          (typeof item.weightKg === 'number' ? item.weightKg : null),
      };
    });

    const calculation = calculateOrder({
      items,
      config: settings.calculator,
      deliveryRuleId: body.deliveryRuleId ?? null,
      manualDiscountPercent: body.manualDiscountPercent ?? null,
    });

    return ok({ calculation });
  } catch (err) {
    return jsonError(err);
  }
}
