import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { createSessionSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    const sessions = await getStore().listSessions(auth.userId);
    return ok({ sessions });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = createSessionSchema.parse(await req.json().catch(() => ({})));
    const session = await getStore().createSession(auth.userId, { label: body.label });
    await getStore().logAudit({
      id: crypto.randomUUID(),
      userId: auth.userId,
      action: 'session.create',
      entity: 'session',
      entityId: session.id,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
