import { randomUUID } from 'node:crypto';
import type {
  AppSettings,
  AssistantTurn,
  ChatMessage,
  CompanyProcedure,
  CustomerSession,
  GeneratedReply,
  Product,
  ProductAdditionalData,
  QuickReply,
  ScraperRun,
  ScraperState,
} from '@/lib/domain/types';
import { emptySessionContext, normalizeSessionContext } from '@/lib/domain/sessionContext';
import { searchProductCatalog } from '@/lib/domain/productSearch';
import { defaultProcedures, defaultQuickReplies, defaultSettings } from '@/lib/config/defaults';
import { serverEnv } from '@/lib/config/env';
import type {
  AuditLogEntry,
  CreateSessionInput,
  Store,
  UpdateSessionInput,
  UpsertProductsResult,
} from './types';

/**
 * Firebase Realtime Database backend.
 *
 * Layout (kept flat-ish so one agent's data is easy to inspect in the console):
 *   giga_users/{userId}
 *   giga_sessions/{userId}/{sessionId}
 *   giga_messages/{userId}/{sessionId}/{messageId}
 *   giga_turns/{userId}/{sessionId}/{turnId}
 *   giga_replies/{userId}/{sessionId}/{replyId}
 *   giga_quickReplies/{userId}/{quickReplyId}
 *   giga_procedures/{userId}/{procedureId}
 *   giga_settings/{userId}
 *   giga_products/{productId}
 *   giga_additional/{productId}
 *   giga_runs/{runId}
 *   giga_audit/{userId}/{auditId}
 *   giga_meta/scraperState
 */

type AdminModules = {
  db: import('firebase-admin/database').Database;
};

let adminPromise: Promise<AdminModules> | null = null;

async function getDatabase(): Promise<AdminModules> {
  if (!adminPromise) {
    adminPromise = (async () => {
      const { getApps, initializeApp, cert } = await import('firebase-admin/app');
      const { getDatabase } = await import('firebase-admin/database');
      const { projectId, clientEmail, privateKey } = serverEnv.firebaseAdmin;
      if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Firebase Admin kredencijali nisu konfigurirani.');
      }
      const databaseURL = serverEnv.firebaseDbUrl;
      if (!databaseURL) throw new Error('FIREBASE_DB_URL nije postavljen.');

      const app =
        getApps().find((a) => a.name === 'giga-assistant') ??
        initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), databaseURL }, 'giga-assistant');
      return { db: getDatabase(app) };
    })();
  }
  return adminPromise;
}

const P = {
  users: 'giga_users',
  sessions: 'giga_sessions',
  messages: 'giga_messages',
  turns: 'giga_turns',
  replies: 'giga_replies',
  quickReplies: 'giga_quickReplies',
  procedures: 'giga_procedures',
  settings: 'giga_settings',
  products: 'giga_products',
  additional: 'giga_additional',
  runs: 'giga_runs',
  audit: 'giga_audit',
  meta: 'giga_meta',
} as const;

/**
 * Realtime Database rejects `undefined` and silently deletes empty arrays
 * (and empty objects). Arrays therefore get a sentinel when empty so the
 * original shape comes back on read.
 */
const EMPTY_ARRAY = '__emptyArray';

function encode(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (!value.length) return { [EMPTY_ARRAY]: true };
    return value.map(encode);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) out[key] = encode(child);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 1 && keys[0] === EMPTY_ARRAY) return [];
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) out[key] = decode(child);
    return out;
  }
  return value;
}

/**
 * Realtime Database rejects keys that contain `. # $ / [ ]` — and scraped
 * specification names are full of slashes ("Napon / frekvencija"). Without this
 * the whole product write fails, so keys are made valid at the store boundary.
 */
const INVALID_KEY_CHARS = /[.#$/\[\]\u0000-\u001f]/g;

export function sanitizeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeKeys(item)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const safe = key.replace(INVALID_KEY_CHARS, '-').trim() || 'polje';
      out[safe] = sanitizeKeys(item);
    }
    return out as T;
  }
  return value;
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(sanitizeKeys(value))) as T;
}

function sortNewestFirst<T>(rows: T[], key: keyof T): T[] {
  return [...rows].sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')));
}

/**
 * Realtime Database silently drops empty arrays (they become `null`), so a
 * document written with `tags: []` reads back without the key. These helpers
 * restore the shapes the rest of the app relies on.
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function reviveProduct(raw: Product): Product {
  return {
    ...raw,
    tags: asArray<string>(raw.tags),
    images: asArray<string>(raw.images),
    variants: asArray<Product['variants'][number]>(raw.variants),
    options: asArray<Product['options'][number]>(raw.options),
    specifications: raw.specifications ?? {},
    missingFields: asArray<string>(raw.missingFields),
  };
}

function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (stored === null || stored === undefined) return defaults;
  if (Array.isArray(defaults)) return (Array.isArray(stored) ? stored : defaults) as T;
  if (typeof defaults === 'object' && defaults !== null) {
    const base = defaults as Record<string, unknown>;
    const out: Record<string, unknown> = { ...base };
    if (typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
        out[key] = key in base ? mergeDefaults(base[key], value) : value;
      }
    }
    return out as T;
  }
  return (stored as T) ?? defaults;
}

// The full catalogue is ~2500 products / ~11 MB, so one RTDB read costs several
// seconds. Serve it stale while refreshing in the background so no request pays
// that cost more than once.
const CATALOG_TTL_MS = 10 * 60_000;

export class RtdbStore implements Store {
  readonly mode = 'rtdb' as const;

  private catalogCache: { at: number; products: Product[] } | null = null;
  private catalogLoading: Promise<Product[]> | null = null;

  private async ctx() {
    return getDatabase();
  }

  private async ref(path: string) {
    const { db } = await this.ctx();
    return db.ref(path);
  }

  private async readValue<T>(path: string): Promise<T | null> {
    const ref = await this.ref(path);
    const snap = await ref.get();
    const raw = snap.val();
    return raw === null || raw === undefined ? null : (decode(raw) as T);
  }

  private async writeValue(path: string, value: unknown): Promise<void> {
    const ref = await this.ref(path);
    await ref.set(encode(clean(value)));
  }

  /** Full catalogue, cached; RTDB has no server-side text search. */
  private async catalog(): Promise<Product[]> {
    const fresh = this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS;
    if (fresh) return this.catalogCache!.products;
    if (this.catalogCache) {
      // Stale but usable: answer now, refresh in the background.
      void this.refreshCatalog();
      return this.catalogCache.products;
    }
    return this.refreshCatalog();
  }

  private refreshCatalog(): Promise<Product[]> {
    if (this.catalogLoading) return this.catalogLoading;
    this.catalogLoading = (async () => {
      try {
        const raw = await this.readValue<Record<string, Product>>(P.products);
        const products = raw ? Object.values(raw).map(reviveProduct) : [];
        this.catalogCache = { at: Date.now(), products };
        return products;
      } finally {
        this.catalogLoading = null;
      }
    })();
    return this.catalogLoading;
  }

  private invalidateCatalog() {
    this.catalogCache = null;
  }

  async ensureUser(userId: string, email?: string): Promise<void> {
    const ref = await this.ref(`${P.users}/${userId}`);
    const snap = await ref.get();
    if (!snap.exists()) {
      await ref.set(clean({ email: email ?? null, createdAt: new Date().toISOString() }));
    }
    await this.seedUserConfig(userId);
  }

  private async seedUserConfig(userId: string): Promise<void> {
    const settings = await this.readValue<AppSettings>(`${P.settings}/${userId}`);
    if (!settings) await this.writeValue(`${P.settings}/${userId}`, defaultSettings());

    const quick = await this.readValue<Record<string, QuickReply>>(`${P.quickReplies}/${userId}`);
    if (!quick || !Object.keys(quick).length) {
      const seed: Record<string, QuickReply> = {};
      for (const qr of defaultQuickReplies(userId)) seed[qr.id] = qr;
      await this.writeValue(`${P.quickReplies}/${userId}`, seed);
    }

    const procedures = await this.readValue<Record<string, CompanyProcedure>>(`${P.procedures}/${userId}`);
    if (!procedures || !Object.keys(procedures).length) {
      const seed: Record<string, CompanyProcedure> = {};
      for (const p of defaultProcedures(userId)) seed[p.id] = p;
      await this.writeValue(`${P.procedures}/${userId}`, seed);
    }
  }

  // ---- Sessions ----------------------------------------------------------

  async listSessions(userId: string): Promise<CustomerSession[]> {
    const raw = await this.readValue<Record<string, CustomerSession>>(`${P.sessions}/${userId}`);
    if (!raw) return [];
    return Object.values(raw)
      .map((session) => ({ ...session, context: mergeDefaults(emptySessionContext(), session.context) }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async getSession(userId: string, id: string): Promise<CustomerSession | null> {
    const session = await this.readValue<CustomerSession>(`${P.sessions}/${userId}/${id}`);
    return session
      ? {
          ...session,
          context: normalizeSessionContext(mergeDefaults(emptySessionContext(), session.context)),
        }
      : null;
  }

  async createSession(userId: string, input?: CreateSessionInput): Promise<CustomerSession> {
    const now = new Date().toISOString();
    const session: CustomerSession = {
      id: randomUUID(),
      userId,
      label: input?.label?.trim() || `Razgovor ${new Date().toLocaleDateString('bs-BA')}`,
      status: 'active',
      context: emptySessionContext(),
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      messageCount: 0,
      archivedAt: null,
    };
    await this.writeValue(`${P.sessions}/${userId}/${session.id}`, session);
    return session;
  }

  async updateSession(userId: string, id: string, patch: UpdateSessionInput): Promise<CustomerSession> {
    const existing = await this.getSession(userId, id);
    if (!existing) throw new Error('Sesija nije pronađena.');
    const next: CustomerSession = {
      ...existing,
      ...patch,
      context: patch.context ?? existing.context,
      updatedAt: new Date().toISOString(),
    };
    if (patch.status === 'archived') next.archivedAt = new Date().toISOString();
    if (patch.status === 'active') next.archivedAt = null;
    await this.writeValue(`${P.sessions}/${userId}/${id}`, next);
    return next;
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    const paths = [
      `${P.sessions}/${userId}/${id}`,
      `${P.messages}/${userId}/${id}`,
      `${P.turns}/${userId}/${id}`,
      `${P.replies}/${userId}/${id}`,
    ];
    for (const path of paths) {
      const ref = await this.ref(path);
      await ref.remove();
    }
  }

  // ---- Messages ----------------------------------------------------------

  async listMessages(userId: string, sessionId: string): Promise<ChatMessage[]> {
    const raw = await this.readValue<Record<string, ChatMessage>>(`${P.messages}/${userId}/${sessionId}`);
    if (!raw) return [];
    return Object.values(raw).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  async addMessage(userId: string, message: ChatMessage): Promise<ChatMessage> {
    await this.writeValue(`${P.messages}/${userId}/${message.sessionId}/${message.id}`, message);
    await this.syncSessionCounters(userId, message.sessionId);
    return message;
  }

  async deleteMessage(userId: string, sessionId: string, messageId: string): Promise<void> {
    const ref = await this.ref(`${P.messages}/${userId}/${sessionId}/${messageId}`);
    await ref.remove();
    await this.syncSessionCounters(userId, sessionId);
  }

  // ---- Assistant turns ---------------------------------------------------

  async listTurns(userId: string, sessionId: string): Promise<AssistantTurn[]> {
    const raw = await this.readValue<Record<string, AssistantTurn>>(`${P.turns}/${userId}/${sessionId}`);
    if (!raw) return [];
    return Object.values(raw).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  async addTurn(userId: string, turn: AssistantTurn): Promise<AssistantTurn> {
    await this.writeValue(`${P.turns}/${userId}/${turn.sessionId}/${turn.id}`, turn);
    return turn;
  }

  async updateTurn(userId: string, sessionId: string, turnId: string, content: string): Promise<AssistantTurn> {
    const ref = await this.ref(`${P.turns}/${userId}/${sessionId}/${turnId}`);
    const snap = await ref.get();
    const existing = snap.val() as AssistantTurn | null;
    if (!existing) throw new Error('Odgovor nije pronađen.');
    const next = { ...existing, content };
    await ref.set(next);
    return next;
  }

  async deleteTurn(userId: string, sessionId: string, turnId: string): Promise<void> {
    const ref = await this.ref(`${P.turns}/${userId}/${sessionId}/${turnId}`);
    await ref.remove();
  }

  /** Keeps the session header in sync after a message is deleted. */
  private async syncSessionCounters(userId: string, sessionId: string): Promise<void> {
    const messages = await this.listMessages(userId, sessionId);
    const last = messages[messages.length - 1];
    const session = await this.getSession(userId, sessionId);
    if (!session) return;
    await this.writeValue(`${P.sessions}/${userId}/${sessionId}`, {
      ...session,
      messageCount: messages.length,
      lastMessageAt: last?.createdAt ?? null,
      updatedAt: new Date().toISOString(),
    });
  }

  // ---- Replies -----------------------------------------------------------

  async listReplies(userId: string, sessionId: string): Promise<GeneratedReply[]> {
    const raw = await this.readValue<Record<string, GeneratedReply>>(`${P.replies}/${userId}/${sessionId}`);
    if (!raw) return [];
    return sortNewestFirst(Object.values(raw), 'createdAt');
  }

  async addReply(userId: string, reply: GeneratedReply): Promise<GeneratedReply> {
    await this.writeValue(`${P.replies}/${userId}/${reply.sessionId}/${reply.id}`, reply);
    return reply;
  }

  async updateReply(userId: string, replyId: string, patch: Partial<GeneratedReply>): Promise<GeneratedReply | null> {
    const all = await this.readValue<Record<string, Record<string, GeneratedReply>>>(`${P.replies}/${userId}`);
    if (!all) return null;
    for (const [sessionId, replies] of Object.entries(all)) {
      const existing = replies?.[replyId];
      if (!existing) continue;
      const next = { ...existing, ...patch };
      await this.writeValue(`${P.replies}/${userId}/${sessionId}/${replyId}`, next);
      return next;
    }
    return null;
  }

  async deleteReply(userId: string, replyId: string): Promise<void> {
    const all = await this.readValue<Record<string, Record<string, GeneratedReply>>>(`${P.replies}/${userId}`);
    if (!all) return;
    for (const [sessionId, replies] of Object.entries(all)) {
      if (!replies?.[replyId]) continue;
      const ref = await this.ref(`${P.replies}/${userId}/${sessionId}/${replyId}`);
      await ref.remove();
      return;
    }
  }

  // ---- Products ----------------------------------------------------------

  async upsertProducts(products: Product[]): Promise<UpsertProductsResult> {
    const result: UpsertProductsResult = { created: 0, updated: 0, unchanged: 0, failed: 0, failures: [] };
    const existing = new Map((await this.catalog()).map((p) => [p.id, p]));

    for (const product of products) {
      try {
        const previous = existing.get(product.id);
        if (!previous) {
          await this.writeValue(`${P.products}/${product.id}`, product);
          result.created++;
          continue;
        }
        const same = JSON.stringify(clean(previous)) === JSON.stringify(clean(product));
        if (same) {
          result.unchanged++;
        } else {
          await this.writeValue(`${P.products}/${product.id}`, product);
          result.updated++;
        }
      } catch (err) {
        result.failed++;
        result.failures.push({
          productId: product?.id ?? null,
          name: product?.name ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.invalidateCatalog();
    return result;
  }

  async getProduct(productId: string): Promise<Product | null> {
    const raw = await this.readValue<Product>(`${P.products}/${productId}`);
    return raw ? reviveProduct(raw) : null;
  }

  async getProductsByIds(ids: string[]): Promise<Product[]> {
    if (!ids.length) return [];
    const catalog = await this.catalog();
    const index = new Map(catalog.map((p) => [p.id, p]));
    return ids.map((id) => index.get(id)).filter((p): p is Product => Boolean(p));
  }

  async searchProducts(query: string, limit = 8): Promise<Product[]> {
    const catalog = await this.catalog();
    return searchProductCatalog(catalog, query, limit).map((hit) => hit.product);
  }

  async listProducts(limit: number, offset = 0): Promise<Product[]> {
    const catalog = await this.catalog();
    return [...catalog].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')).slice(offset, offset + limit);
  }

  async countProducts(): Promise<number> {
    return (await this.catalog()).length;
  }

  async getProductAdditional(productId: string): Promise<ProductAdditionalData | null> {
    return this.readValue<ProductAdditionalData>(`${P.additional}/${productId}`);
  }

  async saveProductAdditional(data: ProductAdditionalData): Promise<ProductAdditionalData> {
    await this.writeValue(`${P.additional}/${data.productId}`, data);
    return data;
  }

  async searchProductsWithAdditional(query: string, limit = 8) {
    const hits = await this.searchProducts(query, limit);
    return Promise.all(
      hits.map(async (product) => ({ product, additional: await this.getProductAdditional(product.id) })),
    );
  }

  // ---- Quick replies -----------------------------------------------------

  async listQuickReplies(userId: string): Promise<QuickReply[]> {
    const raw = await this.readValue<Record<string, QuickReply>>(`${P.quickReplies}/${userId}`);
    if (!raw) return [];
    // Agent-controlled order (Settings ↑/↓) must win over creation time,
    // otherwise reordering the buttons has no visible effect in the workspace.
    return Object.values(raw).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
    );
  }

  async createQuickReply(userId: string, reply: QuickReply): Promise<QuickReply> {
    await this.writeValue(`${P.quickReplies}/${userId}/${reply.id}`, reply);
    return reply;
  }

  async updateQuickReply(userId: string, id: string, patch: Partial<QuickReply>): Promise<QuickReply | null> {
    const existing = await this.readValue<QuickReply>(`${P.quickReplies}/${userId}/${id}`);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    await this.writeValue(`${P.quickReplies}/${userId}/${id}`, next);
    return next;
  }

  async deleteQuickReply(userId: string, id: string): Promise<void> {
    const ref = await this.ref(`${P.quickReplies}/${userId}/${id}`);
    await ref.remove();
  }

  // ---- Procedures --------------------------------------------------------

  async listProcedures(userId: string): Promise<CompanyProcedure[]> {
    const raw = await this.readValue<Record<string, CompanyProcedure>>(`${P.procedures}/${userId}`);
    if (!raw) return [];
    return Object.values(raw).map((procedure) => ({ ...procedure, keywords: asArray<string>(procedure.keywords) }));
  }

  async upsertProcedure(userId: string, procedure: CompanyProcedure): Promise<CompanyProcedure> {
    await this.writeValue(`${P.procedures}/${userId}/${procedure.id}`, procedure);
    return procedure;
  }

  async deleteProcedure(userId: string, id: string): Promise<void> {
    const ref = await this.ref(`${P.procedures}/${userId}/${id}`);
    await ref.remove();
  }

  // ---- Settings ----------------------------------------------------------

  async getSettings(userId: string): Promise<AppSettings> {
    const stored = await this.readValue<AppSettings>(`${P.settings}/${userId}`);
    if (stored) return mergeDefaults(defaultSettings(), stored);
    const seed = defaultSettings();
    await this.writeValue(`${P.settings}/${userId}`, seed);
    return seed;
  }

  async saveSettings(userId: string, settings: AppSettings): Promise<AppSettings> {
    await this.writeValue(`${P.settings}/${userId}`, settings);
    return settings;
  }

  // ---- Scraper -----------------------------------------------------------

  async saveScraperRun(run: ScraperRun): Promise<void> {
    await this.writeValue(`${P.runs}/${run.id}`, run);
  }

  async listScraperRuns(limit = 20): Promise<ScraperRun[]> {
    const raw = await this.readValue<Record<string, ScraperRun>>(P.runs);
    if (!raw) return [];
    return sortNewestFirst(Object.values(raw), 'startedAt').slice(0, limit);
  }

  async getScraperState(): Promise<ScraperState> {
    const [stored, total] = await Promise.all([
      this.readValue<ScraperState>(`${P.meta}/scraperState`),
      this.countProducts(),
    ]);
    if (stored) return { ...mergeDefaults(this.emptyScraperState(total), stored), totalProducts: total };
    return this.emptyScraperState(total);
  }

  private emptyScraperState(total: number): ScraperState {
    return {
      lastSuccessfulSyncAt: null,
      lastAttemptedSyncAt: null,
      currentStatus: 'idle',
      intervalMinutes: serverEnv.scraper.intervalMinutes,
      totalProducts: total,
      lastRun: null,
    };
  }

  async saveScraperState(state: ScraperState): Promise<void> {
    await this.writeValue(`${P.meta}/scraperState`, state);
  }

  // ---- Audit -------------------------------------------------------------

  async logAudit(entry: AuditLogEntry): Promise<void> {
    await this.writeValue(`${P.audit}/${entry.userId}/${entry.id}`, entry);
  }

  async listAudit(userId: string, limit = 50): Promise<AuditLogEntry[]> {
    const raw = await this.readValue<Record<string, AuditLogEntry>>(`${P.audit}/${userId}`);
    if (!raw) return [];
    return sortNewestFirst(Object.values(raw), 'at').slice(0, limit);
  }
}
