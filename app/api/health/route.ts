import { NextResponse } from 'next/server';
import { configurationStatus, isServerless, missingEnv } from '@/lib/config/env';

export const dynamic = 'force-dynamic';

/** Public configuration probe. Exposes booleans only, never secret values. */
export async function GET() {
  try {
    const status = configurationStatus();
    return NextResponse.json({ ok: true, serverless: isServerless(), missingEnv: missingEnv(), ...status });
  } catch (err) {
    // Poruka mora reći šta tačno dodati, inače deploy izgleda „pokvaren”.
    return NextResponse.json(
      {
        ok: false,
        serverless: isServerless(),
        missingEnv: (() => {
          try {
            return missingEnv();
          } catch {
            return [];
          }
        })(),
        error: err instanceof Error ? err.message : 'Konfiguracija nije ispravna.',
      },
      { status: 500 },
    );
  }
}
