import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    const { id } = await params;
    await getStore().deleteProcedure(auth.userId, id);
    return ok({ deleted: true });
  } catch (err) {
    return jsonError(err);
  }
}
