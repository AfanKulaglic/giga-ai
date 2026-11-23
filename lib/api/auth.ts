import 'server-only';
import { ApiError } from './errors';
import { effectiveAuthMode, isFirebaseAdminConfigured } from '@/lib/config/env';
import { isValidAuthCookie, readCookie } from '@/lib/api/authCookie';
import { getStore } from '@/lib/store';

export interface AuthContext {
  userId: string;
  email: string | null;
  mode: 'firebase' | 'local';
}

export const LOCAL_USER_ID = 'local-user';

function authorizedEmails(): string[] {
  return (process.env.AUTHORIZED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function verifyFirebaseToken(token: string): Promise<AuthContext> {
  const { getApps, initializeApp, cert } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { serverEnv } = await import('@/lib/config/env');

  const app =
    getApps().find((a) => a.name === 'giga-assistant') ??
    initializeApp(
      {
        credential: cert({
          projectId: serverEnv.firebaseAdmin.projectId!,
          clientEmail: serverEnv.firebaseAdmin.clientEmail!,
          privateKey: serverEnv.firebaseAdmin.privateKey!,
        }),
      },
      'giga-assistant',
    );

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(token, true);
  } catch {
    throw new ApiError(401, 'Sesija je istekla. Prijavite se ponovo.', 'unauthenticated');
  }

  const email = decoded.email?.toLowerCase() ?? null;
  const allowlist = authorizedEmails();
  if (allowlist.length && (!email || !allowlist.includes(email))) {
    throw new ApiError(403, 'Ovaj nalog nije ovlašten za pristup aplikaciji.', 'forbidden');
  }

  return { userId: decoded.uid, email, mode: 'firebase' };
}

/**
 * Every API request goes through this. In Firebase mode a valid ID token with
 * an authorized account is mandatory. In local mode there is exactly one
 * server-side account and the UI clearly shows that Firebase is not configured.
 */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const mode = effectiveAuthMode();

  if (mode === 'password') {
    if (!isValidAuthCookie(readCookie(req.headers.get('cookie')))) {
      throw new ApiError(401, 'Unesite šifru za pristup aplikaciji.', 'unauthenticated');
    }
    const store = getStore();
    await store.ensureUser(LOCAL_USER_ID, 'agent@local');
    return { userId: LOCAL_USER_ID, email: 'agent@local', mode: 'local' };
  }

  if (mode === 'local' || !isFirebaseAdminConfigured()) {
    const store = getStore();
    await store.ensureUser(LOCAL_USER_ID, 'local@localhost');
    return { userId: LOCAL_USER_ID, email: 'local@localhost', mode: 'local' };
  }

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'Niste prijavljeni.', 'unauthenticated');

  const ctx = await verifyFirebaseToken(token);
  await getStore().ensureUser(ctx.userId, ctx.email ?? undefined);
  return ctx;
}
