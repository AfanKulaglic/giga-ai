import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { settingsSchema } from '@/lib/api/schemas';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    const settings = await getStore().getSettings(auth.userId);
    return ok({ settings });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireAuth(req);
    const body = settingsSchema.parse(await req.json());
    const store = getStore();
    const current = await store.getSettings(auth.userId);
    // Protected core rules version can only move forward, never be replaced.
    const protectedRulesVersion = Math.max(current.ai.protectedRulesVersion, body.ai.protectedRulesVersion);
    const saved = await store.saveSettings(auth.userId, {
      ...body,
      ai: { ...body.ai, protectedRulesVersion },
    });
    await store.logAudit({
      id: crypto.randomUUID(),
      userId: auth.userId,
      action: 'settings.update',
      entity: 'settings',
      at: new Date().toISOString(),
    });
    return ok({ settings: saved });
  } catch (err) {
    return jsonError(err);
  }
}
