import { describe, expect, it } from 'vitest';
import {
  drawerCountOf,
  parseQuantity,
  parseRequestedSpec,
  productMatchesSpec,
  syncContextWithCustomerMessage,
} from '@/lib/domain/contextSync';
import { emptySessionContext, upsertContextProduct } from '@/lib/domain/sessionContext';
import type { ContextProduct, Product } from '@/lib/domain/types';

const contextProduct = (name: string, id = name): ContextProduct => ({
  productId: id,
  name,
  sku: null,
  unitPrice: 100,
  currency: 'BAM',
  quantity: null,
  priceCheckedAt: null,
  priceSource: 'scraped',
});

const product = (name: string, price = 100): Product =>
  ({
    id: `giga_${name}`,
    name,
    sku: null,
    price,
    currency: 'BAM',
  }) as unknown as Product;

const withProducts = (names: string[]) =>
  names.reduce((ctx, name) => upsertContextProduct(ctx, contextProduct(name)), emptySessionContext());

describe('kartica prati razgovor', () => {
  it('prepoznaje dimenziju, ladice i boju iz poruke', () => {
    const spec = parseRequestedSpec('Treba mi ona 102 x 40, bijela, sa 4 ladice');
    expect(spec.sizes).toContain('102x40');
    expect(spec.drawerCounts).toContain('4');
    expect(spec.colors).toContain('bijela');
  });

  it('ne pravi dimenziju od cijene ili telefona', () => {
    const spec = parseRequestedSpec('Cijena 250 KM je ok, telefon 062576456', ['PULSAR 102 X 40 BEŽ']);
    expect(spec.sizes).toHaveLength(0);
  });

  it('goli broj prihvata samo ako postoji u nazivu proizvoda', () => {
    const spec = parseRequestedSpec('Dajte mi onu od 127', ['PULSAR 127 X 40 BEŽ']);
    expect(spec.sizes).toContain('127');
  });

  it('sužava listu na traženu dimenziju — ostale se brišu odmah', () => {
    const ctx = withProducts(['AURA KOMODA LADIČAR 3 LADICE', 'AURA KOMODA LADIČAR 4 LADICE']);
    const result = syncContextWithCustomerMessage(ctx, {
      text: 'Želim ovu sa 4 ladice',
      matches: [],
    });
    expect(result.context.products.map((p) => p.name)).toEqual(['AURA KOMODA LADIČAR 4 LADICE']);
    expect(result.changed.droppedProductIds).toEqual(['AURA KOMODA LADIČAR 3 LADICE']);
  });

  it('sužava po dimenziji kod modela sa više dimenzija', () => {
    const ctx = withProducts([
      'PULSAR ORMARICI KOMODA POLICE 77 X 40 BEŽ',
      'PULSAR ORMARICI KOMODA POLICE 102 X 40 BEŽ',
      'PULSAR ORMARICI KOMODA POLICE 127 X 40 BEŽ',
    ]);
    const result = syncContextWithCustomerMessage(ctx, {
      text: 'Uzela bih 102 x 40',
      matches: [],
    });
    expect(result.context.products).toHaveLength(1);
    expect(result.context.products[0]?.name).toContain('102 X 40');
  });

  it('upisuje količinu kad je ostao jedan proizvod', () => {
    const ctx = withProducts(['AURA KOMODA LADIČAR 4 LADICE']);
    const result = syncContextWithCustomerMessage(ctx, { text: 'Uzeću 3 komada', matches: [] });
    expect(result.context.products[0]?.quantity).toBe(3);
  });

  it('ne briše cijelu listu ako ništa ne odgovara', () => {
    const ctx = withProducts(['AURA KOMODA LADIČAR 3 LADICE']);
    const result = syncContextWithCustomerMessage(ctx, { text: 'Ima li dostava za Sarajevo?', matches: [] });
    expect(result.context.products).toHaveLength(1);
  });

  it('kartica kupca se puni čim podaci dođu, polje po polje', () => {
    let ctx = emptySessionContext();
    const first = syncContextWithCustomerMessage(ctx, {
      text: 'Ja sam Amina Hadžić, adresa Zmaja od Bosne 12, Zenica 72101',
      matches: [],
    });
    ctx = first.context;
    expect(ctx.customer.name).toContain('Amina');
    expect(ctx.customer.city).toBe('Zenica');
    expect(ctx.customer.phone).toBeUndefined();

    const second = syncContextWithCustomerMessage(ctx, { text: 'Telefon je 062576456', matches: [] });
    expect(second.context.customer.phone).toBe('062576456');
    expect(second.context.customer.name).toContain('Amina');
    expect(second.changed.customerFields).toEqual(['phone']);
  });
});

describe('pomoćne funkcije', () => {
  it('broji ladice iz naziva', () => {
    expect(drawerCountOf('AURA KOMODA LADIČAR 5 LADICA')).toBe('5');
    expect(drawerCountOf('PULSAR ORMARICI KOMODA')).toBeNull();
  });

  it('čita količinu iz riječi i brojeva', () => {
    expect(parseQuantity('2 komada')).toBe(2);
    expect(parseQuantity('uzimam tri kom')).toBe(3);
    expect(parseQuantity('koja je cijena?')).toBeNull();
  });

  it('boja ne mora postojati kod proizvoda bez boje u nazivu', () => {
    const spec = parseRequestedSpec('bijela');
    expect(productMatchesSpec({ name: 'AURA KOMODA LADIČAR 3 LADICE' }, spec)).toBe(false);
    expect(productMatchesSpec({ name: 'AURA KOMODA LADIČAR 3 LADICE BIJELA' }, spec)).toBe(true);
  });
});

describe('kartice poslije sužavanja ne vraćaju odbačeno', () => {
  it('„Uzeću 2 komada” ne dodaje ponovo druge dimenzije', () => {
    let ctx = withProducts([
      'AURA KOMODA LADIČAR 3 LADICE',
      'AURA KOMODA LADIČAR 4 LADICE',
      'AURA KOMODA LADIČAR 5 LADICA',
    ]);
    const narrowed = syncContextWithCustomerMessage(ctx, { text: 'Treba mi ona sa 4 ladice', matches: [] });
    ctx = narrowed.context;
    expect(ctx.products).toHaveLength(1);

    const quantity = syncContextWithCustomerMessage(ctx, {
      text: 'Uzeću 2 komada',
      matches: [product('AURA KOMODA LADIČAR 3 LADICE'), product('AURA KOMODA LADIČAR 5 LADICA')],
    });
    expect(quantity.context.products).toHaveLength(1);
    expect(quantity.context.products[0]?.quantity).toBe(2);
  });

  it('obična rečenica ne postaje adresa', () => {
    const result = syncContextWithCustomerMessage(emptySessionContext(), {
      text: 'Treba mi ona sa 4 ladice',
      matches: [],
    });
    expect(result.context.customer.address).toBeUndefined();
  });

  it('stvarna adresa se i dalje prepoznaje', () => {
    const result = syncContextWithCustomerMessage(emptySessionContext(), {
      text: 'Adresa: Zmaja od Bosne 12, Zenica 72101, telefon 062576456',
      matches: [],
    });
    expect(result.context.customer.address).toContain('Zmaja od Bosne');
    expect(result.context.customer.phone).toBe('062576456');
    expect(result.context.customer.city).toBe('Zenica');
  });

  it('ime se prepoznaje i bez dvotočke', () => {
    const result = syncContextWithCustomerMessage(emptySessionContext(), {
      text: 'Ime Amina Hadžić, telefon 062576456',
      matches: [],
    });
    expect(result.context.customer.name).toBe('Amina Hadžić');
  });
});

describe('kartica pokaže cijelu kategoriju kad kupac pita za ponudu', () => {
  it('sa maxAdd 15 ulazi svih 12 penjalica, sa 3 samo tri', () => {
    const names = ['BIFROST', 'BYGUL', 'EYA', 'HILI', 'HIMIN', 'HUGIN', 'IVAR', 'LOKI', 'VIGRI', 'VINDUR'].map(
      (brand) => `${brand} PENJALICA GREBALICA ZA MAČKE 50X50CM`,
    );
    const matches = names.map((name) => product(name));
    const few = syncContextWithCustomerMessage(emptySessionContext(), {
      text: 'Imate li penjalice za mačke',
      matches,
    });
    expect(few.context.products).toHaveLength(3);

    const all = syncContextWithCustomerMessage(emptySessionContext(), {
      text: 'Imate li penjalice za mačke',
      matches,
      maxAdd: 15,
    });
    expect(all.context.products).toHaveLength(10);
  });
});
