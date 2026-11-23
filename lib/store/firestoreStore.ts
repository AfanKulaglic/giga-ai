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
import { searchProductCatalog, tokenize } from '@/lib/domain/productSearch';
import { defaultProcedures, defaultQuickReplies, defaultSettings } from '@/lib/config/defaults';
import { serverEnv } from '@/lib/config/env';
import type {
  AuditLogEntry,
  CreateSessionInput,
  Store,
  UpdateSessionInput,
  UpsertProductsResult,
} from './types';

// Lazy admin bootstrap so local mode / builds never need credentials.
type AdminModules = {
  db: import('firebase-admin/firestore').Firestore;
  FieldValue: typeof import('firebase-admin/firestore').FieldValue;
};

let adminPromise: Promise<AdminModules> | null = null;

async function getAdmin(): Promise<AdminModules> {
  if (!adminPromise) {
    adminPromise = (async () => {
      const { getApps, initializeApp, cert } = await import('firebase-admin/app');
      const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
      const { projectId, clientEmail, privateKey } = serverEnv.firebaseAdmin;
      if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Firebase Admin kredencijali nisu konfigurirani.');
      }
      const app =
        getApps().find((a) => a.name === 'giga-assistant') ??
        initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, 'giga-assistant');
      return { db: getFirestore(app), FieldValue };
    })();
  }
  return adminPromise;
}

const COL = {
  users: 'giga_users',
  sessions: 'giga_sessions',
  messages: 'giga_messages',
  turns: 'giga_turns',
  replies: 'giga_replies',
  products: 'giga_products',
  additional: 'giga_productAdditional',
  quickReplies: 'giga_quickReplies',
  procedures: 'giga_procedures',
  settings: 'giga_settings',
  runs: 'giga_scraperRuns',
  meta: 'giga_meta',
  audit: 'giga_audit',
} as const;

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function searchIndexFor(product: Product): string[] {
  const terms = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (!s) return;
    for (const token of tokenize(s)) {
      terms.add(token);
      if (token.length > 5) {
        for (let i = 3; i < token.length; i++) terms.add(token.slice(0, i));
      }
    }
  };
  add(product.name);
  add(product.brand);
  add(product.category);
  add(product.sku);
  for (const tag of product.tags) add(tag);
  if (product.sku) terms.add(product.sku.toLowerCase());
  return [...terms].slice(0, 120);
}

export class FirestoreStore implements Store {
  readonly mode = 'firestore' as const;

  private async ctx() {
    return getAdmin();
  }

  async ensureUser(userId: string, email?: string): Promise<void> {
    const { db, FieldValue } = await this.ctx();
    const ref = db.collection(COL.users).doc(userId);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ email: email ?? null, createdAt: new Date().toISOString(), updatedAt: FieldValue.serverTimestamp() });
    }
    await this.seedUserConfig(userId);
  }

  private async seedUserConfig(userId: string): Promise<void> {
    const { db } = await this.ctx();
    const settingsRef = db.collection(COL.settings).doc(userId);
    const settingsSnap = await settingsRef.get();
    if (!settingsSnap.exists) await settingsRef.set(clean(defaultSettings()));

    const quickSnap = await db.collection(COL.quickReplies).where('userId', '==', userId).limit(1).get();
    if (quickSnap.empty) {
      const batch = db.batch();
      for (const qr of defaultQuickReplies(userId)) {
        batch.set(db.collection(COL.quickReplies).doc(qr.id), clean(qr));
      }
      await batch.commit();
    }

    const procSnap = await db.collection(COL.procedures).where('userId', '==', userId).limit(1).get();
    if (procSnap.empty) {
      const batch = db.batch();
      for (const p of defaultProcedures(userId)) {
        batch.set(db.collection(COL.procedures).doc(p.id), clean(p));
      }
      await batch.commit();
    }
  }

  async listSessions(userId: string): Promise<CustomerSession[]> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.sessions).where('userId', '==', userId).orderBy('updatedAt', 'desc').get();
    return snap.docs.map((d) => d.data() as CustomerSession);
  }

  async getSession(userId: string, id: string): Promise<CustomerSession | null> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.sessions).doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() as CustomerSession;
    return data.userId === userId ? { ...data, context: normalizeSessionContext(data.context) } : null;
  }

  async createSession(userId: string, input?: CreateSessionInput): Promise<CustomerSession> {
    const { db } = await this.ctx();
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
    await db.collection(COL.sessions).doc(session.id).set(clean(session));
    return session;
  }

  async updateSession(userId: string, id: string, patch: UpdateSessionInput): Promise<CustomerSession> {
    const existing = await this.getSession(userId, id);
    if (!existing) throw new Error('Sesija nije pronađena.');
    const { db } = await this.ctx();
    const next: CustomerSession = {
      ...existing,
      ...patch,
      context: patch.context ?? existing.context,
      updatedAt: new Date().toISOString(),
    };
    if (patch.status === 'archived') next.archivedAt = new Date().toISOString();
    if (patch.status === 'active') next.archivedAt = null;
    await db.collection(COL.sessions).doc(id).set(clean(next));
    return next;
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    const session = await this.getSession(userId, id);
    if (!session) return;
    const { db } = await this.ctx();
    const batch = db.batch();
    for (const col of [COL.messages, COL.turns, COL.replies]) {
      const snap = await db.collection(col).where('userId', '==', userId).where('sessionId', '==', id).get();
      snap.docs.forEach((d) => batch.delete(d.ref));
    }
    batch.delete(db.collection(COL.sessions).doc(id));
    await batch.commit();
  }

  async listMessages(userId: string, sessionId: string): Promise<ChatMessage[]> {
    const { db } = await this.ctx();
    const snap = await db
      .collection(COL.messages)
      .where('userId', '==', userId)
      .where('sessionId', '==', sessionId)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => d.data() as ChatMessage);
  }

  async deleteMessage(userId: string, sessionId: string, messageId: string): Promise<void> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.messages).doc(messageId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const row = snap.data() as ChatMessage;
    if (row.userId !== userId) return;
    await ref.delete();
    const remaining = await this.listMessages(userId, sessionId);
    await this.updateSession(userId, sessionId, {
      messageCount: remaining.length,
      lastMessageAt: remaining[remaining.length - 1]?.createdAt ?? null,
    });
  }

  async addMessage(userId: string, message: ChatMessage): Promise<ChatMessage> {
    const { db } = await this.ctx();
    const session = await this.getSession(userId, message.sessionId);
    if (!session) throw new Error('Sesija nije pronađena.');
    await db.collection(COL.messages).doc(message.id).set(clean(message));
    const countSnap = await db
      .collection(COL.messages)
      .where('userId', '==', userId)
      .where('sessionId', '==', message.sessionId)
      .count()
      .get();
    await db
      .collection(COL.sessions)
      .doc(message.sessionId)
      .update({ messageCount: countSnap.data().count, lastMessageAt: message.createdAt, updatedAt: message.createdAt });
    return message;
  }

  async listTurns(userId: string, sessionId: string): Promise<AssistantTurn[]> {
    const { db } = await this.ctx();
    const snap = await db
      .collection(COL.turns)
      .where('userId', '==', userId)
      .where('sessionId', '==', sessionId)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => d.data() as AssistantTurn);
  }

  async addTurn(userId: string, turn: AssistantTurn): Promise<AssistantTurn> {
    const { db } = await this.ctx();
    await db.collection(COL.turns).doc(turn.id).set(clean({ ...turn, userId }));
    return turn;
  }

  async deleteTurn(userId: string, sessionId: string, turnId: string): Promise<void> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.turns).doc(turnId);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as AssistantTurn).userId === userId) await ref.delete();
  }

  async updateTurn(userId: string, sessionId: string, turnId: string, content: string): Promise<AssistantTurn> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.turns).doc(turnId);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as AssistantTurn).userId !== userId) throw new Error('Odgovor nije pronađen.');
    await ref.set({ content }, { merge: true });
    return { ...(snap.data() as AssistantTurn), content };
  }

  async listReplies(userId: string, sessionId: string): Promise<GeneratedReply[]> {
    const { db } = await this.ctx();
    const snap = await db
      .collection(COL.replies)
      .where('userId', '==', userId)
      .where('sessionId', '==', sessionId)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => d.data() as GeneratedReply);
  }

  async addReply(userId: string, reply: GeneratedReply): Promise<GeneratedReply> {
    const { db } = await this.ctx();
    await db.collection(COL.replies).doc(reply.id).set(clean({ ...reply, userId }));
    return reply;
  }

  async deleteReply(userId: string, replyId: string): Promise<void> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.replies).doc(replyId);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as GeneratedReply).userId === userId) await ref.delete();
  }

  async updateReply(userId: string, replyId: string, patch: Partial<GeneratedReply>): Promise<GeneratedReply | null> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.replies).doc(replyId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as GeneratedReply;
    if (data.userId !== userId) return null;
    const next = { ...data, ...patch, userId };
    await ref.set(clean(next));
    return next;
  }

  async upsertProducts(products: Product[]): Promise<UpsertProductsResult> {
    const { db } = await this.ctx();
    const result: UpsertProductsResult = { created: 0, updated: 0, unchanged: 0, failed: 0, failures: [] };
    for (const product of products) {
      try {
        if (product.extractionStatus === 'failed') {
          result.failed++;
          result.failures.push({ productId: product.id, name: product.name, error: product.lastError ?? 'Ekstrakcija nije uspjela.' });
          continue;
        }
        const ref = db.collection(COL.products).doc(product.id);
        const snap = await ref.get();
        const existing = snap.exists ? (snap.data() as Product) : null;
        const payload = clean({ ...product, searchIndex: searchIndexFor(product) });
        if (!existing) {
          await ref.set(payload);
          result.created++;
        } else if (existing.contentHash && existing.contentHash === product.contentHash) {
          await ref.update(
            clean({
              scrapedAt: product.scrapedAt,
              availability: product.availability,
              lastValidScrapeAt: product.scrapedAt,
              extractionStatus: product.extractionStatus,
              missingFields: product.missingFields,
              lastError: null,
            }),
          );
          result.unchanged++;
        } else {
          await ref.set(payload);
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
    return result;
  }

  async getProduct(productId: string): Promise<Product | null> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.products).doc(productId).get();
    return snap.exists ? (snap.data() as Product) : null;
  }

  async getProductsByIds(ids: string[]): Promise<Product[]> {
    const { db } = await this.ctx();
    if (!ids.length) return [];
    const refs = ids.map((id) => db.collection(COL.products).doc(id));
    const snaps = await db.getAll(...refs);
    return snaps.filter((s) => s.exists).map((s) => s.data() as Product);
  }

  async searchProducts(query: string, limit = 8): Promise<Product[]> {
    const { db } = await this.ctx();
    const tokens = tokenize(query).slice(0, 10);
    if (!tokens.length) return [];
    const snap = await db
      .collection(COL.products)
      .where('searchIndex', 'array-contains-any', tokens)
      .limit(60)
      .get();
    let products = snap.docs.map((d) => d.data() as Product);
    if (!products.length) {
      // Conservative fallback for typos: score a bounded page of the catalogue.
      const fallback = await db.collection(COL.products).orderBy('name').limit(500).get();
      products = fallback.docs.map((d) => d.data() as Product);
    }
    return searchProductCatalog(products, query, limit).map((h) => h.product);
  }

  async listProducts(limit: number, offset = 0): Promise<Product[]> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.products).orderBy('name').offset(offset).limit(limit).get();
    return snap.docs.map((d) => d.data() as Product);
  }

  async countProducts(): Promise<number> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.products).count().get();
    return snap.data().count;
  }

  async getProductAdditional(productId: string): Promise<ProductAdditionalData | null> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.additional).doc(productId).get();
    return snap.exists ? (snap.data() as ProductAdditionalData) : null;
  }

  async saveProductAdditional(data: ProductAdditionalData): Promise<ProductAdditionalData> {
    const { db } = await this.ctx();
    await db.collection(COL.additional).doc(data.productId).set(clean({ ...data, updatedAt: new Date().toISOString() }));
    return data;
  }

  async searchProductsWithAdditional(query: string, limit = 8) {
    const products = await this.searchProducts(query, limit);
    return Promise.all(
      products.map(async (product) => ({ product, additional: await this.getProductAdditional(product.id) })),
    );
  }

  async listQuickReplies(userId: string): Promise<QuickReply[]> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.quickReplies).where('userId', '==', userId).orderBy('sortOrder', 'asc').get();
    return snap.docs.map((d) => d.data() as QuickReply);
  }

  async createQuickReply(userId: string, reply: QuickReply): Promise<QuickReply> {
    const { db } = await this.ctx();
    const next = { ...reply, userId };
    await db.collection(COL.quickReplies).doc(reply.id).set(clean(next));
    return next;
  }

  async updateQuickReply(userId: string, id: string, patch: Partial<QuickReply>): Promise<QuickReply | null> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.quickReplies).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as QuickReply;
    if (data.userId !== userId) return null;
    const next = { ...data, ...patch, userId, updatedAt: new Date().toISOString() };
    await ref.set(clean(next));
    return next;
  }

  async deleteQuickReply(userId: string, id: string): Promise<void> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.quickReplies).doc(id);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as QuickReply).userId === userId) await ref.delete();
  }

  async listProcedures(userId: string): Promise<CompanyProcedure[]> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.procedures).where('userId', '==', userId).get();
    return snap.docs.map((d) => d.data() as CompanyProcedure);
  }

  async upsertProcedure(userId: string, procedure: CompanyProcedure): Promise<CompanyProcedure> {
    const { db } = await this.ctx();
    const next = { ...procedure, userId, updatedAt: new Date().toISOString() };
    await db.collection(COL.procedures).doc(procedure.id).set(clean(next));
    return next;
  }

  async deleteProcedure(userId: string, id: string): Promise<void> {
    const { db } = await this.ctx();
    const ref = db.collection(COL.procedures).doc(id);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as CompanyProcedure).userId === userId) await ref.delete();
  }

  async getSettings(userId: string): Promise<AppSettings> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.settings).doc(userId).get();
    return snap.exists ? (snap.data() as AppSettings) : defaultSettings();
  }

  async saveSettings(userId: string, settings: AppSettings): Promise<AppSettings> {
    const { db } = await this.ctx();
    const next = { ...settings, updatedAt: new Date().toISOString() };
    await db.collection(COL.settings).doc(userId).set(clean(next));
    return next;
  }

  async saveScraperRun(run: ScraperRun): Promise<void> {
    const { db } = await this.ctx();
    await db.collection(COL.runs).doc(run.id).set(clean(run));
  }

  async listScraperRuns(limit = 20): Promise<ScraperRun[]> {
    const { db } = await this.ctx();
    const snap = await db.collection(COL.runs).orderBy('startedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as ScraperRun);
  }

  async getScraperState(): Promise<ScraperState> {
    const { db } = await this.ctx();
    const [stateSnap, total] = await Promise.all([
      db.collection(COL.meta).doc('scraperState').get(),
      this.countProducts(),
    ]);
    if (stateSnap.exists) {
      return { ...(stateSnap.data() as ScraperState), totalProducts: total };
    }
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
    const { db } = await this.ctx();
    await db.collection(COL.meta).doc('scraperState').set(clean(state));
  }

  async logAudit(entry: AuditLogEntry): Promise<void> {
    const { db } = await this.ctx();
    await db.collection(COL.audit).doc(entry.id).set(clean(entry));
  }

  async listAudit(userId: string, limit = 50): Promise<AuditLogEntry[]> {
    const { db } = await this.ctx();
    const snap = await db
      .collection(COL.audit)
      .where('userId', '==', userId)
      .orderBy('at', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as AuditLogEntry);
  }
}
