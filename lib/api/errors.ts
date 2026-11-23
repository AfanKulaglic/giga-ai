import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: `Neispravni podaci: ${err.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || 'polje'} (${i.message})`)
          .join('; ')}`,
        code: 'validation_error',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }
  const message = err instanceof Error ? err.message : 'Neočekivana greška.';
  console.error('[api] unhandled error:', err);
  return NextResponse.json({ error: message, code: 'internal_error' }, { status: 500 });
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}
