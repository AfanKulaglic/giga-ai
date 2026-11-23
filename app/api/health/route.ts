import { NextResponse } from 'next/server';
import { configurationStatus } from '@/lib/config/env';

export const dynamic = 'force-dynamic';

/** Public configuration probe. Exposes booleans only, never secret values. */
export async function GET() {
  try {
    const status = configurationStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Konfiguracija nije ispravna.' },
      { status: 500 },
    );
  }
}
