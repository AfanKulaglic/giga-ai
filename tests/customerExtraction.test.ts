import { describe, expect, it } from 'vitest';
import { extractCustomerDetails, extractCustomerDetailsFromMessages, sanitizeCustomerDetails } from '@/lib/domain/customerExtraction';

describe('customer details from chat', () => {
  it('reads a full one-line order message', () => {
    const found = extractCustomerDetails(
      'zelim naruciti, ime i prezime Marko Marković, adresa Kralja Tvrtka 12, Zenica 72101, tel 061 123 456',
    );
    expect(found.name).toBe('Marko Marković');
    expect(found.phone).toBe('061123456');
    expect(found.address).toBe('Kralja Tvrtka 12');
    expect(found.postalCode).toBe('72101');
    expect(found.city).toBe('Zenica');
  });

  it('resolves the postal code from a mentioned city', () => {
    const found = extractCustomerDetails('Ja sam Amra Hodžić, dostava u Travnik, telefon 062 111 222');
    expect(found.postalCode).toBe('72270');
    expect(found.city).toBe('Travnik');
  });

  it('prevodi broj u GigaHub format (bez 387 i crtica)', () => {
    expect(extractCustomerDetails('telefon: +387 62 987 654').phone).toBe('062987654');
    expect(extractCustomerDetails('tel 062/576-456').phone).toBe('062576456');
  });

  it('pamti dva broja odvojena zarezom', () => {
    expect(extractCustomerDetails('telefoni: 062 576 456, 066 234 888').phone).toBe('062576456, 066234888');
  });

  it('returns nothing rather than guessing', () => {
    expect(extractCustomerDetails('imate li noćne ormarice')).toEqual({});
  });

  it('merges details across several messages', () => {
    const merged = extractCustomerDetailsFromMessages(['Moje ime je Ivan Perić', 'adresa: Bosanska 5, Bihać']);
    expect(merged.name).toBe('Ivan Perić');
    expect(merged.city).toBe('Bihać');
    expect(merged.postalCode).toBe('77000');
  });
});

describe('adresa se ne smije uzeti iz naziva proizvoda', () => {
  it('„Aura komoda sa 4 ladice” nije ulica', () => {
    const found = extractCustomerDetails('Treba mi Aura komoda sa 4 ladice, telefon 062576456');
    expect(found.address).toBeUndefined();
    expect(found.phone).toBe('062576456');
  });
});

describe('čišćenje očito pogrešnih podataka', () => {
  it('uklanja „adresu” bez broja i ime sa ciframa', () => {
    const clean = sanitizeCustomerDetails({
      address: 'Aura komoda sa 4 ladice',
      name: 'Amina 2',
      phone: '123',
      city: 'Sarajevo',
    });
    expect(clean.address).toBeUndefined();
    expect(clean.name).toBeUndefined();
    expect(clean.phone).toBeUndefined();
    expect(clean.city).toBe('Sarajevo');
  });

  it('ostavlja ispravnu adresu', () => {
    const clean = sanitizeCustomerDetails({ address: 'Kralja Tvrtka 12', phone: '062576456' });
    expect(clean.address).toBe('Kralja Tvrtka 12');
    expect(clean.phone).toBe('062576456');
  });
});
