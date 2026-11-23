import { describe, expect, it } from 'vitest';
import { quickReplySchema } from '@/lib/api/schemas';

const base = { label: 'Reklamacija', category: 'Reklamacije', message: 'Tekst poruke.' };

describe('šifre brzih odgovora', () => {
  it('prihvata kratku šifru', () => {
    expect(quickReplySchema.parse({ ...base, code: 'hhh' }).code).toBe('hhh');
  });

  it('prihvata odgovor bez šifre', () => {
    expect(quickReplySchema.parse(base).code).toBeUndefined();
  });

  it('odbija šifru sa razmakom ili znakom', () => {
    expect(() => quickReplySchema.parse({ ...base, code: 'h h' })).toThrow();
    expect(() => quickReplySchema.parse({ ...base, code: 'hh-h' })).toThrow();
  });

  it('odbija šifru dužu od 12 znakova', () => {
    expect(() => quickReplySchema.parse({ ...base, code: 'a'.repeat(13) })).toThrow();
  });
});
