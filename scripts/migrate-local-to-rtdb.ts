/**
 * Kopira lokalnu JSON bazu (.data/db.json) u Firebase Realtime Database.
 *
 *   npm run migrate:rtdb            # kopira sve
 *   npm run migrate:rtdb -- --prod  # isto, ali bez potvrde (za skripte)
 *
 * Skripta je idempotentna: upisuje iste ključeve, ne duplira podatke.
 * Ne briše ništa u lokalnoj bazi.
 */
import { readFileSync, existsSync } from 'node:fs';
import { config } from 'dotenv';
import { initializeApp, cert, getApps, type ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

config({ path: '.env.local', quiet: true });

type Json = Record<string, unknown>;

const DB_FILE = '.data/db.json';

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function groupBy<T>(rows: T[], key: (row: T) => string | undefined): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const owner = key(row);
    const id = (row as { id?: string }).id;
    if (!owner || !id) continue;
    out[owner] ??= {};
    out[owner][id] = row;
  }
  return out;
}

function groupSessions(rows: Json[]): Record<string, Record<string, unknown>> {
  return groupBy(rows, (row) => (row as { userId?: string }).userId);
}

function groupByParent(rows: Json[], parentKey: string) {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const row of rows) {
    const parent = (row as Record<string, unknown>)[parentKey] as string | undefined;
    const id = (row as { id?: string }).id;
    if (!parent || !id) continue;
    out[parent] ??= {};
    out[parent][id] = row as Record<string, unknown>;
  }
  return out;
}

async function main() {
  if (!existsSync(DB_FILE)) fail(`Nema ${DB_FILE} — lokalna baza je prazna.`);

  const url = process.env.FIREBASE_DB_URL ?? process.env.FIREBASE_DATABASE_URL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!url) fail('FIREBASE_DB_URL nije postavljen u .env.local.');
  if (!projectId || !clientEmail || !privateKey) {
    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!path) fail('Nema servisnog računa (FIREBASE_SERVICE_ACCOUNT_PATH).');
    const sa = JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount;
    const app =
      getApps().find((a) => a.name === 'giga-migrate') ??
      initializeApp({ credential: cert(sa), databaseURL: url }, 'giga-migrate');
    await run(getDatabase(app), JSON.parse(readFileSync(DB_FILE, 'utf8')) as Json);
    return;
  }

  const app =
    getApps().find((a) => a.name === 'giga-migrate') ??
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), databaseURL: url }, 'giga-migrate');
  await run(getDatabase(app), JSON.parse(readFileSync(DB_FILE, 'utf8')) as Json);
}

async function run(db: ReturnType<typeof getDatabase>, data: Json) {
  const list = <T>(key: string): T[] => {
    const value = data[key];
    if (!value) return [];
    return Array.isArray(value) ? (value as T[]) : Object.values(value as Record<string, T>);
  };

  const products = list<Json>('products');
  const additional = Object.values((data.productAdditional ?? {}) as Record<string, Json>);
  const users = Object.keys((data.users ?? {}) as Record<string, unknown>);
  const sessions = list<Json>('sessions');
  const messages = groupByParent(list<Json>('messages'), 'sessionId');
  const turns = groupByParent(list<Json>('turns'), 'sessionId');
  const replies = groupByParent(list<Json>('replies'), 'sessionId');
  const quickReplies = groupBy(list<Json>('quickReplies'), (r) => (r as { userId?: string }).userId);
  const procedures = groupBy(list<Json>('procedures'), (r) => (r as { userId?: string }).userId);
  const runs = list<Json>('scraperRuns');

  const jobs: { label: string; path: string; value: unknown }[] = [
    { label: 'korisnici', path: 'giga_users', value: data.users ?? {} },
    { label: 'proizvodi', path: 'giga_products', value: data.products ?? {} },
    { label: 'dodatni podaci proizvoda', path: 'giga_additional', value: data.productAdditional ?? {} },
    { label: 'sesije', path: 'giga_sessions', value: groupSessions(sessions) },
    { label: 'poruke', path: 'giga_messages', value: groupBySessionOwner(messages) },
    { label: 'AI razgovori', path: 'giga_turns', value: groupBySessionOwner(turns) },
    { label: 'odgovori', path: 'giga_replies', value: groupBySessionOwner(replies) },
    { label: 'brzi odgovori', path: 'giga_quickReplies', value: quickReplies },
    { label: 'procedure', path: 'giga_procedures', value: procedures },
    { label: 'postavke', path: 'giga_settings', value: data.settings ?? {} },
    { label: 'scraper stanje', path: 'giga_meta/scraperState', value: data.scraperState ?? {} },
    { label: 'scraper pokretanja', path: 'giga_runs', value: Object.fromEntries(runs.map((r) => [String(r.id), r])) },
  ];

  for (const job of jobs) {
    const hasData = Object.keys((job.value as Record<string, unknown>) ?? {}).length > 0;
    if (!hasData) {
      console.log(`• ${job.label}: preskočeno (nema podataka)`);
      continue;
    }
    await db.ref(job.path).set(clean(job.value));
    const size = countLeaves(job.value);
    console.log(`✓ ${job.label}: ${size} zapisa → ${job.path}`);
  }

  console.log(`\nGotovo. Korisnici: ${users.length || 'lokalni'}, proizvoda: ${products.length}, dodatnih: ${additional.length}.`);
}

/** messages/turns/replies su grupisani po sessionId; treba ih smjestiti pod vlasnika sesije. */
function groupBySessionOwner(grouped: Record<string, Record<string, Record<string, unknown>>>): Json {
  const out: Record<string, Record<string, Record<string, Json>>> = {};
  for (const [sessionId, rows] of Object.entries(grouped)) {
    for (const [id, row] of Object.entries(rows)) {
      const owner = (row as { userId?: string }).userId;
      if (!owner) continue;
      out[owner] ??= {};
      out[owner][sessionId] ??= {};
      out[owner][sessionId][id] = row;
    }
  }
  return out;
}

function countLeaves(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const child of Object.values(value as Record<string, unknown>)) {
    total += child && typeof child === 'object' ? Math.max(1, countLeaves(child)) : 1;
  }
  return total;
}

main().catch((err) => {
  console.error('✖ Migracija nije uspjela:', err instanceof Error ? err.message : err);
  process.exit(1);
});
