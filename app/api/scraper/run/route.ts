import { spawn } from 'node:child_process';
import { requireAuth } from '@/lib/api/auth';
import { ApiError, jsonError, ok } from '@/lib/api/errors';
import { scraperRunSchema } from '@/lib/api/schemas';
import { runScrape, scraperStatus } from '@/worker/sync';
import { getStore } from '@/lib/store';
import { checkSyncCooldown, DEFAULT_SYNC_COOLDOWN_SECONDS } from '@/lib/domain/syncCooldown';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    await requireAuth(req);
    const body = scraperRunSchema.parse(await req.json().catch(() => ({})));
    const state = await getStore().getScraperState();
    if (state.currentStatus === 'running') {
      throw new ApiError(409, 'Sinhronizacija je već u toku.', 'sync_running');
    }

    // Zaštita giga.ba: nema smisla dohvatati katalog više puta u minuti, a
    // prečesti pozivi su jedini način da ovaj alat nekome smeta.
    const cooldownSeconds = Number(process.env.SCRAPER_MIN_INTERVAL_SECONDS ?? DEFAULT_SYNC_COOLDOWN_SECONDS);
    const cooldown = checkSyncCooldown(state.lastAttemptedSyncAt, new Date(), cooldownSeconds);
    if (!cooldown.allowed) {
      throw new ApiError(
        429,
        `Sinhronizacija je već urađena. Sačekajte ${cooldown.waitSeconds} s da ne bismo opterećivali giga.ba.`,
        'sync_cooldown',
      );
    }

    if (body.mode === 'full') {
      // A full catalogue import must not block a web request. It is launched as
      // the standalone worker; deployment should prefer the scheduler instead.
      try {
        const child = spawn('npx', ['tsx', 'worker/cli.ts', '--mode=full'], {
          cwd: process.cwd(),
          detached: true,
          stdio: 'ignore',
          shell: true,
        });
        child.unref();
        return ok(
          {
            started: true,
            background: true,
            message:
              'Puni import je pokrenut u pozadini kao worker proces. Status pratite ovdje ili pokrenite `npm run scraper:status`.',
          },
          { status: 202 },
        );
      } catch (err) {
        throw new ApiError(
          500,
          `Nije moguće pokrenuti worker proces: ${err instanceof Error ? err.message : 'nepoznata greška'}. Pokrenite \`npm run scraper:full\` na serveru.`,
          'worker_spawn_failed',
        );
      }
    }

    const result = await runScrape({
      mode: body.mode,
      limit: body.limit,
      maxPages: body.maxPages,
      triggeredBy: 'manual',
    });

    return ok({
      started: false,
      run: result.run,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      failed: result.failed,
      failures: result.failures,
      status: await scraperStatus(),
    });
  } catch (err) {
    return jsonError(err);
  }
}
