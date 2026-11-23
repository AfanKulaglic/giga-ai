/**
 * Jednokratna izmjena GigaHub obrasca u bazi: cijena proizvoda i dostava su
 * odvojena polja, a „ukupan iznos” se uklanja (GigaHub traži iznos robe bez
 * poštarine, poštarinu posebno).
 *
 *   npx tsx scripts/migrate-order-form.ts
 */
import { config } from 'dotenv';
import { initializeApp, cert, getApps, type ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

config({ path: '.env.local', quiet: true });

const USER_ID = 'local-user';

interface Field {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  sortOrder: number;
  source: string;
  defaultValue: string | null;
  placeholder: string | null;
  validation: unknown;
  provisional?: boolean;
  [extra: string]: unknown;
}

async function main() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH nije postavljen.');
  const serviceAccount = JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount;
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount), databaseURL: process.env.FIREBASE_DB_URL });
  }
  const db = getDatabase();

  const snapshot = await db.ref(`giga_settings/${USER_ID}/orderForm`).get();
  if (!snapshot.exists()) throw new Error('Obrazac nije pronađen u bazi.');
  const orderForm = snapshot.val() as { fields: Field[] };
  const fields = [...orderForm.fields].sort((a, b) => a.sortOrder - b.sortOrder);

  const pick = (source: string) => fields.find((f) => f.source === source);
  const products = pick('order.itemsBreakdown') ?? pick('order.products');
  const priceField = pick('order.itemsTotal') ?? pick('order.total');
  const delivery = pick('order.delivery');

  const ordered: Field[] = [
    pick('customer.name'),
    pick('customer.phone'),
    pick('customer.address'),
    pick('customer.city'),
    pick('customer.postalCode'),
    products,
    priceField,
    delivery,
    pick('order.note'),
  ].filter((f): f is Field => Boolean(f));

  const next = ordered.map((field, index) => {
    const base: Field = { ...field, sortOrder: (index + 1) * 10, provisional: false };
    if (field === priceField) {
      return {
        ...base,
        id: 'f_items',
        key: 'items_total',
        label: 'Cijena proizvoda (bez dostave)',
        source: 'order.itemsTotal',
        type: 'text',
        required: true,
      };
    }
    if (field === delivery) {
      return { ...base, id: 'f_delivery', key: 'delivery', label: 'Dostava', source: 'order.delivery', type: 'text', required: true };
    }
    if (field === products) {
      return { ...base, label: 'Proizvodi (naziv × količina)', source: 'order.itemsBreakdown', type: 'multiline' };
    }
    return base;
  });

  await db.ref(`giga_settings/${USER_ID}/orderForm`).set({ fields: next, updatedAt: new Date().toISOString() });

  for (const field of next) {
    console.log(`${String(field.sortOrder).padStart(3)}  ${field.label}  (${field.source})`);
  }
  console.log(`\nSpremljeno: ${next.length} polja.`);
}

void main();
