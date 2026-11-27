import { describe, expect, it } from 'vitest';
import { calculateOrder } from '@/lib/domain/calculator';
import { defaultSettings } from '@/lib/config/defaults';

/**
 * Provjera tačno po pravilima koje je vlasnik tražio:
 * - dostava se računa na UKUPNU težinu svih proizvoda u narudžbi (5 kg + 20 kg = 25 kg),
 * - popust na količinu: cijena po komadu umanjena za procenat, pa puta količina
 *   (40 KM, 2 kom, 5% -> 38 x 2 = 76 KM).
 */
const config = defaultSettings().calculator;

describe('dostava po ukupnoj težini i popust na količinu', () => {
  it('5 kg + 20 kg = 25 kg -> tarifa do 30 kg = 15 KM', () => {
    const result = calculateOrder(
      {
        items: [
          { productId: 'a', name: 'LAKI PROIZVOD', unitPrice: 20, quantity: 1, weightKg: 5 },
          { productId: 'b', name: 'TEŠKI PROIZVOD', unitPrice: 30, quantity: 1, weightKg: 20 },
        ],
        config,
      }
    );
    expect(result.totalWeightKg).toBe(25);
    expect(result.delivery.amount).toBe(15);
  });

  it('isti proizvod 40 KM x 2 sa 5% = 76 KM (38 x 2)', () => {
    const result = calculateOrder(
      {
        items: [{ productId: 'p', name: 'PROIZVOD', unitPrice: 40, quantity: 2, weightKg: 3 }],
        config,
      }
    );
    expect(result.discountTotal).toBe(4);
    expect(result.subtotalAfterDiscount).toBe(76);
  });

  it('popust 5% važi samo za isti proizvod, ne za različite', () => {
    const result = calculateOrder(
      {
        items: [
          { productId: 'a', name: 'PRVI', unitPrice: 40, quantity: 1, weightKg: 3 },
          { productId: 'b', name: 'DRUGI', unitPrice: 40, quantity: 1, weightKg: 3 },
        ],
        config,
      }
    );
    expect(result.discountTotal).toBe(0);
  });

  it('težina preko 100 kg koristi najveću tarifu (60 KM)', () => {
    const result = calculateOrder(
      {
        items: [{ productId: 'p', name: 'TESKO', unitPrice: 100, quantity: 1, weightKg: 130 }],
        config,
      }
    );
    expect(result.delivery.amount).toBe(60);
  });
});
