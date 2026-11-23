import { randomUUID } from 'node:crypto';
import { getStore } from '@/lib/store/runtime';
import { normalizeShopifyProduct } from '@/lib/domain/productNormalize';
import type { Product, ScraperRun, ScraperState } from '@/lib/domain/types';
import { serverEnv } from '@/lib/config/env';
import { fetchProductsPage, politeDelay, GigaApiError } from './gigaClient';

export type ScrapeMode = 'test' | 'full' | 'sync';

export interface RunScrapeOptions {
  mode: ScrapeMode;
  /** Hard cap on imported products (test mode uses 10 by default). */
  limit?: number;
  maxPages?: number;
  triggeredBy?: ScraperRun['triggeredBy'];
  onLog?: (line: string) => void;
}

export interface RunScrapeResult {
  run: ScraperRun;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  failures: { productId: string | null; name: string | null; error: string }[];
}

function defaults(mode: ScrapeMode) {
  if (mode === 'test') return { limit: 10, maxPages: 1 };
  if (mode === 'full') return { limit: undefined, maxPages: undefined };
  return { limit: undefined, maxPages: 10 }; // incremental sync pass
}

/**
 * Runs one synchronized catalogue pass. Test mode imports exactly 10 products
 * so the extraction can be validated before the full catalogue is imported.
 */
export async function runScrape(options: RunScrapeOptions): Promise<RunScrapeResult> {
  const store = getStore();
  const defaultsForMode = defaults(options.mode);
  const limit = options.limit ?? defaultsForMode.limit;
  const maxPages = options.maxPages ?? defaultsForMode.maxPages;
  const log = options.onLog ?? ((line: string) => console.log(`[scraper] ${line}`));

  const startedAt = new Date();
  const run: ScraperRun = {
    id: randomUUID(),
    mode: options.mode,
    status: 'running',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    pagesFetched: 0,
    productsSeen: 0,
    productsCreated: 0,
    productsUpdated: 0,
    productsUnchanged: 0,
    productsFailed: 0,
    errors: [],
    triggeredBy: options.triggeredBy ?? 'cli',
    durationMs: null,
  };
  await store.saveScraperRun(run);

  const previousState = await store.getScraperState();
  await store.saveScraperState({
    ...previousState,
    currentStatus: 'running',
    lastAttemptedSyncAt: startedAt.toISOString(),
    intervalMinutes: serverEnv.scraper.intervalMinutes,
  });

  const pending: Product[] = [];
  let page = 1;
  let reachedLimit = false;

  try {
    while (true) {
      if (maxPages !== undefined && page > maxPages) break;
      if (limit !== undefined && pending.length >= limit) {
        reachedLimit = true;
        break;
      }

      const result = await fetchProductsPage(page);
      run.pagesFetched++;
      log(`strana ${page}: ${result.products.length} proizvoda`);

      if (!result.products.length) break;

      for (const raw of result.products) {
        if (limit !== undefined && pending.length >= limit) {
          reachedLimit = true;
          break;
        }
        run.productsSeen++;
        try {
          const { product, warnings } = normalizeShopifyProduct(raw, {
            currency: 'BAM',
            domain: serverEnv.scraper.baseUrl,
          });
          if (warnings.length) {
            run.errors.push({
              message: `Upozorenja za "${product.name}": ${warnings.join(' ')}`,
              at: new Date().toISOString(),
              context: product.id,
            });
          }
          pending.push(product);
        } catch (err) {
          run.productsFailed++;
          run.errors.push({
            message: err instanceof Error ? err.message : String(err),
            at: new Date().toISOString(),
            context: `${raw?.id ?? '?'} / ${raw?.title ?? '?'}`,
          });
        }
      }

      if (reachedLimit) break;
      if (result.products.length < serverEnv.scraper.pageSize) break;
      page++;
      await politeDelay();
    }

    const upsert = await store.upsertProducts(pending);
    run.productsCreated = upsert.created;
    run.productsUpdated = upsert.updated;
    run.productsUnchanged = upsert.unchanged;
    run.productsFailed += upsert.failed;
    for (const failure of upsert.failures) {
      run.errors.push({ message: failure.error, at: new Date().toISOString(), context: failure.productId ?? undefined });
    }

    const finishedAt = new Date();
    run.finishedAt = finishedAt.toISOString();
    run.durationMs = finishedAt.getTime() - startedAt.getTime();
    run.status = run.productsFailed > 0 ? 'partial' : 'success';
    if (!run.pagesFetched) run.status = 'failed';

    await store.saveScraperRun(run);

    const state = await store.getScraperState();
    const totalProducts = await store.countProducts();
    const nextState: ScraperState = {
      lastSuccessfulSyncAt:
        run.status === 'failed' ? state.lastSuccessfulSyncAt : finishedAt.toISOString(),
      lastAttemptedSyncAt: startedAt.toISOString(),
      currentStatus: run.status === 'failed' ? 'error' : 'idle',
      intervalMinutes: serverEnv.scraper.intervalMinutes,
      totalProducts,
      lastRun: run,
    };
    await store.saveScraperState(nextState);

    log(
      `završeno: ${run.productsCreated} novo, ${run.productsUpdated} ažurirano, ${run.productsUnchanged} nepromijenjeno, ${run.productsFailed} neuspjelo za ${run.durationMs} ms`,
    );

    return {
      run,
      created: run.productsCreated,
      updated: run.productsUpdated,
      unchanged: run.productsUnchanged,
      failed: run.productsFailed,
      failures: upsert.failures,
    };
  } catch (err) {
    const finishedAt = new Date();
    run.finishedAt = finishedAt.toISOString();
    run.durationMs = finishedAt.getTime() - startedAt.getTime();
    run.status = 'failed';
    run.errors.push({
      message: err instanceof Error ? err.message : String(err),
      at: finishedAt.toISOString(),
    });
    await store.saveScraperRun(run).catch(() => undefined);

    const state = await store.getScraperState().catch(() => null);
    await store
      .saveScraperState({
        lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null,
        lastAttemptedSyncAt: startedAt.toISOString(),
        currentStatus: 'error',
        intervalMinutes: serverEnv.scraper.intervalMinutes,
        totalProducts: state?.totalProducts ?? 0,
        lastRun: run,
      })
      .catch(() => undefined);

    if (err instanceof GigaApiError) {
      log(`greška: ${err.message}`);
    } else {
      log(`neočekivana greška: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  }
}

export async function scraperStatus(): Promise<{
  state: ScraperState;
  runs: ScraperRun[];
  totalProducts: number;
}> {
  const store = getStore();
  const [state, runs, totalProducts] = await Promise.all([
    store.getScraperState(),
    store.listScraperRuns(15),
    store.countProducts(),
  ]);
  return { state: { ...state, totalProducts }, runs, totalProducts };
}
