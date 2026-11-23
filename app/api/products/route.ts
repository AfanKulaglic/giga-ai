import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireAuth(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '20')));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0'));
    const store = getStore();

    if (q) {
      const matches = await store.searchProductsWithAdditional(q, limit);
      return ok({
        products: matches.map((m) => ({
          ...m.product,
          additionalFields: m.additional?.fields ?? [],
          weightKg: m.additional?.weightKg ?? null,
          dimensionsCm: m.additional?.dimensionsCm ?? null,
        })),
        // Only the matches are meaningful here; the full catalogue size would
        // make the list render every product as if it matched.
        total: matches.length,
      });
    }

    const [products, total] = await Promise.all([store.listProducts(limit, offset), store.countProducts()]);
    // Weight is agent-entered, so the list has to look it up to show "bez težine".
    const extras = await Promise.all(products.map((p) => store.getProductAdditional(p.id)));
    return ok({
      products: products.map((product, index) => ({
        ...product,
        weightKg: extras[index]?.weightKg ?? null,
        dimensionsCm: extras[index]?.dimensionsCm ?? null,
      })),
      total,
      offset,
      limit,
    });
  } catch (err) {
    return jsonError(err);
  }
}
