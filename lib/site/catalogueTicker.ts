import { getStore } from '@/lib/store';
import { runScrape } from '@/worker/sync';

/**
 * Automatsko osvježavanje kataloga u pozadini.
 *
 * Cijeli katalog je 10 strana `products.json` (2.500 proizvoda), pa jedan
 * ciklus na sat vremena praktično ne opterećuje giga.ba, a baza prestaje biti
 * "snimak od jučer". Detaljna provjera cijene i stanja ipak se radi tek onda
 * kad asistent piše odgovor ili kad se priprema narudžba (lib/site/gigaLive.ts).
 */

const DEFAULT_INTERVAL_MINUTES = 60;
/** Ne pokreći novi ciklus ako je prošli završio prije ovog vremena. */
const MIN_GAP_MINUTES = 45;

interface TickerState {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastStartedAt: number;
}

const globalForTicker = globalThis as unknown as { __gigaCatalogueTicker?: TickerState };

const state: TickerState = (globalForTicker.__gigaCatalogueTicker ??= {
  timer: null,
  running: false,
  lastStartedAt: 0,
});

function intervalMinutes(): number {
  const raw = Number(process.env.AUTO_SYNC_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(raw)) return DEFAULT_INTERVAL_MINUTES;
  return raw <= 0 ? 0 : Math.max(5, raw);
}

async function tick(): Promise<void> {
  if (state.running) return;
  if (Date.now() - state.lastStartedAt < MIN_GAP_MINUTES * 60_000) return;
  state.running = true;
  state.lastStartedAt = Date.now();
  try {
    const store = getStore();
    const scraperState = await store.getScraperState();
    if (scraperState.currentStatus === 'running') return;
    const result = await runScrape({ mode: 'sync', triggeredBy: 'schedule' });
    console.log(
      `[catalogue] automatsko osvježavanje: ${result.created} novo, ${result.updated} ažurirano, ${result.run.pagesFetched} strana`,
    );
  } catch (err) {
    console.error('[catalogue] automatsko osvježavanje nije uspjelo:', err instanceof Error ? err.message : err);
  } finally {
    state.running = false;
  }
}

/**
 * Pokreće pozadinski ciklus jednom po procesu. Isključeno sa
 * `AUTO_SYNC_MINUTES=0` (tada baza ide samo na ručnu sinhronizaciju).
 */
export function ensureCatalogueTicker(): void {
  const minutes = intervalMinutes();
  if (minutes <= 0 || state.timer) return;
  state.timer = setInterval(() => {
    void tick();
  }, minutes * 60_000);
  // Node ne treba čekati ovaj timer da bi proces završio.
  state.timer.unref?.();
  console.log(`[catalogue] automatsko osvježavanje svakih ${minutes} min`);
}
