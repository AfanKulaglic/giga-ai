
import { readFileSync } from 'node:fs';
import { resolveAI } from './providers';

function firstDefined(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim();
}

/**
 * Servisni račun se može dati na tri načina, da privatni ključ nikada ne mora
 * u chat, commit ili screenshot:
 *   1. FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS → putanja
 *   2. FIREBASE_SERVICE_ACCOUNT → JSON ili base64 JSON
 *   3. tri pojedinačne FIREBASE_* varijable
 * Čita se samo na serveru, pri pokretanju.
 */
function loadServiceAccount(): { projectId?: string; clientEmail?: string; privateKey?: string } {
  const inline = firstDefined(process.env.FIREBASE_SERVICE_ACCOUNT, process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
  let raw: string | null = null;

  if (inline) {
    raw = inline.trim().startsWith('{') ? inline : Buffer.from(inline, 'base64').toString('utf8');
  } else {
    const path = firstDefined(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (path) {
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        console.warn('[firebase] Servisni račun nije pronađen na zadatoj putanji.');
      }
    }
  }

  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: parsed.private_key };
  } catch {
    console.warn('[firebase] Servisni račun nije ispravan JSON.');
    return {};
  }
}

const serviceAccount = loadServiceAccount();
const privateKeyRaw = firstDefined(process.env.FIREBASE_PRIVATE_KEY, serviceAccount.privateKey);
const privateKey = privateKeyRaw?.replace(/\\n/g, '\n');

export const serverEnv = {
  nodeEnv: process.env.NODE_ENV ?? 'development',

  firebaseAdmin: {
    projectId: firstDefined(
      process.env.FIREBASE_PROJECT_ID,
      serviceAccount.projectId,
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    clientEmail: firstDefined(process.env.FIREBASE_CLIENT_EMAIL, serviceAccount.clientEmail),
    privateKey,
  },

  firebaseClient: {
    apiKey: firstDefined(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: firstDefined(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: firstDefined(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: firstDefined(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  },

  ai: resolveAI(process.env as Record<string, string | undefined>),

  scraper: {
    baseUrl: firstDefined(process.env.GIGA_BASE_URL) ?? 'https://giga.ba',
    pageSize: Number(firstDefined(process.env.SCRAPER_PAGE_SIZE) ?? '250'),
    concurrency: Math.max(1, Number(firstDefined(process.env.SCRAPER_CONCURRENCY) ?? '2')),
    requestDelayMs: Math.max(0, Number(firstDefined(process.env.SCRAPER_DELAY_MS) ?? '600')),
    maxRetries: Math.max(0, Number(firstDefined(process.env.SCRAPER_MAX_RETRIES) ?? '4')),
    intervalMinutes: Math.max(5, Number(firstDefined(process.env.SCRAPER_INTERVAL_MINUTES) ?? '360')),
    userAgent:
      firstDefined(process.env.SCRAPER_USER_AGENT) ??
      'GIGA.ba internal assistant sync bot (contact: configured by operator)',
  },

  // Realtime Database URL, e.g. https://<project>-default-rtdb.firebaseio.com
  firebaseDbUrl: firstDefined(process.env.FIREBASE_DB_URL, process.env.FIREBASE_DATABASE_URL),

  // 'password' = shared app password (default), 'firebase' = real accounts,
  // 'local' = no gate at all (only for a private single-user machine).
  authMode: ((): 'local' | 'firebase' | 'password' => {
    const raw = (firstDefined(process.env.AUTH_MODE) ?? 'password').toLowerCase();
    return raw === 'local' || raw === 'firebase' || raw === 'password' ? raw : 'password';
  })(),
  appPassword: firstDefined(process.env.APP_PASSWORD) ?? '2026',
  authSecret: firstDefined(process.env.AUTH_SECRET),

  allowLocalMode:
    (firstDefined(process.env.ALLOW_LOCAL_MODE) ?? 'true').toLowerCase() !== 'false',
} as const;

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(
    serverEnv.firebaseAdmin.projectId &&
      serverEnv.firebaseAdmin.clientEmail &&
      serverEnv.firebaseAdmin.privateKey,
  );
}

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    serverEnv.firebaseClient.apiKey &&
      serverEnv.firebaseClient.authDomain &&
      serverEnv.firebaseClient.projectId &&
      serverEnv.firebaseClient.appId,
  );
}

export function isAIConfigured(): boolean {
  return Boolean(serverEnv.ai.apiKey);
}

/** One clear sentence telling the operator exactly which variable is missing. */
export function aiMissingKeyMessage(): string {
  const ai = serverEnv.ai;
  if (ai.provider === 'ollama') {
    return 'AI nije dostupan. Pokrenite Ollama lokalno (ollama serve) ili promijenite AI_PROVIDER u .env.local.';
  }
  return `AI nije konfiguriran (${ai.label}). Dodajte ${ai.keyEnv ?? 'AI_API_KEY'} u .env.local i restartujte aplikaciju.`;
}

/** Vercel/Netlify/Lambda: fajl-sistem je samo za čitanje, lokalna baza ne radi. */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function storageMode(): 'rtdb' | 'firestore' | 'local' {
  if (isFirebaseAdminConfigured() && serverEnv.firebaseDbUrl) return 'rtdb';
  if (isFirebaseAdminConfigured()) return 'firestore';
  if (isServerless()) {
    // Bolje jasna poruka odmah nego 500 u svakom zahtjevu i vječito učitavanje.
    throw new Error(
      'Vercel nema trajnu bazu: nedostaje Firebase Realtime Database konfiguracija. Dodajte FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY i FIREBASE_DB_URL u Environment Variables, pa redeploy.',
    );
  }
  if (serverEnv.allowLocalMode) return 'local';
  throw new Error(
    'Firebase Admin nije konfiguriran (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY), a lokalni način je isključen.',
  );
}

/** Active login gate: shared password by default. */
export function effectiveAuthMode(): 'local' | 'firebase' | 'password' {
  return serverEnv.authMode;
}

/** Tačno koje varijable nedostaju — imena, nikad vrijednosti. */
export function missingEnv(): string[] {
  const missing: string[] = [];
  if (!serverEnv.firebaseAdmin.projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!serverEnv.firebaseAdmin.clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!serverEnv.firebaseAdmin.privateKey) missing.push('FIREBASE_PRIVATE_KEY (ili FIREBASE_SERVICE_ACCOUNT_BASE64)');
  if (!serverEnv.firebaseDbUrl) missing.push('FIREBASE_DB_URL');
  if (!isAIConfigured()) missing.push(serverEnv.ai.keyEnv ?? 'AI_API_KEY');
  return missing;
}

export function configurationStatus() {
  return {
    storage: storageMode(),
    firebaseAdmin: isFirebaseAdminConfigured(),
    firebaseClient: isFirebaseClientConfigured(),
    ai: isAIConfigured(),
    aiModel: serverEnv.ai.model,
    aiProvider: serverEnv.ai.provider,
    aiProviderLabel: serverEnv.ai.label,
    aiKeyEnv: serverEnv.ai.keyEnv,
    aiFreeTier: serverEnv.ai.freeTier,
    aiKeyCount: serverEnv.ai.apiKeys.length,
  };
}
