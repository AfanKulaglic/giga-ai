import { requireAuth } from '@/lib/api/auth';
import { jsonError, ok } from '@/lib/api/errors';
import { getStore } from '@/lib/store';
import { configurationStatus } from '@/lib/config/env';
import { renderSignature } from '@/lib/domain/signature';
import { ensureCatalogueTicker } from '@/lib/site/catalogueTicker';

export const dynamic = 'force-dynamic';

/** One round-trip bootstrap for the workspace and settings pages. */
export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    const store = getStore();
    // Baza se osvježava u pozadini (10 zahtjeva po ciklusu), da katalog ne
    // ostane snimak od jučer. Detaljna provjera ide tek uz odgovor/narudžbu.
    ensureCatalogueTicker();
    const [sessions, settings, procedures, quickReplies, scraperState, productCount] = await Promise.all([
      store.listSessions(auth.userId),
      store.getSettings(auth.userId),
      store.listProcedures(auth.userId),
      store.listQuickReplies(auth.userId),
      store.getScraperState(),
      store.countProducts(),
    ]);

    const status = configurationStatus();
    return ok({
      auth: { mode: auth.mode, email: auth.email },
      sessions,
      settings,
      procedures,
      quickReplies,
      scraper: { ...scraperState, totalProducts: productCount },
      productCount,
      config: {
        ...status,
        signatureConfigured: Boolean(renderSignature(settings.signature)),
        deliveryConfigured:
          settings.calculator.deliveryPolicy === 'rules' &&
          settings.calculator.deliveryRules.some((r) => r.enabled),
        discountRulesConfigured: settings.calculator.discountRules.some((r) => r.enabled),
        orderFormProvisional: settings.orderForm.fields.some((f) => f.provisional),
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
