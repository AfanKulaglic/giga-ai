import { describe, expect, it } from 'vitest';
import { cooldownForRateLimit, createKeyRotator } from '@/lib/ai/keyRotator';
import { resolveAI } from '@/lib/config/providers';

describe('rotacija AI ključeva', () => {
  it('koristi prvi ključ dok je dostupan', () => {
    const keys = createKeyRotator(['a', 'b'], { now: () => 1000 });
    expect(keys.pick().key).toBe('a');
    expect(keys.pick().key).toBe('a');
  });

  it('prelazi na drugi ključ kad prvi potroši dnevni limit', () => {
    const keys = createKeyRotator(['a', 'b'], { now: () => 1000 });
    keys.coolDown(0, 60_000, 1000);
    expect(keys.pick().key).toBe('b');
    expect(keys.pick(2000).key).toBe('b');
  });

  it('vraća prvi ključ kad istekne cooldown', () => {
    const keys = createKeyRotator(['a', 'b'], { now: () => 1000 });
    keys.coolDown(0, 60_000, 1000);
    expect(keys.pick(62_000).key).toBe('a');
  });

  it('kad su svi potrošeni javlja koliko se čeka', () => {
    const keys = createKeyRotator(['a', 'b'], { now: () => 1000 });
    keys.coolDown(0, 30_000, 1000);
    keys.coolDown(1, 90_000, 1000);
    const picked = keys.pick(5000);
    expect(picked.key).toBe('');
    expect(picked.retryInMs).toBe(26_000);
  });

  it('dnevni limit drži ključ do ponoći po pacifičkom vremenu, minutni samo minut', () => {
    // 22.11.2026. 10:00 UTC = 02:00 po pacifičkom vremenu (PST, UTC-8),
    // pa je sljedeća ponoć 23.11. u 08:00 UTC = 09:00 kod nas.
    const at = Date.parse('2026-11-22T10:00:00.000Z');
    const daily = cooldownForRateLimit('You exceeded your current quota per day', null, at);
    expect(daily).toBe(Date.parse('2026-11-23T08:00:00.000Z') - at);
    expect(cooldownForRateLimit('rate limited', 20, at)).toBe(20_000);
    expect(cooldownForRateLimit('rate limited', null, at)).toBe(60_000);
  });

  it('ručno prebacivanje mijenja ključ koji se koristi', () => {
    const keys = createKeyRotator(['a', 'b', 'c'], { now: () => 1000 });
    keys.setPreferred(2);
    expect(keys.pick().key).toBe('c');
    expect(keys.status().map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('prijavljuje koliko je ključu ostalo do oslobađanja', () => {
    const keys = createKeyRotator(['a', 'b'], { now: () => 1000 });
    keys.coolDown(1, 120_000, 1000);
    expect(keys.status(31_000).map((s) => s.usableInMs)).toEqual([0, 90_000]);
  });

  it('čita više ključeva iz okruženja', () => {
    const env = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k1', GEMINI_API_KEY_2: 'k2', GEMINI_API_KEY_3: 'k3' };
    const ai = resolveAI(env as never);
    expect(ai.apiKeys).toEqual(['k1', 'k2', 'k3']);
    expect(resolveAI({ AI_PROVIDER: 'gemini', AI_API_KEYS: 'x, y ,x' } as never).apiKeys).toEqual(['x', 'y']);
  });
});
