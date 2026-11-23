import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { aiKeyCount, aiKeyStatus, aiUsableKeyCount, selectAIKey } from '@/lib/ai/client';

export const dynamic = 'force-dynamic';

/** Which AI keys exist, which one is in use and which hit its quota. */
export async function GET(req: Request) {
  try {
    await requireAuth(req);
    return ok({ count: aiUsableKeyCount(), total: aiKeyCount(), keys: aiKeyStatus() });
  } catch (err) {
    return jsonError(err);
  }
}

/** Manual switch: the agent picks the key the next replies should use. */
export async function POST(req: Request) {
  try {
    await requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as { index?: unknown };
    const index = Number(body.index);
    if (!Number.isInteger(index)) throw new ApiError(400, 'Nedostaje broj ključa.', 'invalid_index');
    const result = selectAIKey(index);
    if (!result.ok) throw new ApiError(409, result.message, 'ai_key_unavailable');
    return ok({ count: aiUsableKeyCount(), total: aiKeyCount(), keys: aiKeyStatus(), message: result.message });
  } catch (err) {
    return jsonError(err);
  }
}
