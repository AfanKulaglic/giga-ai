import { NextResponse } from 'next/server';
import { z } from 'zod';
import { effectiveAuthMode } from '@/lib/config/env';
import { AUTH_COOKIE, authCookieOptions, issueAuthCookieValue, verifyAppPassword } from '@/lib/api/authCookie';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  if (effectiveAuthMode() !== 'password') {
    return NextResponse.json(
      { error: 'Prijava šifrom nije uključena.', code: 'auth_mode_mismatch' },
      { status: 400 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Unesite šifru.', code: 'invalid_request' }, { status: 400 });
  }

  if (!verifyAppPassword(parsed.password)) {
    return NextResponse.json({ error: 'Pogrešna šifra.', code: 'invalid_password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...authCookieOptions, name: AUTH_COOKIE, value: issueAuthCookieValue() });
  return res;
}
