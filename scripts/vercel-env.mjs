/**
 * Prenosi konfiguraciju iz .env.local na Vercel — bez klikanja u dashboardu.
 *
 *   1) npx vercel login                      (jednom, u browseru)
 *   2) node scripts/vercel-env.mjs giga-ai   (ime projekta na Vercelu)
 *
 * Šta radi:
 *   - uzme servisni račun sa FIREBASE_SERVICE_ACCOUNT_PATH i pretvori ga u
 *     FIREBASE_SERVICE_ACCOUNT_BASE64 (bez problema sa \n u privatnom ključu)
 *   - pošalje svaku potrebnu varijablu za Production i Preview
 *   - ne šalje ništa što počinje sa NEXT_PUBLIC_FIREBASE_ (klijentski Firebase
 *     Auth se ne koristi; pravio je 403 greške u konzoli)
 *   - ispiše samo imena varijabli i dužinu vrijednosti, nikad same vrijednosti
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const project = process.argv[2] ?? 'giga-ai';
const ENV_FILE = '.env.local';

if (!existsSync(ENV_FILE)) {
  console.error(`Nema ${ENV_FILE} — pokreni iz korijena projekta.`);
  process.exit(1);
}

/** Minimalni .env parser (bez dodatnih paketa). */
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));

// Varijable koje aplikacija stvarno koristi na serveru.
const ALLOWED = [
  'AI_PROVIDER',
  'AI_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'AI_DAILY_TOKEN_BUDGET',
  'AI_CONTEXT_MESSAGES',
  'AI_TIMEOUT_MS',
  'AUTH_MODE',
  'APP_PASSWORD',
  'AUTH_SECRET',
  'FIREBASE_DB_URL',
  'LIVE_SITE_CHECK',
  'SCRAPER_MIN_INTERVAL_SECONDS',
  'AUTO_SYNC_MINUTES',
  'SITE_MAX_REQUESTS_PER_HOUR',
  'SITE_MIN_GAP_MS',
  'GIGA_BASE_URL',
];

const payload = {};
for (const key of ALLOWED) {
  const value = env[key];
  if (value && !value.startsWith('[') && value.length > 0) payload[key] = value;
}

// Servisni račun → base64, da privatni ključ ne mora ručno da se escapeuje.
const path = env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (path && existsSync(path)) {
  const json = readFileSync(path, 'utf8');
  const parsed = JSON.parse(json);
  payload.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from(json, 'utf8').toString('base64');
  payload.FIREBASE_DB_URL = payload.FIREBASE_DB_URL ?? env.FIREBASE_DB_URL ?? '';
  if (!payload.FIREBASE_DB_URL) {
    console.warn('⚠ Nema FIREBASE_DB_URL — dodaj ga u .env.local prije nego što ovo pokreneš.');
  }
  console.log(`servisni račun: ${parsed.project_id} (${parsed.client_email})`);
} else {
  console.warn('⚠ Servisni račun nije nađen — preskačem FIREBASE_SERVICE_ACCOUNT_BASE64.');
}

// Šifra i tajna su obavezne za prijavu.
if (!payload.AUTH_SECRET) {
  payload.AUTH_SECRET = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64url');
  console.log('AUTH_SECRET: generisan nov (nije bio u .env.local)');
}

const targets = ['production', 'preview'];
const entries = Object.entries(payload).filter(([, v]) => typeof v === 'string' && v.length > 0);

for (const [key, value] of entries) {
  for (const target of targets) {
    try {
      // --force prepisuje postojeću vrijednost; vrijednost ide na stdin.
      execFileSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['vercel', 'env', 'add', key, target, '--force', '--project', project],
        { input: `${value}\n`, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      console.log(`✓ ${key} → ${target} (${value.length} znakova)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${key} → ${target}: ${message.split('\n')[0]}`);
    }
  }
}

console.log('\nGotovo. Sljedeće: npx vercel --prod --project ' + project);
