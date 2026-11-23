import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { editReplySchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import { appendSignature, renderSignature } from '@/lib/domain/signature';

export const dynamic = 'force-dynamic';

/** Agent odbacuje nacrt koji mu ne treba. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    await getStore().deleteReply(auth.userId, id);
    return ok({ deleted: true });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const body = editReplySchema.parse(await req.json());
    const store = getStore();
    const settings = await store.getSettings(auth.userId);
    const fullText = appendSignature(body.body, settings.signature);
    const reply = await store.updateReply(auth.userId, id, {
      body: body.body.trim(),
      fullText,
      editedByAgent: true,
      signatureApplied: Boolean(renderSignature(settings.signature)),
    });
    if (!reply) throw new ApiError(404, 'Odgovor nije pronađen.', 'reply_not_found');
    return ok({ reply });
  } catch (err) {
    return jsonError(err);
  }
}
