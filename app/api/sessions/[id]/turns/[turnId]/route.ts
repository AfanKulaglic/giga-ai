import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Agent ispravlja tekst odgovora asistenta prije nego ga pošalje kupcu. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; turnId: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id, turnId } = await params;
    const payload = await req.json().catch(() => null);
    const content =
      payload && typeof payload === 'object' && typeof (payload as { content?: unknown }).content === 'string'
        ? (payload as { content: string }).content.trim()
        : '';
    if (!content) throw new ApiError(400, 'Tekst poruke ne može biti prazan.', 'empty_turn_text');
    if (content.length > 8000) throw new ApiError(400, 'Tekst poruke je predugačak.', 'turn_text_too_long');

    const turn = await getStore().updateTurn(auth.userId, id, turnId, content);
    return ok({ turn });
  } catch (err) {
    return jsonError(err);
  }
}

/** Removes one private AI turn from the assistant panel. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; turnId: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id, turnId } = await params;
    const store = getStore();
    const session = await store.getSession(auth.userId, id);
    if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');

    const turns = await store.listTurns(auth.userId, id);
    if (!turns.some((t) => t.id === turnId)) {
      throw new ApiError(404, 'Odgovor asistenta nije pronađen.', 'turn_not_found');
    }

    await store.deleteTurn(auth.userId, id, turnId);
    return ok({ deletedId: turnId });
  } catch (err) {
    return jsonError(err);
  }
}
