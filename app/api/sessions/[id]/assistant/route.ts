import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { assistantTurnSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import { buildAssistantTurn, buildUserTurn, runAssistantTurn } from '@/lib/ai/orchestrator';
import { aiMissingKeyMessage, isAIConfigured } from '@/lib/config/env';
import { syncSessionFromText } from '@/lib/api/sessionContextSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    const turns = await getStore().listTurns(auth.userId, id);
    return ok({ turns, aiConfigured: isAIConfigured() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    if (!isAIConfigured()) {
      throw new ApiError(
        503,
        aiMissingKeyMessage(),
        'ai_not_configured',
      );
    }
    const { message } = assistantTurnSchema.parse(await req.json());
    const store = getStore();

    const userTurn = buildUserTurn(auth.userId, id, message);
    await store.addTurn(auth.userId, userTurn);

    // Agent u AI panel često napiše ono što je kupac rekao („kupac želi 102x40,
    // telefon 062…”) — i to mora odmah ući u kartice, ne samo u transkript.
    await syncSessionFromText({ store, userId: auth.userId, sessionId: id, text: message }).catch(() => null);

    try {
      const result = await runAssistantTurn({ userId: auth.userId, sessionId: id, store });
      const assistantTurn = buildAssistantTurn({
        userId: auth.userId,
        sessionId: id,
        answer: result.answer,
        citations: result.citations,
        toolTraces: result.toolTraces,
      });
      await store.addTurn(auth.userId, assistantTurn);
      // AI alati mogu dodati proizvode u sesiju; poslije toga se lista ponovo
      // suzi na ono što je kupac tražio, da kartica ne bude puna neželjenih.
      await syncSessionFromText({ store, userId: auth.userId, sessionId: id, text: message }).catch(() => null);
      const [turns, session] = await Promise.all([
        store.listTurns(auth.userId, id),
        store.getSession(auth.userId, id),
      ]);
      return ok({ turns, session, model: result.model });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI zahtjev nije uspio.';
      await store.addTurn(auth.userId, {
        ...buildAssistantTurn({ userId: auth.userId, sessionId: id, answer: '', citations: [], toolTraces: [] }),
        content: '',
        error: message,
      });
      throw err;
    }
  } catch (err) {
    return jsonError(err);
  }
}
