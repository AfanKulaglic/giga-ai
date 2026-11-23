import { describe, expect, it } from 'vitest';
import { findPostalCodesInText, lookupPostalCodes, normalizePlace } from '@/lib/domain/postalCodes';

describe('postal code lookup', () => {
  it('finds the main post office for big cities', () => {
    expect(lookupPostalCodes('Sarajevo')[0]?.code).toBe('71000');
    expect(lookupPostalCodes('banja luka')[0]?.code).toBe('78000');
    expect(lookupPostalCodes('Zenica')[0]?.code).toBe('72101');
    expect(lookupPostalCodes('Mostar')[0]?.code).toBe('88000');
    expect(lookupPostalCodes('Bihać')[0]?.code).toBe('77000');
    expect(lookupPostalCodes('Brčko')[0]?.code).toBe('76100');
  });

  it('ignores diacritics and returns the place for a code', () => {
    expect(normalizePlace('Široki Brijeg')).toBe('siroki brijeg');
    expect(lookupPostalCodes('siroki brijeg')[0]?.code).toBe('88220');
    expect(lookupPostalCodes('71000')[0]?.place).toBe('Sarajevo');
  });

  it('returns nothing for an unknown place instead of guessing', () => {
    expect(lookupPostalCodes('Nepostojeće Selo')).toEqual([]);
    expect(lookupPostalCodes('')).toEqual([]);
  });
});

describe('places mentioned in a message', () => {
  it('understands inflected city names', () => {
    expect(findPostalCodesInText('dolazim iz Banje Luke')[0]?.code).toBe('78000');
    expect(findPostalCodesInText('živim u Zenici')[0]?.code).toBe('72101');
    expect(findPostalCodesInText('pošaljite u Travnik')[0]?.code).toBe('72270');
    expect(findPostalCodesInText('iz Mostara sam')[0]?.place).toBe('Mostar');
  });

  it('prefers the full place name over a containing one', () => {
    expect(findPostalCodesInText('šaljite u Istočno Sarajevo')[0]?.place).toBe('Istočno Sarajevo');
    expect(findPostalCodesInText('iz Mostara sam')[0]?.place).not.toBe('Sanski Most');
  });

  it('reads a written postal code', () => {
    expect(findPostalCodesInText('adresa Bihać 77000')[0]?.code).toBe('77000');
  });

  it('finds nothing in a product question', () => {
    expect(findPostalCodesInText('imate li noćne ormarice')).toEqual([]);
  });
});
