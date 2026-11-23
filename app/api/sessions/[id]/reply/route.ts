import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { generateReplySchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';
import { generateCustomerReply } from '@/lib/ai/reply';
import { aiMissingKeyMessage, isAIConfigured } from '@/lib/config/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

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
    const body = generateReplySchema.parse(await req.json().catch(() => ({})));
    const result = await generateCustomerReply({
      userId: auth.userId,
      sessionId: id,
      store: getStore(),
      tone: body.tone,
      instruction: body.instruction ?? null,
    });
    return ok(result);
  } catch (err) {
    return jsonError(err);
  }
}
