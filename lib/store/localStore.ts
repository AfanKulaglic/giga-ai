import { promises as fs } from 'node:fs';
import path from 'node:path';
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
import type {
  AuditLogEntry,
  CreateSessionInput,
  Store,
  UpdateSessionInput,
  UpsertProductsResult,
} from './types';

// ---------------------------------------------------------------------------
// LocalStore: a genuine server-side persistence implementation used when
// Firebase credentials are not configured. It writes atomically to a JSON file
// so the application is fully functional (and testable) without cloud setup.
// This is real storage, not simulated responses.
// ---------------------------------------------------------------------------

interface LocalDb {
  version: 1;
  users: Record<string, { id: string; email?: string; createdAt: string }>;
  sessions: Record<string, CustomerSession>;
  messages: Record<string, ChatMessage[]>;
  turns: Record<string, AssistantTurn[]>;
  replies: Record<string, GeneratedReply[]>;
  products: Record<string, Product>;
  productAdditional: Record<string, ProductAdditionalData>;
  quickReplies: Record<string, QuickReply>;
  procedures: Record<string, CompanyProcedure>;
  settings: Record<string, AppSettings>;
  scraperRuns: ScraperRun[];
  scraperState: ScraperState | null;
  audit: AuditLogEntry[];
}

function defaultDb(): LocalDb {
  return {
    version: 1,
    users: {},
    sessions: {},
    messages: {},
    turns: {},
    replies: {},
    products: {},
    productAdditional: {},
    quickReplies: {},
    procedures: {},
    settings: {},
    scraperRuns: [],
    scraperState: null,
    audit: [],
  };
}

export class LocalStore implements Store {
  readonly mode = 'local' as const;
  private db: LocalDb;
  private loaded = false;
  private lastMtimeMs = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(dir = process.env.LOCAL_DATA_DIR || '.data') {
    this.filePath = path.join(process.cwd(), dir, 'db.json');
    this.lockPath = `${this.filePath}.lock`;
    this.db = defaultDb();
  }

  private async readFile(): Promise<void> {
    try {
      const stat = await fs.stat(this.filePath);
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.db = { ...defaultDb(), ...(JSON.parse(raw) as LocalDb) };
      this.lastMtimeMs = stat.mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.db = defaultDb();
      this.lastMtimeMs = 0;
    }
    this.loaded = true;
  }

  private async load(): Promise<void> {
    if (!this.loaded) {
      await this.readFile();
      return;
    }
    // Pick up writes made by another process (e.g. the scraper worker).
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.mtimeMs > this.lastMtimeMs) await this.readFile();
    } catch {
      /* file may not exist yet */
    }
  }

  private async withFileLock<T>(fn: () => Promise<T>): Promise<T> {
    let handle: import('node:fs/promises').FileHandle | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        handle = await fs.open(this.lockPath, 'wx');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    try {
      return await fn();
    } finally {
      await handle?.close().catch(() => undefined);
      if (handle) await fs.unlink(this.lockPath).catch(() => undefined);
    }
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(() =>
      this.withFileLock(async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.${randomUUID()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf8');
        await fs.rename(tmp, this.filePath);
        const stat = await fs.stat(this.filePath);
        this.lastMtimeMs = stat.mtimeMs;
      }),
    );
    return this.writeChain.catch((err) => {
      console.error('[LocalStore] write failed', err);
      throw err;
    });
  }

  async ensureUser(userId: string, email?: string): Promise<void> {
    await this.load();
    if (!this.db.users[userId]) {
      this.db.users[userId] = { id: userId, email, createdAt: new Date().toISOString() };
      await this.persist();
    }
  }

  async listSessions(userId: string): Promise<CustomerSession[]> {
    await this.load();
    return Object.values(this.db.sessions)
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(userId: string, id: string): Promise<CustomerSession | null> {
    await this.load();
    const s = this.db.sessions[id];
    return s && s.userId === userId ? { ...s, context: normalizeSessionContext(s.context) } : null;
  }

  async createSession(userId: string, input?: CreateSessionInput): Promise<CustomerSession> {
    await this.load();
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
    this.db.sessions[session.id] = session;
    this.db.messages[session.id] = [];
    this.db.turns[session.id] = [];
    this.db.replies[session.id] = [];
    await this.persist();
    return session;
  }

  async updateSession(userId: string, id: string, patch: UpdateSessionInput): Promise<CustomerSession> {
    await this.load();
    const existing = this.db.sessions[id];
    if (!existing || existing.userId !== userId) throw new Error('Sesija nije pronađena.');
    const next: CustomerSession = {
      ...existing,
      ...patch,
      context: patch.context ?? existing.context,
      updatedAt: new Date().toISOString(),
    };
    if (patch.status === 'archived') next.archivedAt = new Date().toISOString();
    if (patch.status === 'active') next.archivedAt = null;
    this.db.sessions[id] = next;
    await this.persist();
    return next;
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    await this.load();
    const existing = this.db.sessions[id];
    if (!existing || existing.userId !== userId) return;
    delete this.db.sessions[id];
    delete this.db.messages[id];
    delete this.db.turns[id];
    delete this.db.replies[id];
    await this.persist();
  }

  async listMessages(userId: string, sessionId: string): Promise<ChatMessage[]> {
    await this.load();
    return (this.db.messages[sessionId] ?? [])
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addMessage(userId: string, message: ChatMessage): Promise<ChatMessage> {
    await this.load();
    const session = this.db.sessions[message.sessionId];
    if (!session || session.userId !== userId) throw new Error('Sesija nije pronađena.');
    const list = this.db.messages[message.sessionId] ?? [];
    list.push(message);
    this.db.messages[message.sessionId] = list;
    this.db.sessions[message.sessionId] = {
      ...session,
      messageCount: list.length,
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
    };
    await this.persist();
    return message;
  }

  async deleteMessage(userId: string, sessionId: string, messageId: string): Promise<void> {
    await this.load();
    const session = this.db.sessions[sessionId];
    if (!session || session.userId !== userId) throw new Error('Sesija nije pronađena.');
    const list = (this.db.messages[sessionId] ?? []).filter((m) => m.id !== messageId);
    this.db.messages[sessionId] = list;
    this.db.sessions[sessionId] = {
      ...session,
      messageCount: list.length,
      lastMessageAt: list[list.length - 1]?.createdAt ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  async listTurns(userId: string, sessionId: string): Promise<AssistantTurn[]> {
    await this.load();
    return (this.db.turns[sessionId] ?? [])
      .filter((t) => t.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addTurn(userId: string, turn: AssistantTurn): Promise<AssistantTurn> {
    await this.load();
    const list = this.db.turns[turn.sessionId] ?? [];
    list.push(turn);
    this.db.turns[turn.sessionId] = list;
    await this.persist();
    return turn;
  }

  async deleteTurn(userId: string, sessionId: string, turnId: string): Promise<void> {
    await this.load();
    this.db.turns[sessionId] = (this.db.turns[sessionId] ?? []).filter(
      (t) => t.id !== turnId || t.userId !== userId,
    );
    await this.persist();
  }

  async updateTurn(userId: string, sessionId: string, turnId: string, content: string): Promise<AssistantTurn> {
    await this.load();
    const list = this.db.turns[sessionId] ?? [];
    const index = list.findIndex((t) => t.id === turnId && t.userId === userId);
    if (index < 0) throw new Error('Odgovor nije pronađen.');
    const updated: AssistantTurn = { ...(list[index] as AssistantTurn), content };
    list[index] = updated;
    await this.persist();
    return updated;
  }

  async listReplies(userId: string, sessionId: string): Promise<GeneratedReply[]> {
    await this.load();
    return (this.db.replies[sessionId] ?? [])
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addReply(userId: string, reply: GeneratedReply): Promise<GeneratedReply> {
    await this.load();
    const list = this.db.replies[reply.sessionId] ?? [];
    list.push(reply);
    this.db.replies[reply.sessionId] = list;
    await this.persist();
    return reply;
  }

  async deleteReply(userId: string, replyId: string): Promise<void> {
    await this.load();
    for (const sessionId of Object.keys(this.db.replies)) {
      this.db.replies[sessionId] = (this.db.replies[sessionId] ?? []).filter(
        (r) => r.id !== replyId || r.userId !== userId,
      );
    }
    await this.persist();
  }

  async updateReply(userId: string, replyId: string, patch: Partial<GeneratedReply>): Promise<GeneratedReply | null> {
    await this.load();
    for (const [sessionId, list] of Object.entries(this.db.replies)) {
      const idx = list.findIndex((r) => r.id === replyId && r.userId === userId);
      if (idx >= 0) {
        const next = { ...list[idx]!, ...patch };
        list[idx] = next;
        this.db.replies[sessionId] = list;
        await this.persist();
        return next;
      }
    }
    return null;
  }

  async upsertProducts(products: Product[]): Promise<UpsertProductsResult> {
    await this.load();
    const result: UpsertProductsResult = { created: 0, updated: 0, unchanged: 0, failed: 0, failures: [] };
    for (const product of products) {
      try {
        if (product.extractionStatus === 'failed') {
          result.failed++;
          result.failures.push({ productId: product.id, name: product.name, error: product.lastError ?? 'Ekstrakcija nije uspjela.' });
          const existing = this.db.products[product.id];
          if (existing) {
            this.db.products[product.id] = {
              ...existing,
              extractionStatus: 'incomplete',
              lastError: product.lastError ?? 'Posljednja ekstrakcija nije uspjela.',
            };
          }
          continue;
        }
        const existing = this.db.products[product.id];
        if (!existing) {
          this.db.products[product.id] = product;
          result.created++;
        } else if (existing.contentHash && existing.contentHash === product.contentHash) {
          this.db.products[product.id] = {
            ...existing,
            scrapedAt: product.scrapedAt,
            availability: product.availability,
            lastValidScrapeAt: product.scrapedAt,
            extractionStatus: product.extractionStatus,
            missingFields: product.missingFields,
            lastError: null,
          };
          result.unchanged++;
        } else {
          this.db.products[product.id] = { ...product, lastValidScrapeAt: product.scrapedAt };
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
    await this.persist();
    return result;
  }

  async getProduct(productId: string): Promise<Product | null> {
    await this.load();
    return this.db.products[productId] ?? null;
  }

  async getProductsByIds(ids: string[]): Promise<Product[]> {
    await this.load();
    return ids.map((id) => this.db.products[id]).filter((p): p is Product => Boolean(p));
  }

  async searchProducts(query: string, limit = 8): Promise<Product[]> {
    await this.load();
    return searchProductCatalog(Object.values(this.db.products), query, limit).map((h) => h.product);
  }

  async listProducts(limit: number, offset = 0): Promise<Product[]> {
    await this.load();
    return Object.values(this.db.products)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(offset, offset + limit);
  }

  async countProducts(): Promise<number> {
    await this.load();
    return Object.keys(this.db.products).length;
  }

  async getProductAdditional(productId: string): Promise<ProductAdditionalData | null> {
    await this.load();
    return this.db.productAdditional[productId] ?? null;
  }

  async saveProductAdditional(data: ProductAdditionalData): Promise<ProductAdditionalData> {
    await this.load();
    this.db.productAdditional[data.productId] = data;
    await this.persist();
    return data;
  }

  async searchProductsWithAdditional(query: string, limit = 8) {
    const products = await this.searchProducts(query, limit);
    return Promise.all(
      products.map(async (product) => ({ product, additional: await this.getProductAdditional(product.id) })),
    );
  }

  private async ensureUserConfig(userId: string): Promise<void> {
    const now = new Date().toISOString();
    const hasQuick = Object.values(this.db.quickReplies).some((q) => q.userId === userId);
    if (!hasQuick) {
      for (const qr of defaultQuickReplies(userId)) this.db.quickReplies[qr.id] = qr;
    }
    const hasProc = Object.values(this.db.procedures).some((p) => p.userId === userId);
    if (!hasProc) {
      for (const p of defaultProcedures(userId)) this.db.procedures[p.id] = p;
    }
    if (!this.db.settings[userId]) {
      this.db.settings[userId] = { ...defaultSettings(), updatedAt: now };
    }
    await this.persist();
  }

  async listQuickReplies(userId: string): Promise<QuickReply[]> {
    await this.load();
    await this.ensureUserConfig(userId);
    return Object.values(this.db.quickReplies)
      .filter((q) => q.userId === userId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  }

  async createQuickReply(userId: string, reply: QuickReply): Promise<QuickReply> {
    await this.load();
    this.db.quickReplies[reply.id] = { ...reply, userId };
    await this.persist();
    return reply;
  }

  async updateQuickReply(userId: string, id: string, patch: Partial<QuickReply>): Promise<QuickReply | null> {
    await this.load();
    const existing = this.db.quickReplies[id];
    if (!existing || existing.userId !== userId) return null;
    const next = { ...existing, ...patch, userId, updatedAt: new Date().toISOString() };
    this.db.quickReplies[id] = next;
    await this.persist();
    return next;
  }

  async deleteQuickReply(userId: string, id: string): Promise<void> {
    await this.load();
    const existing = this.db.quickReplies[id];
    if (existing?.userId === userId) {
      delete this.db.quickReplies[id];
      await this.persist();
    }
  }

  async listProcedures(userId: string): Promise<CompanyProcedure[]> {
    await this.load();
    await this.ensureUserConfig(userId);
    return Object.values(this.db.procedures).filter((p) => p.userId === userId);
  }

  async upsertProcedure(userId: string, procedure: CompanyProcedure): Promise<CompanyProcedure> {
    await this.load();
    const next = { ...procedure, userId, updatedAt: new Date().toISOString() };
    this.db.procedures[procedure.id] = next;
    await this.persist();
    return next;
  }

  async deleteProcedure(userId: string, id: string): Promise<void> {
    await this.load();
    const existing = this.db.procedures[id];
    if (existing?.userId === userId) {
      delete this.db.procedures[id];
      await this.persist();
    }
  }

  async getSettings(userId: string): Promise<AppSettings> {
    await this.load();
    await this.ensureUserConfig(userId);
    return this.db.settings[userId] ?? defaultSettings();
  }

  async saveSettings(userId: string, settings: AppSettings): Promise<AppSettings> {
    await this.load();
    const next = { ...settings, updatedAt: new Date().toISOString() };
    this.db.settings[userId] = next;
    await this.persist();
    return next;
  }

  async saveScraperRun(run: ScraperRun): Promise<void> {
    await this.load();
    const idx = this.db.scraperRuns.findIndex((r) => r.id === run.id);
    if (idx >= 0) this.db.scraperRuns[idx] = run;
    else this.db.scraperRuns.unshift(run);
    this.db.scraperRuns = this.db.scraperRuns.slice(0, 50);
    await this.persist();
  }

  async listScraperRuns(limit = 20): Promise<ScraperRun[]> {
    await this.load();
    return this.db.scraperRuns.slice(0, limit);
  }

  async getScraperState(): Promise<ScraperState> {
    await this.load();
    const total = await this.countProducts();
    const lastRun = this.db.scraperRuns[0] ?? null;
    return (
      this.db.scraperState ?? {
        lastSuccessfulSyncAt: lastRun?.status === 'success' ? lastRun.finishedAt : null,
        lastAttemptedSyncAt: lastRun?.startedAt ?? null,
        currentStatus: lastRun?.status === 'running' ? 'running' : lastRun?.status === 'failed' ? 'error' : 'idle',
        intervalMinutes: Number(process.env.SCRAPER_INTERVAL_MINUTES ?? 360),
        totalProducts: total,
        lastRun,
      }
    );
  }

  async saveScraperState(state: ScraperState): Promise<void> {
    await this.load();
    this.db.scraperState = state;
    await this.persist();
  }

  async logAudit(entry: AuditLogEntry): Promise<void> {
    await this.load();
    this.db.audit.unshift(entry);
    this.db.audit = this.db.audit.slice(0, 500);
    await this.persist();
  }

  async listAudit(userId: string, limit = 50): Promise<AuditLogEntry[]> {
    await this.load();
    return this.db.audit.filter((a) => a.userId === userId).slice(0, limit);
  }

  /** Test helper: clear all data. */
  async resetForTests(): Promise<void> {
    this.db = defaultDb();
    this.loaded = true;
    await this.persist();
  }
}

// Singleton across hot reloads / route handlers.
const globalForStore = globalThis as unknown as { __localStore?: LocalStore };
export function getLocalStore(): LocalStore {
  if (!globalForStore.__localStore) globalForStore.__localStore = new LocalStore();
  return globalForStore.__localStore;
}
