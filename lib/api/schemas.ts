import { z } from 'zod';
import { SENDER_TYPES } from '@/lib/domain/types';

export const senderTypeSchema = z.enum(SENDER_TYPES as [string, ...string[]]);

export const createSessionSchema = z.object({
  label: z.string().trim().max(120).optional(),
});

export const updateSessionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
  context: z.any().optional(),
});

export const createMessageSchema = z.object({
  content: z.string().trim().min(1, 'Poruka ne može biti prazna.').max(8000),
  senderType: senderTypeSchema.default('customer'),
  classification: z
    .object({
      suggestedType: senderTypeSchema,
      confidence: z.number().min(0).max(1),
      rationale: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
});

export const assistantTurnSchema = z.object({
  message: z.string().trim().min(1, 'Unesite pitanje ili uputu.').max(6000),
});

export const generateReplySchema = z.object({
  tone: z.enum(['concise', 'balanced', 'detailed']).optional(),
  instruction: z.string().max(1000).optional(),
});

export const editReplySchema = z.object({
  body: z.string().trim().min(1).max(8000),
});

export const classifySchema = z.object({
  text: z.string().trim().min(1).max(8000),
  contextHint: z.string().max(500).optional(),
});

export const quickReplySchema = z.object({
  // Kratka šifra (npr. "hhh") — samo slova i brojevi, bez razmaka.
  code: z
    .string()
    .trim()
    .max(12)
    .regex(/^[a-zA-Z0-9]*$/, 'Šifra koristi samo slova i brojeve.')
    .optional(),
  label: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(4000),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  requiresReview: z.boolean().optional(),
});

export const quickReplyPatchSchema = quickReplySchema.partial();

export const procedureSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  topic: z.enum(['showroom', 'delivery', 'payment', 'warranty', 'returns', 'complaints', 'company_info', 'other']),
  title: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().max(60)).max(30).default([]),
  answer: z.string().trim().max(5000).default(''),
  verified: z.boolean().default(false),
});

export const additionalFieldSchema = z.object({
  fieldName: z.string().trim().min(1).max(80),
  // Empty values are allowed so the agent can clear a field without an error.
  value: z.string().trim().max(500).default(''),
  unit: z.string().trim().max(20).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export const additionalFieldsSchema = z.object({
  fields: z.array(additionalFieldSchema).max(100).default([]),
  /** Shipping weight in kilograms, entered by the agent. */
  weightKg: z.number().min(0).max(2000).nullable().default(null),
  dimensionsCm: z
    .object({
      lengthCm: z.number().min(0).max(1000).nullable().default(null),
      widthCm: z.number().min(0).max(1000).nullable().default(null),
      heightCm: z.number().min(0).max(1000).nullable().default(null),
    })
    .nullable()
    .default(null),
});

/** Samo polja koja se mijenjaju; ostalo ostaje kako je bilo. */
export const patchAdditionalSchema = z.object({
  weightKg: z.number().min(0).max(2000).nullable().optional(),
  dimensionsCm: z
    .object({
      lengthCm: z.number().min(0).max(1000).nullable().default(null),
      widthCm: z.number().min(0).max(1000).nullable().default(null),
      heightCm: z.number().min(0).max(1000).nullable().default(null),
    })
    .nullable()
    .optional(),
});

const discountRuleSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['quantity', 'product', 'bundle', 'cart_total']),
  enabled: z.boolean(),
  productIds: z.array(z.string()).max(200).default([]),
  minQuantity: z.number().int().min(1).nullable().default(null),
  minSubtotal: z.number().min(0).nullable().default(null),
  percent: z.number().min(0).max(100).nullable().default(null),
  amount: z.number().min(0).nullable().default(null),
  note: z.string().max(400).nullable().default(null),
  priority: z.number().int().min(0).max(1000).default(100),
  stackable: z.boolean().default(false),
});

const deliveryRuleSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['flat', 'free_above', 'per_item', 'by_weight', 'on_request']),
  enabled: z.boolean(),
  amount: z.number().min(0).nullable().default(null),
  freeAbove: z.number().min(0).nullable().default(null),
  note: z.string().max(400).nullable().default(null),
});

const weightTierSchema = z.object({
  id: z.string().min(1).max(60),
  upToKg: z.number().min(0).max(2000),
  amount: z.number().min(0),
  enabled: z.boolean(),
  note: z.string().max(300).nullable().default(null),
});

const orderFieldSchema = z.object({
  id: z.string().min(1).max(80),
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'multiline', 'number', 'select', 'tel', 'email']),
  required: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000),
  source: z.enum([
    'customer.name',
    'customer.phone',
    'customer.email',
    'customer.address',
    'customer.city',
    'customer.postalCode',
    'order.products',
    'order.itemsBreakdown',
    'order.total',
    'order.itemsTotal',
    'order.delivery',
    'order.discount',
    'order.note',
    'manual',
  ]),
  defaultValue: z.string().max(500).nullable().default(null),
  placeholder: z.string().max(200).nullable().default(null),
  validation: z
    .object({
      pattern: z.string().max(200).nullable().optional(),
      minLength: z.number().int().min(0).nullable().optional(),
      maxLength: z.number().int().min(0).nullable().optional(),
    })
    .nullable()
    .default(null),
  provisional: z.boolean().default(true),
});

export const settingsSchema = z.object({
  signature: z.object({
    signOff: z.string().max(120),
    agentName: z.string().max(120),
    companyName: z.string().max(120),
    website: z.string().max(200),
    template: z.string().max(500),
    updatedAt: z.string(),
  }),
  ai: z.object({
    additionalInstructions: z.string().max(5000),
    responseStyle: z.enum(['concise', 'balanced', 'detailed']),
    protectedRulesVersion: z.number(),
    updatedAt: z.string(),
  }),
  calculator: z.object({
    currency: z.string().min(1).max(8),
    pricesIncludeTax: z.boolean().nullable(),
    deliveryPolicy: z.enum(['rules', 'on_request']),
    deliveryRules: z.array(deliveryRuleSchema).max(50),
    weightTiers: z.array(weightTierSchema).max(30).default([]),
    fallbackWeightKg: z.number().positive().max(500).nullable().optional(),
    discountRules: z.array(discountRuleSchema).max(100),
    updatedAt: z.string(),
  }),
  orderForm: z.object({
    fields: z.array(orderFieldSchema).max(100),
    updatedAt: z.string(),
  }),
  updatedAt: z.string(),
});

/**
 * Values coming back from the browser or from AI tool output are sometimes
 * strings ("650", "2", "12,5"). Coercing them keeps a valid order from being
 * rejected as "Neispravni podaci" while still rejecting real garbage.
 */
const nullableNumber = (opts: { int?: boolean; min?: number; max?: number } = {}) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim());
      return Number.isFinite(parsed) ? parsed : null;
    },
    (opts.int ? z.number().int() : z.number())
      .min(opts.min ?? -Infinity)
      .max(opts.max ?? Infinity)
      .nullable(),
  );

export const calculateSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        name: z.string().max(300).optional(),
        sku: z.string().max(120).nullable().optional(),
        unitPrice: nullableNumber({ min: 0 }),
        quantity: nullableNumber({ int: true, min: 1 }),
        currentCatalogPrice: nullableNumber({ min: 0 }).optional(),
        priceCheckedAt: z.string().nullable().optional(),
        weightKg: nullableNumber({ min: 0, max: 2000 }).optional(),
      }),
    )
    .max(50),
  deliveryRuleId: z.string().nullable().optional(),
  manualDiscountPercent: nullableNumber({ min: 0, max: 100 }).optional(),
});

export const orderFormPrepareSchema = z.object({
  sessionId: z.string().min(1),
  items: calculateSchema.shape.items,
  deliveryRuleId: z.string().nullable().optional(),
  manualDiscountPercent: nullableNumber({ min: 0, max: 100 }).optional(),
});

export const scraperRunSchema = z.object({
  mode: z.enum(['test', 'sync', 'full']).default('test'),
  limit: z.number().int().min(1).max(250).optional(),
  maxPages: z.number().int().min(1).max(60).optional(),
});
