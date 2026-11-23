import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { scraperStatus } from '@/worker/sync';
import { isFirebaseAdminConfigured } from '@/lib/config/env';
import { siteGuardSnapshot } from '@/lib/site/siteGuard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireAuth(req);
    const status = await scraperStatus();
    return ok({
      ...status,
      // Koliko je zahtjeva otišlo prema giga.ba u zadnjih sat — tvrda granica.
      siteLoad: siteGuardSnapshot(),
      storage: isFirebaseAdminConfigured() ? 'firestore' : 'local',
    });
  } catch (err) {
    return jsonError(err);
  }
}
