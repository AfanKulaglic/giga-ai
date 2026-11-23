import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { updateSessionSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const store = getStore();
    const session = await store.getSession(auth.userId, id);
    if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');
    const [messages, turns, replies] = await Promise.all([
      store.listMessages(auth.userId, id),
      store.listTurns(auth.userId, id),
      store.listReplies(auth.userId, id),
    ]);
    return ok({ session, messages, turns, replies });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const patch = updateSessionSchema.parse(await req.json());
    const session = await getStore().updateSession(auth.userId, id, patch);
    return ok({ session });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    await getStore().deleteSession(auth.userId, id);
    return ok({ deleted: true });
  } catch (err) {
    return jsonError(err);
  }
}
