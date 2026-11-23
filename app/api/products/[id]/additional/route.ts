import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { additionalFieldsSchema, patchAdditionalSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import type { AdditionalProductField, ProductAdditionalData } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    return ok({ additional: await getStore().getProductAdditional(id) });
  } catch (err) {
    return jsonError(err);
  }
}

/** Replace the full set of manually verified fields for one product. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const store = getStore();
    const product = await store.getProduct(id);
    if (!product) throw new ApiError(404, 'Proizvod nije pronađen u katalogu.', 'product_not_found');

    const body = additionalFieldsSchema.parse(await req.json());
    const now = new Date().toISOString();
    const fields: AdditionalProductField[] = body.fields
      .filter((f) => f.fieldName.trim() && f.value.trim())
      .map((f) => ({
        fieldName: f.fieldName.trim(),
        value: f.value.trim(),
        unit: f.unit?.trim() || null,
        addedAt: now,
        note: f.note?.trim() || null,
        addedBy: auth.userId,
      }));

    const data: ProductAdditionalData = {
      productId: id,
      fields,
      weightKg: body.weightKg ?? null,
      dimensionsCm: body.dimensionsCm ?? null,
      updatedAt: now,
      updatedBy: auth.userId,
    };
    await store.saveProductAdditional(data);
    await store.logAudit({
      id: crypto.randomUUID(),
      userId: auth.userId,
      action: 'product.additional.update',
      entity: 'product',
      entityId: id,
      detail: `${fields.length} polja`,
      at: now,
    });
    return ok({ additional: data });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Djelimična izmjena: agent u narudžbi upiše samo kilažu, a ručna polja i
 * dimenzije ostaju kakvi su bili.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const store = getStore();
    const product = await store.getProduct(id);
    if (!product) throw new ApiError(404, 'Proizvod nije pronađen u katalogu.', 'product_not_found');

    const body = patchAdditionalSchema.parse(await req.json());
    const existing: ProductAdditionalData =
      (await store.getProductAdditional(id)) ?? {
        productId: id,
        fields: [],
        weightKg: null,
        dimensionsCm: null,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.userId,
      };

    const data: ProductAdditionalData = {
      ...existing,
      weightKg: body.weightKg === undefined ? existing.weightKg : body.weightKg,
      dimensionsCm: body.dimensionsCm === undefined ? existing.dimensionsCm : body.dimensionsCm,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.userId,
    };
    await store.saveProductAdditional(data);
    await store.logAudit({
      id: crypto.randomUUID(),
      userId: auth.userId,
      action: 'product.additional.update',
      entity: 'product',
      entityId: id,
      detail: `težina: ${data.weightKg ?? 'nije unesena'} kg`,
      at: data.updatedAt,
    });
    return ok({ additional: data });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const store = getStore();
    await store.saveProductAdditional({
      productId: id,
      fields: [],
      weightKg: null,
      dimensionsCm: null,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.userId,
    });
    return ok({ deleted: true });
  } catch (err) {
    return jsonError(err);
  }
}
