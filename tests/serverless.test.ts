import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLEAR = [
  'VERCEL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_SERVICE_ACCOUNT_BASE64',
  'FIREBASE_SERVICE_ACCOUNT_PATH',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'FIREBASE_DB_URL',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'ALLOW_LOCAL_MODE',
];

describe('Vercel bez baze', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of CLEAR) delete process.env[key];
  });
  afterEach(() => {
    for (const key of CLEAR) delete process.env[key];
  });

  it('ne vraća lokalnu bazu na serverless, nego imenuje varijable koje nedostaju', async () => {
    process.env.VERCEL = '1';
    const env = await import('@/lib/config/env');
    expect(env.isServerless()).toBe(true);
    expect(() => env.storageMode()).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() => env.storageMode()).toThrow(/FIREBASE_DB_URL/);
    expect(env.missingEnv()).toContain('FIREBASE_PROJECT_ID');
    expect(env.missingEnv()).toContain('FIREBASE_DB_URL');
  });

  it('lokalno van serverlessa lokalna baza je dozvoljena', async () => {
    const env = await import('@/lib/config/env');
    expect(env.isServerless()).toBe(false);
    expect(env.storageMode()).toBe('local');
  });
});
