import type { CalculationResult } from './calculator';
import { formatMoney } from './money';
import { normalizeOrderPhones } from './phone';
import type { CustomerSession, OrderFormConfiguration, OrderFormField } from './types';

export interface OrderFormValue {
  field: OrderFormField;
  value: string;
  /** Where the value came from, so nothing looks invented. */
  provenance: 'kupac (sesija)' | 'kalkulator' | 'ručno' | 'prazno';
  missing: boolean;
  validationError: string | null;
}

export interface OrderFormValues {
  values: OrderFormValue[];
  missingRequired: string[];
}

function validate(field: OrderFormField, value: string): string | null {
  if (!value) return null;
  if (field.validation?.pattern) {
    try {
      if (!new RegExp(field.validation.pattern).test(value)) return 'Vrijednost ne odgovara obrascu.';
    } catch {
      return 'Obrazac za validaciju u Postavkama nije ispravan.';
    }
  }
  if (field.validation?.minLength !== null && field.validation?.minLength !== undefined && value.length < field.validation.minLength) {
    return `Minimalna dužina je ${field.validation.minLength}.`;
  }
  if (field.validation?.maxLength !== null && field.validation?.maxLength !== undefined && value.length > field.validation.maxLength) {
    return `Maksimalna dužina je ${field.validation.maxLength}.`;
  }
  return null;
}

/** Build the field values shown in the GigaHub preparation modal. */
export function buildOrderFormValues(
  config: OrderFormConfiguration,
  session: CustomerSession,
  calculation: CalculationResult | null,
): OrderFormValues {
  const customer = session.context.customer;
  const lines = calculation?.lines ?? [];

  const resolve = (source: OrderFormField['source']): { value: string; provenance: OrderFormValue['provenance'] } => {
    switch (source) {
      case 'customer.name':
        return { value: customer.name ?? '', provenance: customer.name ? 'kupac (sesija)' : 'prazno' };
      case 'customer.phone':
        // GigaHub prima samo lokalni format: 062576456 (bez 387 i crtica).
        // Neispravan unos se prikazuje kakav jeste, da ga validacija označi
        // umjesto da ga tiho izbriše.
        const normalized = normalizeOrderPhones(customer.phone);
        return {
          value: normalized || (customer.phone ?? ''),
          provenance: customer.phone ? 'kupac (sesija)' : 'prazno',
        };
      case 'customer.email':
        return { value: customer.email ?? '', provenance: customer.email ? 'kupac (sesija)' : 'prazno' };
      case 'customer.address':
        return { value: customer.address ?? '', provenance: customer.address ? 'kupac (sesija)' : 'prazno' };
      case 'customer.city':
        return { value: customer.city ?? '', provenance: customer.city ? 'kupac (sesija)' : 'prazno' };
      case 'customer.postalCode':
        return { value: customer.postalCode ?? '', provenance: customer.postalCode ? 'kupac (sesija)' : 'prazno' };
      case 'order.products':
        return {
          value: lines.map((l) => `${l.name} × ${l.quantity}`).join('\n'),
          provenance: lines.length ? 'kalkulator' : 'prazno',
        };
      case 'order.itemsBreakdown':
        return {
          value: lines
            .map(
              (l, i) =>
                `${i + 1}. ${l.name} — ${formatMoney(l.unitPrice, calculation?.currency)} × ${l.quantity} = ${formatMoney(
                  l.lineTotal,
                  calculation?.currency,
                )}`,
            )
            .join('\n'),
          provenance: lines.length ? 'kalkulator' : 'prazno',
        };
      case 'order.total':
        return {
          value: calculation?.total !== null && calculation?.total !== undefined
            ? formatMoney(calculation.total, calculation.currency)
            : '',
          provenance: calculation?.total !== null && calculation?.total !== undefined ? 'kalkulator' : 'prazno',
        };
      case 'order.itemsTotal': {
        // Cijena proizvoda BEZ dostave. Dostava ide u svoje polje, pa se iznos
        // nikada ne sabira u jedan „ukupno” broj.
        if (!calculation) return { value: '', provenance: 'prazno' };
        const base =
          typeof calculation.subtotalAfterDiscount === 'number'
            ? calculation.subtotalAfterDiscount
            : calculation.subtotal;
        return {
          value: formatMoney(base, calculation.currency),
          provenance: 'kalkulator',
        };
      }
      case 'order.delivery': {
        if (!calculation) return { value: '', provenance: 'prazno' };
        if (calculation.delivery.status === 'applied') {
          // Polje traži samo iznos poštarine, zato ide samo broj.
          return {
            value: formatMoney(calculation.delivery.amount, calculation.currency),
            provenance: 'kalkulator',
          };
        }
        if (calculation.delivery.status === 'missing') {
          // Praznina koju agent dopuni, uz kratko objašnjenje zašto.
          return { value: '________ KM (kilaža nije unesena)', provenance: 'kalkulator' };
        }
        return { value: 'po dogovoru (potvrditi ručno)', provenance: 'kalkulator' };
      }
      case 'order.discount':
        return {
          value:
            calculation && calculation.discountTotal > 0
              ? `-${formatMoney(calculation.discountTotal, calculation.currency)}`
              : calculation
                ? formatMoney(0, calculation.currency)
                : '',
          provenance: calculation ? 'kalkulator' : 'prazno',
        };
      case 'order.note':
        return { value: '', provenance: 'prazno' };
      case 'manual':
      default:
        return { value: '', provenance: 'ručno' };
    }
  };

  const values: OrderFormValue[] = [...config.fields]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((field) => {
      const resolved = resolve(field.source);
      const value = (resolved.value || field.defaultValue || '').trim();
      return {
        field,
        value,
        provenance: value ? resolved.provenance : 'prazno',
        missing: field.required && !value,
        validationError: validate(field, value),
      };
    });

  return {
    values,
    missingRequired: values.filter((v) => v.missing).map((v) => v.field.label),
  };
}
