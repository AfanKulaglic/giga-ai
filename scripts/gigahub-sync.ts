/**
 * GigaHub -> nasa baza: tezina, dimenzije i stanje (samo CITANJE GigaHuba).
 *
 * GigaHub je mjerodavan za stanje (R31), a tezina i dimenzije dolaze iz
 * GigaHub artikla (R32). Ovaj skript ne mijenja nista na GigaHubu: otvara
 * stranicu artikla u vec prijavljenom Chrome-u i cita tekst.
 *
 * Upotreba:
 *   npx tsx scripts/gigahub-sync.ts --limit 20 --dry    (samo prikazi)
 *   npx tsx scripts/gigahub-sync.ts --limit 20          (upisi 20)
 *   npx tsx scripts/gigahub-sync.ts --only 63713        (jedan artikal)
 *   npx tsx scripts/gigahub-sync.ts                     (svi, nastavlja gdje je stao)
 *
 * Pretpostavke: Chrome je pokrenut sa --remote-debugging-port=9222 i korisnik
 * je prijavljen na GigaHub. Skript se prekida sam ako stranica trazi prijavu.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import puppeteer from 'puppeteer-core';

const PROGRESS_FILE = join('backups', 'gigahub-progress.json');
const CDP_URL = process.env.GIGAHUB_CDP_URL ?? 'http://localhost:9222';
const GAP_MS = Number(process.env.GIGAHUB_GAP_MS ?? 600);

interface Found {
  name: string;
  weightKg: number | null;
  dimensionsCm: { lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null;
  quantity: number | null;
  /** Prodavnica navodi da se artikal moze naruciti, ali ne pise koliko komada. */
  availableUnquantified: boolean;
  fiscalCode: string | null;
  notFound: boolean;
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(process.cwd(), '.env.local');
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]!] = match[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

function num(value: string | null): number | null {
  if (!value) return null;
  const match = /(-?\d+[.,]?\d*)/.exec(value.replace(/\s/g, ''));
  if (!match) return null;
  const parsed = Number(match[1]!.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function after(lines: string[], pattern: RegExp, lookahead = 1): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i]!)) {
      for (let j = i + 1; j <= i + lookahead && j < lines.length; j += 1) {
        const candidate = lines[j]!.trim();
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

/** Cita jedno artikal-stranicu i vraca ono sto GigaHub zaista prikazuje. */
async function readArticle(page: import('puppeteer-core').Page, sku: string): Promise<Found> {
  const url = `https://gigahub.ba/article/${sku}/a`;
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const finalUrl = page.url();
  if (/\/login/i.test(finalUrl)) throw new Error('GigaHub trazi prijavu — prijavite se u Chrome prozoru.');
  if (!response || response.status() >= 400) {
    return {
      name: '',
      weightKg: null,
      dimensionsCm: null,
      quantity: null,
      availableUnquantified: false,
      fiscalCode: null,
      notFound: true,
    };
  }
  const lines = (await page.evaluate(() => document.body.innerText)) as string;
  const list = lines
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Naziv je najduzi red izmedju "GRESKA" i prve cijene ("140.00 KM").
  const greskaIndex = list.findIndex((line) => /^GRESKA$/i.test(line));
  const priceIndex = list.findIndex((line, index) => index > greskaIndex && /^[\d.,]+\s*KM$/i.test(line));
  const nameCandidates =
    greskaIndex >= 0 && priceIndex > greskaIndex ? list.slice(greskaIndex + 1, priceIndex) : list.slice(0, 8);
  const name = nameCandidates.sort((a, b) => b.length - a.length)[0] ?? '';

  const weightRaw = after(list, /^Tezina/i);
  let weightKg = num(weightRaw);
  if (weightKg !== null && weightRaw && /\(g\)/i.test(weightRaw)) weightKg = weightKg / 1000;

  const widthCm = num(after(list, /^Širina/i));
  const lengthCm = num(after(list, /^Dubina/i));
  const heightCm = num(after(list, /^Visina/i));
  const dimensionsCm =
    widthCm || lengthCm || heightCm ? { lengthCm, widthCm, heightCm } : null;

  // "Dostupno:" pa brojevi po prodavnicama; kod nekih artikala odmah broj.
  let quantity: number | null = null;
  const stockIndex = list.findIndex((line) => /^Dostupno/i.test(line));
  if (stockIndex >= 0) {
    quantity = num(list[stockIndex + 1] ?? null);
    if (quantity === null) {
      const numbers = list
        .slice(stockIndex + 2, stockIndex + 9)
        .map((line) => (/^\d+$/.test(line) ? Number(line) : NaN))
        .filter((value) => Number.isFinite(value));
      if (numbers.length) quantity = numbers.reduce((sum, value) => sum + value, 0);
    }
  }
  // Neki artikli nemaju broj komada, nego samo "Dostupnost: Prodavnica …"
  // uz napomenu da se mogu naruciti/preuzeti — to je dostupno, bez broja.
  const availabilityBlock = list.slice(
    Math.max(0, list.findIndex((line) => /^Dostupnost/i.test(line))),
    list.findIndex((line) => /^Dostupnost/i.test(line)) + 6,
  );
  const availableUnquantified =
    quantity === null &&
    availabilityBlock.length > 0 &&
    availabilityBlock.some((line) => /Prodavnica|moguće naručiti|moguce naruciti|preuzeti/i.test(line)) &&
    !availabilityBlock.some((line) => /rasprodan|nema na stanju|nije dostupno/i.test(line));

  return {
    name,
    weightKg,
    dimensionsCm,
    quantity,
    availableUnquantified,
    fiscalCode: after(list, /^Sifra u kasi/i),
    notFound: false,
  };
}

function loadProgress(): Record<string, string> {
  if (!existsSync(PROGRESS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveProgress(progress: Record<string, string>): void {
  mkdirSync('backups', { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Number.MAX_SAFE_INTEGER;
  const onlyArg = args.indexOf('--only');
  const only = onlyArg >= 0 ? args[onlyArg + 1] : null;
  const dry = args.includes('--dry');
  const all = args.includes('--all');

  const env = loadEnv();
  const credentialPath = (env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '').replace(/^~/, homedir());
  const serviceAccount = JSON.parse(readFileSync(credentialPath, 'utf8'));
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount), databaseURL: env.FIREBASE_DB_URL });
  }
  const db = getDatabase();

  const snapshot = await db.ref('giga_products').get();
  const products = Object.values((snapshot.val() ?? {}) as Record<string, { id: string; name: string; sku?: string | null }>);
  console.log(`Proizvoda u bazi: ${products.length}`);

  const progress = loadProgress();
  let targets = products.filter((product) => product.sku);
  if (only) targets = products.filter((product) => product.sku === only);
  else if (!all) targets = targets.filter((product) => !progress[product.id]);
  targets = targets.slice(0, limit);
  console.log(`Za obradu: ${targets.length}${dry ? ' (probni rezim, bez upisa)' : ''}`);

  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const workers = Math.max(1, Math.min(4, Number(process.env.GIGAHUB_CONCURRENCY ?? 3)));
  const pages = await Promise.all(
    Array.from({ length: workers }, async () => {
      const created = await browser.newPage();
      created.setDefaultTimeout(60000);
      return created;
    }),
  );

  let done = 0;
  let updated = 0;
  let missing = 0;
  let cursor = 0;
  let stopped = false;

  const handle = async (page: import('puppeteer-core').Page, product: { id: string; name: string; sku?: string | null }) => {
    const sku = product.sku!;
    let found: Found | null = null;
    try {
      found = await readArticle(page, sku);
    } catch (error) {
      stopped = true;
      console.log(`STOP: ${(error as Error).message}`);
      return;
    }
    done += 1;
    if (found.notFound) {
      missing += 1;
      progress[product.id] = 'not_found';
    } else {
      updated += 1;
      progress[product.id] = new Date().toISOString();
      const stockStatus =
        found.quantity !== null
          ? found.quantity >= 2
            ? 'in_stock'
            : 'out_of_stock'
          : found.availableUnquantified
            ? 'in_stock'
            : 'out_of_stock';
      if (!dry) {
        if (found.weightKg !== null || found.dimensionsCm) {
          const existing = (await db.ref(`giga_additional/${product.id}`).get()).val() as
            | { fields?: unknown[] }
            | null;
          await db.ref(`giga_additional/${product.id}`).update({
            productId: product.id,
            ...(existing?.fields ? { fields: existing.fields } : {}),
            weightKg: found.weightKg,
            dimensionsCm: found.dimensionsCm,
            updatedAt: new Date().toISOString(),
            updatedBy: 'gigahub-sync',
          });
        }
        await db.ref(`giga_products/${product.id}/availability`).set({
          status: stockStatus,
          raw:
            found.quantity === null
              ? found.availableUnquantified
                ? 'GigaHub: dostupno u prodavnici'
                : 'GigaHub: bez podatka'
              : `GigaHub: ${found.quantity} kom`,
          checkedAt: new Date().toISOString(),
          source: 'gigahub',
          quantity: found.quantity,
        });
      }
      if (dry) {
        console.log(
          `${sku} | ${found.name.slice(0, 44)} | ${found.weightKg ?? '-'} kg | ` +
            `${found.dimensionsCm ? `${found.dimensionsCm.widthCm}x${found.dimensionsCm.lengthCm}x${found.dimensionsCm.heightCm}` : '-'} | ` +
            `${found.quantity ?? '-'} kom -> ${stockStatus}`,
        );
      }
    }
    if (done % 50 === 0) {
      saveProgress(progress);
      console.log(`... ${done}/${targets.length} (${updated} sa podacima, ${missing} nema)`);
    }
  };

  const runWorker = async (page: import('puppeteer-core').Page) => {
    while (!stopped) {
      const product = targets[cursor];
      cursor += 1;
      if (!product) return;
      await handle(page, product);
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
  };

  await Promise.all(pages.map((page) => runWorker(page)));
  saveProgress(progress);
  await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
  await browser.disconnect();
  console.log(`Gotovo: ${done} obradjeno, ${updated} sa podacima, ${missing} nije nadjeno.`);
}

main().catch((error) => {
  console.error('GRESKA:', error);
  process.exit(1);
});
