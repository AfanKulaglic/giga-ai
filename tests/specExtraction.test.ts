import { describe, expect, it } from 'vitest';
import { extractSpecifications } from '@/lib/domain/productNormalize';

describe('extractSpecifications', () => {
  it('reads two-cell tables', () => {
    const specs = extractSpecifications('<table><tr><td>Materijal</td><td>Metal, MDF</td></tr></table>');
    expect(specs).toEqual({ Materijal: 'Metal, MDF' });
  });

  it('reads two pairs from a four-cell row', () => {
    const specs = extractSpecifications(
      '<tr><td>Širina</td><td>80 cm</td><td>Visina</td><td>75 cm</td></tr>',
    );
    expect(specs).toEqual({ 'Širina': '80 cm', 'Visina': '75 cm' });
  });

  it('reads definition lists', () => {
    const specs = extractSpecifications('<dl><dt>Dimenzije</dt><dd>100 x 40 x 80 cm</dd></dl>');
    expect(specs.Dimenzije).toBe('100 x 40 x 80 cm');
  });

  it('reads bold labels with a colon inside or after the tag', () => {
    expect(extractSpecifications('<ul><li><strong>Boja:</strong> bijela</li></ul>').Boja).toBe('bijela');
    expect(extractSpecifications('<ul><li><strong>Boja</strong>: bijela</li></ul>').Boja).toBe('bijela');
  });

  it('does not turn bold prose into a specification key', () => {
    const specs = extractSpecifications('<ul><li><strong>Stolica dolazi rastavljena</strong> i lako se sastavlja</li></ul>');
    expect(specs).toEqual({});
  });

  it('ignores links and sentences from the description', () => {
    const specs = extractSpecifications(
      '<p>https://giga.ba/proizvod</p><ul><li>Detalje pogledajte na: www.giga.ba</li><li>Boja: siva</li></ul>',
    );
    expect(specs).toEqual({ Boja: 'siva' });
  });

  it('reads plain "Label: value" list items', () => {
    const specs = extractSpecifications('<ul><li>Nosivost: 120 kg</li><li>Montaža: potrebna</li></ul>');
    expect(specs['Nosivost']).toBe('120 kg');
    expect(specs.Montaža).toBe('potrebna');
  });

  it('skips prose sentences and junk keys', () => {
    const specs = extractSpecifications(
      '<p>Ovaj proizvod je izrađen od punog drveta i dolazi u bijeloj boji, a isporuka je moguća odmah.</p>' +
        '<table><tr><td>Naziv</td><td>Stol</td></tr><tr><td>Materijal</td><td>Drvo</td></tr></table>',
    );
    expect(Object.keys(specs)).toEqual(['Materijal']);
  });
});
