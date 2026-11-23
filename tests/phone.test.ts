import { describe, expect, it } from 'vitest';
import { isUsableOrderPhone, normalizeOrderPhone, normalizeOrderPhones } from '@/lib/domain/phone';

describe('telefon za GigaHub', () => {
  it('uklanja državni poziv i crtice', () => {
    expect(normalizeOrderPhone('+387 62 576 456')).toBe('062576456');
    expect(normalizeOrderPhone('00387 62 576 456')).toBe('062576456');
    expect(normalizeOrderPhone('38762576456')).toBe('062576456');
    expect(normalizeOrderPhone('062/576-456')).toBe('062576456');
    expect(normalizeOrderPhone('062 576 456')).toBe('062576456');
  });

  it('dodaje vodeću nulu kada je nema', () => {
    expect(normalizeOrderPhone('62576456')).toBe('062576456');
    expect(normalizeOrderPhone('66234888')).toBe('066234888');
  });

  it('spaja više brojeva zarezom, bez duplikata', () => {
    expect(normalizeOrderPhones('+387 62 576 456, 066 234 888')).toBe('062576456, 066234888');
    expect(normalizeOrderPhones('062576456;062-576-456')).toBe('062576456');
  });

  it('prazna vrijednost ostaje prazna', () => {
    expect(normalizeOrderPhone('')).toBe('');
    expect(normalizeOrderPhone(null)).toBe('');
    expect(normalizeOrderPhones(undefined)).toBe('');
  });

  it('prepoznaje upotrebljiv broj', () => {
    expect(isUsableOrderPhone('062576456')).toBe(true);
    expect(isUsableOrderPhone('123')).toBe(false);
  });
});
