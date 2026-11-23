import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Removes one message from the chat (customer, agent or internal note). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const auth = await requireAuth(req);
    const { id, messageId } = await params;
    const store = getStore();
    const session = await store.getSession(auth.userId, id);
    if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');

    const messages = await store.listMessages(auth.userId, id);
    if (!messages.some((m) => m.id === messageId)) {
      throw new ApiError(404, 'Poruka nije pronađena.', 'message_not_found');
    }

    await store.deleteMessage(auth.userId, id, messageId);
    const updated = await store.getSession(auth.userId, id);
    return ok({ deletedId: messageId, session: updated });
  } catch (err) {
    return jsonError(err);
  }
}
