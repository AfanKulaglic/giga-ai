import { serverEnv } from '@/lib/config/env';
import type { ShopifyProduct } from '@/lib/domain/productNormalize';
import { acquireSiteSlot } from '@/lib/site/siteGuard';

// ---------------------------------------------------------------------------
// GIGA.ba Shopify JSON client.
// The storefront is Shopify; robots.txt explicitly allows public product data.
// Requests are conservative: bounded concurrency, delay, retries with backoff.
// ---------------------------------------------------------------------------

export interface FetchPageResult {
  products: ShopifyProduct[];
  page: number;
  requestUrl: string;
}

export class GigaApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GigaApiError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function productsUrl(page: number, limit: number): string {
  const base = serverEnv.scraper.baseUrl.replace(/\/$/, '');
  return `${base}/products.json?limit=${limit}&page=${page}`;
}

export async function fetchProductsPage(page: number, limit = serverEnv.scraper.pageSize): Promise<FetchPageResult> {
  // Granica važi i za uvoz: nikad preko nje, čak ni kad se uvoz pokrene ručno.
  if (!acquireSiteSlot()) {
    throw new GigaApiError('Granica zahtjeva prema giga.ba je dosegnuta — uvoz je zaustavljen.', 429, false);
  }
  const url = productsUrl(page, limit);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= serverEnv.scraper.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': serverEnv.scraper.userAgent,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        throw new GigaApiError(`HTTP ${res.status} za ${url}`, res.status, true);
      }
      if (!res.ok) {
        throw new GigaApiError(`HTTP ${res.status} za ${url}`, res.status, false);
      }
      const data = (await res.json()) as { products?: ShopifyProduct[] };
      if (!data || !Array.isArray(data.products)) {
        throw new GigaApiError('Odgovor nema "products" niz.', res.status, false);
      }
      return { products: data.products, page, requestUrl: url };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof GigaApiError ? err.retryable : true;
      if (!retryable || attempt === serverEnv.scraper.maxRetries) break;
      const backoff = Math.min(30_000, 800 * 2 ** attempt) + Math.floor(Math.random() * 250);
      console.warn(`[scraper] pokušaj ${attempt + 1} nije uspio (${(err as Error).message}); čekam ${backoff} ms`);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new GigaApiError(
    `Nije moguće dohvatiti ${url}: ${lastError instanceof Error ? lastError.message : 'nepoznata greška'}`,
    lastError instanceof GigaApiError ? lastError.status : null,
    false,
  );
}

export async function politeDelay(): Promise<void> {
  if (serverEnv.scraper.requestDelayMs > 0) await sleep(serverEnv.scraper.requestDelayMs);
}

/** Simple bounded-concurrency mapper. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
