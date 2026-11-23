/**
 * Podešava Vercel projekat preko REST API-ja — bez dashboarda i bez CLI prijave.
 *
 *   VERCEL_TOKEN=... node scripts/vercel-push-env.mjs [ime-projekta]
 *
 * Šta radi:
 *   1) nađe projekat po imenu
 *   2) pošalje sve potrebne varijable (Production + Preview), upsert
 *   3) pokrene novi production deploy iz GitHub `main`
 *   4) sačeka da deploy bude READY i provjeri /api/health
 *
 * Ispisuje samo imena varijabli i dužine vrijednosti — nikad same vrijednosti.
 */
import { existsSync, readFileSync } from 'node:fs';

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error('Nema VERCEL_TOKEN u okruženju.');
  process.exit(1);
}
const projectName = process.argv[2] ?? 'giga-ai';
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body).slice(0, 220)}`);
  return body;
};

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = parseEnv(readFileSync('.env.local', 'utf8'));

// Klijentski Firebase Auth se ne koristi — njegove NEXT_PUBLIC_ varijable su
// pravile 403 greške u konzoli, pa se ne prenose.
const COPY = [
  'AI_PROVIDER',
  'AI_MODEL',
  'AI_CONTEXT_MESSAGES',
  'AI_DAILY_TOKEN_BUDGET',
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'AUTH_MODE',
  'APP_PASSWORD',
  'FIREBASE_DB_URL',
  'LIVE_SITE_CHECK',
  'SCRAPER_MIN_INTERVAL_SECONDS',
  'AUTO_SYNC_MINUTES',
  'SITE_MAX_REQUESTS_PER_HOUR',
  'SITE_MIN_GAP_MS',
];

const values = {};
for (const key of COPY) {
  const value = env[key];
  if (value && !value.startsWith('[')) values[key] = value;
}

// Servisni račun kao base64 — jedan string, bez escapeovanja \n.
const saPath = env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!saPath || !existsSync(saPath)) {
  console.error('Servisni račun nije nađen na FIREBASE_SERVICE_ACCOUNT_PATH.');
  process.exit(1);
}
const saJson = readFileSync(saPath, 'utf8');
const sa = JSON.parse(saJson);
values.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from(saJson, 'utf8').toString('base64');
if (!values.FIREBASE_DB_URL) {
  const host = sa.project_id ? `${sa.project_id}-default-rtdb.firebaseio.com` : null;
  if (host) values.FIREBASE_DB_URL = `https://${host}`;
}

// Potpis kolačića mora biti stabilan između serverless instanci.
values.AUTH_SECRET =
  env.AUTH_SECRET ?? Buffer.from(`giga-auth-${sa.project_id ?? 'app'}-${env.APP_PASSWORD ?? ''}`).toString('base64url');

const projects = await api('/v9/projects?limit=100');
const project = (projects.projects ?? []).find((p) => p.name === projectName);
if (!project) {
  console.error(`Projekat ${projectName} nije nađen.`);
  process.exit(1);
}
console.log(`projekat: ${project.name} (${project.id})`);

const payload = Object.entries(values).map(([key, value]) => ({
  key,
  value,
  type: key === 'AUTH_SECRET' || /KEY/.test(key) || key.includes('SERVICE_ACCOUNT') ? 'encrypted' : 'plain',
  target: ['production', 'preview'],
}));

const created = await api(`/v10/projects/${project.id}/env?upsert=true`, {
  method: 'POST',
  body: JSON.stringify(payload),
});
for (const item of created.created ?? []) console.log(`✓ ${item.key} (${values[item.key]?.length ?? 0} znakova)`);
for (const item of created.failed ?? []) console.error(`✗ ${item.key ?? JSON.stringify(item).slice(0, 120)}`);

const deployment = await api('/v13/deployments', {
  method: 'POST',
  body: JSON.stringify({
    name: project.name,
    project: project.id,
    target: 'production',
    gitSource: { type: 'github', repoId: project.link.repoId, ref: 'main' },
  }),
});
console.log(`deploy pokrenut: https://${deployment.url}`);

const deadline = Date.now() + 9 * 60_000;
let state = deployment.readyState ?? 'QUEUED';
while (Date.now() < deadline && !['READY', 'ERROR', 'CANCELED'].includes(state)) {
  await new Promise((r) => setTimeout(r, 8000));
  const info = await api(`/v13/deployments/${deployment.id}`);
  state = info.readyState ?? info.status ?? state;
  process.stdout.write(`  ${state}\r`);
}
console.log(`\nstanje deploya: ${state}`);

const health = await fetch(`https://${project.name}.vercel.app/api/health`, { cache: 'no-store' });
const body = await health.json().catch(() => ({}));
console.log('health:', health.status, JSON.stringify(body).slice(0, 420));
