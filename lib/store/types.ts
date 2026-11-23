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

export interface CreateSessionInput {
  label?: string;
}

export interface UpdateSessionInput {
  label?: string;
  status?: 'active' | 'archived';
  context?: CustomerSession['context'];
  lastMessageAt?: string | null;
  messageCount?: number;
}

export interface UpsertProductsResult {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  failures: { productId: string | null; name: string | null; error: string }[];
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: string | null;
  at: string;
}

export interface Store {
  readonly mode: 'firestore' | 'rtdb' | 'local';

  ensureUser(userId: string, email?: string): Promise<void>;

  // Sessions
  listSessions(userId: string): Promise<CustomerSession[]>;
  getSession(userId: string, id: string): Promise<CustomerSession | null>;
  createSession(userId: string, input?: CreateSessionInput): Promise<CustomerSession>;
  updateSession(userId: string, id: string, patch: UpdateSessionInput): Promise<CustomerSession>;
  deleteSession(userId: string, id: string): Promise<void>;

  // Messages
  listMessages(userId: string, sessionId: string): Promise<ChatMessage[]>;
  addMessage(userId: string, message: ChatMessage): Promise<ChatMessage>;
  deleteMessage(userId: string, sessionId: string, messageId: string): Promise<void>;

  // Assistant turns (private AI chat)
  listTurns(userId: string, sessionId: string): Promise<AssistantTurn[]>;
  addTurn(userId: string, turn: AssistantTurn): Promise<AssistantTurn>;
  deleteTurn(userId: string, sessionId: string, turnId: string): Promise<void>;
  /** Mijenja sadržaj odgovora asistenta (agent ispravi poruku prije slanja). */
  updateTurn(userId: string, sessionId: string, turnId: string, content: string): Promise<AssistantTurn>;

  // Generated customer replies
  listReplies(userId: string, sessionId: string): Promise<GeneratedReply[]>;
  addReply(userId: string, reply: GeneratedReply): Promise<GeneratedReply>;
  updateReply(userId: string, replyId: string, patch: Partial<GeneratedReply>): Promise<GeneratedReply | null>;
  /** Briše nacrt odgovora (agent odbaci prijedlog). */
  deleteReply(userId: string, replyId: string): Promise<void>;

  // Products (shared catalogue)
  upsertProducts(products: Product[]): Promise<UpsertProductsResult>;
  getProduct(productId: string): Promise<Product | null>;
  getProductsByIds(ids: string[]): Promise<Product[]>;
  searchProducts(query: string, limit?: number): Promise<Product[]>;
  listProducts(limit: number, offset?: number): Promise<Product[]>;
  countProducts(): Promise<number>;
  getProductAdditional(productId: string): Promise<ProductAdditionalData | null>;
  saveProductAdditional(data: ProductAdditionalData): Promise<ProductAdditionalData>;
  searchProductsWithAdditional(query: string, limit?: number): Promise<{ product: Product; additional: ProductAdditionalData | null }[]>;

  // Quick replies
  listQuickReplies(userId: string): Promise<QuickReply[]>;
  createQuickReply(userId: string, reply: QuickReply): Promise<QuickReply>;
  updateQuickReply(userId: string, id: string, patch: Partial<QuickReply>): Promise<QuickReply | null>;
  deleteQuickReply(userId: string, id: string): Promise<void>;

  // Company procedures
  listProcedures(userId: string): Promise<CompanyProcedure[]>;
  upsertProcedure(userId: string, procedure: CompanyProcedure): Promise<CompanyProcedure>;
  deleteProcedure(userId: string, id: string): Promise<void>;

  // Settings
  getSettings(userId: string): Promise<AppSettings>;
  saveSettings(userId: string, settings: AppSettings): Promise<AppSettings>;

  // Scraper
  saveScraperRun(run: ScraperRun): Promise<void>;
  listScraperRuns(limit?: number): Promise<ScraperRun[]>;
  getScraperState(): Promise<ScraperState>;
  saveScraperState(state: ScraperState): Promise<void>;

  // Audit
  logAudit(entry: AuditLogEntry): Promise<void>;
  listAudit(userId: string, limit?: number): Promise<AuditLogEntry[]>;
}
