import { randomUUID } from 'node:crypto';
import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { quickReplySchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    return ok({ quickReplies: await getStore().listQuickReplies(auth.userId) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = quickReplySchema.parse(await req.json());
    const existing = await getStore().listQuickReplies(auth.userId);
    const code = (body.code ?? '').toLowerCase();
    if (code && existing.some((reply) => (reply.code ?? '').toLowerCase() === code)) {
      throw new ApiError(409, `Šifra „${code}” je već zauzeta.`, 'quick_reply_code_taken');
    }
    const now = new Date().toISOString();
    const reply = {
      id: randomUUID(),
      userId: auth.userId,
      code,
      label: body.label,
      category: body.category,
      message: body.message,
      sortOrder: body.sortOrder ?? (existing.length ? Math.max(...existing.map((r) => r.sortOrder)) + 10 : 10),
      requiresReview: body.requiresReview ?? false,
      createdAt: now,
      updatedAt: now,
    };
    const created = await getStore().createQuickReply(auth.userId, reply);
    return ok({ quickReply: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
