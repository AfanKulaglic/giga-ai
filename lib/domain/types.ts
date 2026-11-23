// ---------------------------------------------------------------------------
// Shared domain types. These are the single source of truth for both the
// Next.js server and the standalone scraper worker.
// ---------------------------------------------------------------------------

export type SenderType = 'customer' | 'agent' | 'note' | 'instruction';

export const SENDER_TYPES: SenderType[] = ['customer', 'agent', 'note', 'instruction'];

export const SENDER_LABELS: Record<SenderType, string> = {
  customer: 'Kupac',
  agent: 'Mi (prodaja)',
  note: 'Interna bilješka',
  instruction: 'Uputa AI-u',
};

export interface MessageClassification {
  suggestedType: SenderType;
  confidence: number;
  rationale?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId: string;
  senderType: SenderType;
  content: string;
  createdAt: string;
  /** Only set when the agent accepted an AI classification suggestion. */
  classification?: MessageClassification | null;
}

export type OrderIntent = 'unknown' | 'browsing' | 'interested' | 'confirmed' | 'declined';

export interface OrderIntentState {
  value: OrderIntent;
  /** 0..1 confidence of the classification */
  confidence: number;
  rationale?: string;
  updatedAt: string;
}

export interface ContextProduct {
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number | null;
  currency: string;
  quantity: number | null;
  /** When the price was last confirmed against the catalog. */
  priceCheckedAt: string | null;
  priceSource: 'scraped' | 'manual' | 'unknown';
  note?: string;
}

export interface OutstandingQuestion {
  id: string;
  question: string;
  createdAt: string;
  resolved: boolean;
}

export interface CustomerDetails {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  note?: string;
}

/**
 * Structured per-session context. Kept alongside raw messages so we never have
 * to send an unbounded transcript to the model.
 */
export interface SessionContext {
  summary: string;
  /** Messages already folded into `summary`. */
  summarizedUpToMessageId: string | null;
  messageCountAtLastSummary: number;
  lastSummarizedAt: string | null;
  products: ContextProduct[];
  customer: CustomerDetails;
  orderIntent: OrderIntentState;
  confirmedFacts: string[];
  missingInfo: string[];
  outstandingQuestions: OutstandingQuestion[];
  /** Facts the agent explicitly corrected. These outrank model inference. */
  agentCorrections: string[];
}

export type SessionStatus = 'active' | 'archived';

export interface CustomerSession {
  id: string;
  userId: string;
  label: string;
  status: SessionStatus;
  context: SessionContext;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  archivedAt?: string | null;
}

// ------------------------------- Products ---------------------------------

export type AvailabilityStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'partial'
  | 'unknown'
  | 'not_verified';

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  available: boolean | null;
  options: Record<string, string | null>;
}

export interface ProductAvailability {
  status: AvailabilityStatus;
  /** Verbatim availability information as displayed at the source. */
  raw: string | null;
  checkedAt: string | null;
  /** `live:product.js` = stanje provjereno na giga.ba u momentu odgovora. */
  source: 'products.json' | 'product_page' | 'live:product.js' | 'manual' | 'none';
}

export type ExtractionStatus = 'complete' | 'incomplete' | 'failed';

export interface Product {
  /** Stable id: Shopify product id, prefixed `giga_`. */
  id: string;
  sourceId: string;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  tags: string[];
  url: string;
  images: string[];
  price: number | null;
  compareAtPrice: number | null;
  discountPercent: number | null;
  currency: string;
  descriptionHtml: string | null;
  shortDescription: string | null;
  specifications: Record<string, string>;
  options: { name: string; values: string[] }[];
  variants: ProductVariant[];
  availability: ProductAvailability;
  source: 'giga.ba';
  sourceUpdatedAt: string | null;
  scrapedAt: string | null;
  lastValidScrapeAt: string | null;
  contentHash: string | null;
  extractionStatus: ExtractionStatus;
  missingFields: string[];
  lastError: string | null;
}

export interface AdditionalProductField {
  fieldName: string;
  value: string;
  unit: string | null;
  addedAt: string;
  note: string | null;
  addedBy: string;
}

/** Dimensions are entered by the agent; the shop page has no size data. */
export interface ProductDimensions {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface ProductAdditionalData {
  productId: string;
  fields: AdditionalProductField[];
  /**
   * Shipping weight in kilograms. Entered by the agent because the site has no
   * weight data; delivery is priced from it, so null means "not known yet".
   */
  weightKg: number | null;
  dimensionsCm: ProductDimensions | null;
  updatedAt: string;
  updatedBy: string;
}

// ----------------------------- Quick replies ------------------------------

export interface QuickReply {
  id: string;
  userId: string;
  /**
   * Kratka šifra koju agent prepoznaje na prvi pogled (npr. "hhh").
   * Prazno = odgovor nema šifru.
   */
  code?: string;
  label: string;
  category: string;
  message: string;
  sortOrder: number;
  /** true when the shipped placeholder text has not been reviewed yet. */
  requiresReview: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------- Company rules -------------------------------

export type ProcedureTopic =
  | 'showroom'
  | 'delivery'
  | 'payment'
  | 'warranty'
  | 'returns'
  | 'complaints'
  | 'company_info'
  | 'other';

export interface CompanyProcedure {
  id: string;
  userId: string;
  topic: ProcedureTopic;
  title: string;
  /** Keywords used to route a question to this procedure. */
  keywords: string[];
  answer: string;
  /** false => answer empty/needs verification. AI must say it cannot confirm. */
  verified: boolean;
  updatedAt: string;
}

// --------------------------- Business rules -------------------------------

export type DiscountRuleType = 'quantity' | 'product' | 'bundle' | 'cart_total';

export interface DiscountRule {
  id: string;
  name: string;
  type: DiscountRuleType;
  enabled: boolean;
  /** product / bundle scope */
  productIds: string[];
  /** quantity threshold (per line for 'quantity', total units for 'bundle') */
  minQuantity: number | null;
  /** subtotal threshold for cart_total */
  minSubtotal: number | null;
  percent: number | null;
  /** fixed amount off in currency units */
  amount: number | null;
  /** Optional explanation shown to the agent / customer */
  note: string | null;
  /** Lower applies first when several rules could stack. */
  priority: number;
  stackable: boolean;
}

export type DeliveryRuleType = 'flat' | 'free_above' | 'per_item' | 'by_weight' | 'on_request';

/**
 * Delivery price band: "up to 10 kg → 10 KM". Tiers are checked from the
 * lightest upwards and the first one that fits wins.
 */
export interface WeightTier {
  id: string;
  upToKg: number;
  amount: number;
  enabled: boolean;
  note: string | null;
}

export interface DeliveryRule {
  id: string;
  name: string;
  type: DeliveryRuleType;
  enabled: boolean;
  amount: number | null;
  /** For free_above: order subtotal from which delivery is free. */
  freeAbove: number | null;
  note: string | null;
}

export interface CalculatorConfig {
  currency: string;
  pricesIncludeTax: boolean | null;
  deliveryRules: DeliveryRule[];
  /** Weight bands used by `by_weight` delivery rules. */
  weightTiers: WeightTier[];
  discountRules: DiscountRule[];
  /** Set when the agent wants delivery calculated manually. */
  deliveryPolicy: 'rules' | 'on_request';
  updatedAt: string;
}

// ------------------------- Order form configuration -----------------------

export type OrderFieldType = 'text' | 'multiline' | 'number' | 'select' | 'tel' | 'email';

export type OrderFieldSource =
  | 'customer.name'
  | 'customer.phone'
  | 'customer.email'
  | 'customer.address'
  | 'customer.city'
  | 'customer.postalCode'
  | 'order.products'
  | 'order.itemsBreakdown'
  | 'order.total'
  /** Cijena samo proizvoda (bez dostave) — GigaHub traži odvojeno polje. */
  | 'order.itemsTotal'
  | 'order.delivery'
  | 'order.discount'
  | 'order.note'
  | 'manual';

export interface OrderFormField {
  id: string;
  key: string;
  label: string;
  type: OrderFieldType;
  required: boolean;
  sortOrder: number;
  source: OrderFieldSource;
  defaultValue: string | null;
  placeholder: string | null;
  validation: { pattern?: string | null; minLength?: number | null; maxLength?: number | null } | null;
  /** Shipped default not yet aligned with the real GigaHub form. */
  provisional: boolean;
}

export interface OrderFormConfiguration {
  fields: OrderFormField[];
  updatedAt: string;
}

// ------------------------------ AI config ---------------------------------

export interface AIConfiguration {
  /** Free-form supplementary instructions from the agent. */
  additionalInstructions: string;
  responseStyle: 'concise' | 'balanced' | 'detailed';
  /** Hard limits the agent cannot silently replace. */
  protectedRulesVersion: number;
  updatedAt: string;
}

// ---------------------------- Scraper runs --------------------------------

export interface ScraperRun {
  id: string;
  mode: 'test' | 'full' | 'sync';
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  pagesFetched: number;
  productsSeen: number;
  productsCreated: number;
  productsUpdated: number;
  productsUnchanged: number;
  productsFailed: number;
  errors: { message: string; at: string; context?: string }[];
  triggeredBy: 'manual' | 'schedule' | 'cli';
  durationMs: number | null;
}

export interface ScraperState {
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  currentStatus: 'idle' | 'running' | 'error';
  intervalMinutes: number;
  totalProducts: number;
  lastRun: ScraperRun | null;
}

// ------------------------------ Settings ----------------------------------

export interface CompanySignature {
  signOff: string;
  agentName: string;
  companyName: string;
  website: string;
  /** Template using {signOff} {agentName} {companyName} {website} */
  template: string;
  updatedAt: string;
}

export interface AppSettings {
  signature: CompanySignature;
  ai: AIConfiguration;
  calculator: CalculatorConfig;
  orderForm: OrderFormConfiguration;
  updatedAt: string;
}

// --------------------------- AI chat / replies ----------------------------

export type ChatRole = 'user' | 'assistant';

export interface AssistantTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  citations: AiCitation[];
  toolCalls: AiToolTrace[];
  replyDraft?: string | null;
  error?: string | null;
}

export interface AiCitation {
  kind: 'product' | 'procedure' | 'settings' | 'session' | 'additional_data';
  label: string;
  detail?: string;
  url?: string;
  updatedAt?: string;
}

export interface AiToolTrace {
  name: string;
  args: unknown;
  ok: boolean;
  summary: string;
  citations?: AiCitation[];
}

export interface GeneratedReply {
  id: string;
  sessionId: string;
  userId: string;
  body: string;
  /** Full text including signature, ready to copy. */
  fullText: string;
  signatureApplied: boolean;
  tone: 'concise' | 'balanced' | 'detailed';
  createdAt: string;
  editedByAgent: boolean;
  citations: AiCitation[];
  model: string | null;
}
