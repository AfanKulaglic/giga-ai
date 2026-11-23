import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/config/env';

/** Cookie that marks a browser as unlocked with the shared app password. */
export const AUTH_COOKIE = 'giga_auth';
const TTL_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  // A dedicated AUTH_SECRET is optional; deriving it from the password keeps
  // the setup to a single value while still signing the cookie.
  return serverEnv.authSecret ?? `giga-auth-v1:${serverEnv.appPassword}`;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Constant-time password check; the app password never leaves the server. */
export function verifyAppPassword(input: string): boolean {
  if (!input) return false;
  return safeEqual(input.trim(), serverEnv.appPassword);
}

export function issueAuthCookieValue(now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + TTL_SECONDS;
  return `v1.${expiresAt}.${sign(String(expiresAt))}`;
}

export function isValidAuthCookie(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expiresAt = parts[1] ?? '';
  const signature = parts[2] ?? '';
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;
  return safeEqual(signature, sign(expiresAt));
}

export function readCookie(header: string | null | undefined, name = AUTH_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: TTL_SECONDS,
};
