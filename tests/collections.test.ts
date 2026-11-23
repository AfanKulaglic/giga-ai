import { describe, expect, it } from 'vitest';
import { matchCollection, collectionLinkLine } from '@/lib/domain/collections';

describe('link na kategoriju giga.ba', () => {
  it('grebalice i penjalice vode na istu kategoriju', () => {
    for (const text of ['koje sve grebalice imate', 'imate li penjalice za mačke', 'penjalica za macke']) {
      const collection = matchCollection(text);
      expect(collection?.handle).toBe('penjalice-grebalice-za-macke');
      expect(collectionLinkLine(collection!)).toContain('https://giga.ba/collections/penjalice-grebalice-za-macke');
    }
  });

  it('„komode” vodi na najveću komoda-kategoriju, ne na TV komode', () => {
    expect(matchCollection('koje sve komode imate')?.handle).toBe('giga-komode-sve');
    expect(matchCollection('komode sa ladicama')?.handle).toBe('giga-komode-sa-ladicama');
  });

  it('bez poklapanja ne izmišlja link', () => {
    expect(matchCollection('koliko kosta dostava')).toBeNull();
    expect(matchCollection('')).toBeNull();
  });
});

describe('opšte pitanje vs konkretan model', () => {
  it('konkretan model i dimenzija nijesu opšte pitanje o ponudi', async () => {
    const { mentionsSpecificModel } = await import('@/lib/ai/offer');
    const names = ['AURA KOMODA LADIČAR 4 LADICE', 'BIFROST PENJALICA GREBALICA ZA MAČKE 58X200CM MT51'];
    expect(mentionsSpecificModel('Imate li Aura komodu?', names)).toBe(true);
    expect(mentionsSpecificModel('Imate li penjalicu 58x200?', names)).toBe(true);
    expect(mentionsSpecificModel('Koje sve komode imate?', names)).toBe(false);
    expect(mentionsSpecificModel('Koje sve grebalice imate na stanju?', names)).toBe(false);
  });
});
