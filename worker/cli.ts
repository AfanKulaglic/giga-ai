import { runScrape, scraperStatus, type ScrapeMode } from './sync';
import { serverEnv } from '@/lib/config/env';

// The CLI runs outside Next.js, so .env.local is not loaded automatically.
// It is passed with `tsx --env-file=.env.local` in package.json; without it the
// scraper would silently write into .data/db.json instead of the database.

// Standalone worker / CLI. This is the long-running component that imports the
// GIGA.ba catalogue. It shares the exact store layer with the web app.

interface CliArgs {
  mode: 'test' | 'full' | 'sync' | 'status' | 'schedule' | 'help';
  limit?: number;
  maxPages?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: 'help' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--mode=')) args.mode = arg.slice(7) as CliArgs['mode'];
    else if (arg === '--mode') args.mode = (argv[++i] ?? 'help') as CliArgs['mode'];
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice(8));
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg.startsWith('--max-pages=')) args.maxPages = Number(arg.slice(12));
    else if (arg === '--max-pages') args.maxPages = Number(argv[++i]);
  }
  return args;
}

function help() {
  console.log(`GIGA.ba katalog sync worker

Upotreba:
  npm run scraper:test        Uvezi 10 proizvoda i validiraj ekstrakciju
  npm run scraper:full        Uvezi cijeli katalog
  npm run scraper:sync        Jedan inkrementalni prolaz (do ${serverEnv.scraper.intervalMinutes} min interval u scheduleru)
  npm run scraper:status      Prikaži status zadnje sinhronizacije
  npm run scraper:schedule    Pokreni periodičnu sinhronizaciju (pozadinski proces)

Opcije: --limit=N --max-pages=N
Konfiguracija: GIGA_BASE_URL, SCRAPER_CONCURRENCY, SCRAPER_DELAY_MS,
SCRAPER_INTERVAL_MINUTES, FIREBASE_* (za Firestore) ili LOCAL_DATA_DIR.`);
}

async function schedule() {
  console.log(
    `[worker] periodična sinhronizacija svakih ${serverEnv.scraper.intervalMinutes} min. Ctrl+C za prekid.`,
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log('[worker] zaustavljanje nakon tekućeg ciklusa…');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      await runScrape({ mode: 'sync', triggeredBy: 'schedule' });
    } catch (err) {
      console.error('[worker] ciklus nije uspio:', err instanceof Error ? err.message : err);
    }
    const waitMs = serverEnv.scraper.intervalMinutes * 60_000;
    console.log(`[worker] sljedeći ciklus za ${serverEnv.scraper.intervalMinutes} min`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.mode) {
    case 'test':
    case 'full':
    case 'sync': {
      const mode = args.mode as ScrapeMode;
      if (mode === 'full' && args.limit === undefined) {
        console.log('[worker] PUNI IMPORT: molimo potvrdite da je test od 10 proizvoda prošao.');
      }
      const result = await runScrape({
        mode,
        limit: args.limit,
        maxPages: args.maxPages,
        triggeredBy: 'cli',
      });
      console.log(JSON.stringify({ run: result.run, failures: result.failures }, null, 2));
      break;
    }
    case 'status': {
      const status = await scraperStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case 'schedule':
      await schedule();
      break;
    case 'help':
    default:
      help();
  }
}

main().catch((err) => {
  console.error('[worker] greška:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
