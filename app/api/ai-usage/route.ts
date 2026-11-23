import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { getTodayAIUsage } from '@/lib/ai/usage';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Dnevna potrošnja AI kredita. Sa ?detail=1 vraća i pojedinačne pozive, da se
 * uvijek može provjeriti odakle broj dolazi.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    const summary = await getTodayAIUsage();
    const detail = new URL(req.url).searchParams.get('detail');
    if (!detail) return ok(summary);
    const entries = (await getStore().listAudit(auth.userId, 200))
      .filter((entry) => entry.action === 'ai.call')
      .slice(0, 25)
      .map((entry) => {
        let promptTokens = 0;
        let completionTokens = 0;
        try {
          const parsed = entry.detail ? (JSON.parse(entry.detail) as Record<string, number>) : null;
          promptTokens = parsed?.promptTokens ?? 0;
          completionTokens = parsed?.completionTokens ?? 0;
        } catch {
          // ignore malformed rows
        }
        return { at: entry.at, model: entry.entityId, promptTokens, completionTokens };
      });
    return ok({ ...summary, entries });
  } catch (err) {
    return jsonError(err);
  }
}
