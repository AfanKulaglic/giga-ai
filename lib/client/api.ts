'use client';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;

export function setTokenProvider(provider: TokenProvider | null) {
  tokenProvider = provider;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');

  if (tokenProvider) {
    try {
      const token = await tokenProvider();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch {
      /* request will fail with 401 and surface a clear error */
    }
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiClientError('Nema veze sa serverom. Provjerite da aplikacija radi.', 0, 'network_error');
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const body = payload as { error?: string; code?: string; issues?: { path: string; message: string }[] } | null;
    const code = body?.code ?? 'request_failed';
    // Make the two failures the agent can actually act on explicit in the UI.
    const hint =
      code === 'ai_rate_limited'
        ? ' Groq kvota je potrošena — pokušajte poslije 01:00 ili nadogradite Groq plan.'
        : code === 'ai_not_configured'
          ? ' Provjerite AI_MODEL i ključ u .env.local, pa restartujte aplikaciju.'
          : '';
    throw new ApiClientError(
      (body?.error ?? `Zahtjev nije uspio (${res.status}).`) + hint,
      res.status,
      code,
      body?.issues,
    );
  }

  return payload as T;
}

export const jsonBody = (data: unknown): RequestInit => ({ body: JSON.stringify(data) });
