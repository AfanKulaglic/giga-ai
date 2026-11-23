import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { additionalFieldsSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import type { AdditionalProductField } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const store = getStore();
    const product = await store.getProduct(id);
    if (!product) throw new ApiError(404, 'Proizvod nije pronađen.', 'product_not_found');
    const additional = await store.getProductAdditional(id);
    return ok({ product, additional });
  } catch (err) {
    return jsonError(err);
  }
}
