import { randomUUID } from 'node:crypto';
import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { createMessageSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import { syncSessionFromText } from '@/lib/api/sessionContextSync';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const session = await getStore().getSession(auth.userId, id);
    if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');
    const messages = await getStore().listMessages(auth.userId, id);
    return ok({ messages });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const body = createMessageSchema.parse(await req.json());
    const store = getStore();
    const session = await store.getSession(auth.userId, id);
    if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');

    const message = {
      id: randomUUID(),
      sessionId: id,
      userId: auth.userId,
      senderType: body.senderType as import('@/lib/domain/types').SenderType,
      content: body.content,
      createdAt: new Date().toISOString(),
      classification: (body.classification ?? null) as import('@/lib/domain/types').MessageClassification | null,
    };
    await store.addMessage(auth.userId, message);

    // Kartice „Kupac” i „Proizvodi u sesiji” prate razgovor odmah — i kad piše
    // kupac i kad agent prepiše njegove podatke.
    if (message.senderType === 'customer' || message.senderType === 'agent') {
      await syncSessionFromText({
        store,
        userId: auth.userId,
        sessionId: id,
        text: body.content,
        touchActivity: true,
      }).catch(() => null);
    }

    const updated = await store.getSession(auth.userId, id);
    return ok({ message, session: updated }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
