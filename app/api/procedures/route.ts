import { randomUUID } from 'node:crypto';
import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { procedureSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    return ok({ procedures: await getStore().listProcedures(auth.userId) });
  } catch (err) {
    return jsonError(err);
  }
}

/** Upsert a company procedure. */
export async function PUT(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = procedureSchema.parse(await req.json());
    const procedure = await getStore().upsertProcedure(auth.userId, {
      id: body.id ?? randomUUID(),
      userId: auth.userId,
      topic: body.topic,
      title: body.title,
      keywords: body.keywords,
      answer: body.answer,
      verified: body.verified && body.answer.trim().length > 0,
      updatedAt: new Date().toISOString(),
    });
    return ok({ procedure });
  } catch (err) {
    return jsonError(err);
  }
}
