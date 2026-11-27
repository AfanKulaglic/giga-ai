import { describe, expect, it } from 'vitest';
import { asksForSuggestion, complementaryGroup, matchesGroup, productGroup } from '@/lib/domain/complementary';

describe('dodatna prodaja (predlog uz proizvod)', () => {
  it('stolica traži stol, a stol traži stolicu', () => {
    expect(complementaryGroup('EASE TRPEZARIJSKA STOLICA SIVA')).toBe('table');
    expect(complementaryGroup('BACH TRPEZARIJSKI STOL ART197T')).toBe('chair');
    expect(complementaryGroup('MERCADO BAR STOLICA J001G')).toBe('table');
  });

  it('krevet traži madrac i obrnuto', () => {
    expect(complementaryGroup('KREVET BRAČNI 180x200')).toBe('mattress');
    expect(complementaryGroup('MADRAC ORTOPEDSKI 90x200')).toBe('bed');
  });

  it('pištolj nije stol', () => {
    expect(productGroup('TAKTICKA TORBICA ZA PISTOLJ KHAKI')).toBeNull();
    expect(matchesGroup('TAKTICKA TORBICA ZA PISTOLJ KHAKI', 'table')).toBe(false);
  });

  it('predlog se prihvata samo iz tražene grupe', () => {
    expect(matchesGroup('BACH TRPEZARIJSKI STOL ART197T', 'table')).toBe(true);
    expect(matchesGroup('ARVEN TRPEZARIJSKA STOLICA X075', 'table')).toBe(false);
  });

  it('prepoznaje kada se predlog traži', () => {
    expect(asksForSuggestion('predloži mu još neki proizvod, neki sto koji bi išao uz ovu stolicu')).toBe(true);
    expect(asksForSuggestion('koliko košta ova stolica')).toBe(false);
  });
});
