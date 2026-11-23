import { NextResponse } from 'next/server';
import { effectiveAuthMode } from '@/lib/config/env';
import { isValidAuthCookie, readCookie } from '@/lib/api/authCookie';

export const dynamic = 'force-dynamic';

/** Tells the browser which gate is active and whether it is already unlocked. */
export async function GET(req: Request) {
  const mode = effectiveAuthMode();
  const authenticated =
    mode === 'local' || (mode === 'password' && isValidAuthCookie(readCookie(req.headers.get('cookie'))));
  return NextResponse.json({ mode, authenticated }, { headers: { 'Cache-Control': 'no-store' } });
}
