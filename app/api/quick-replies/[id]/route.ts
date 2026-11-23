import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { quickReplyPatchSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const raw = await req.json();
    const patch = quickReplyPatchSchema.parse(raw);
    if (typeof patch.code === 'string') {
      const code = patch.code.toLowerCase();
      const others = (await getStore().listQuickReplies(auth.userId)).filter((reply) => reply.id !== id);
      if (code && others.some((reply) => (reply.code ?? '').toLowerCase() === code)) {
        throw new ApiError(409, `Šifra „${code}” je već zauzeta.`, 'quick_reply_code_taken');
      }
      patch.code = code;
    }
    const updated = await getStore().updateQuickReply(auth.userId, id, patch);
    if (!updated) throw new ApiError(404, 'Brzi odgovor nije pronađen.', 'quick_reply_not_found');
    return ok({ quickReply: updated });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    await getStore().deleteQuickReply(auth.userId, id);
    return ok({ deleted: true });
  } catch (err) {
    return jsonError(err);
  }
}
