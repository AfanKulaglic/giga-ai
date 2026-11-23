import type {
  AppSettings,
  CompanyProcedure,
  CustomerSession,
  QuickReply,
  ScraperState,
} from '@/lib/domain/types';

export interface BootstrapResponse {
  auth: { mode: 'firebase' | 'local' | 'password'; email: string | null };
  sessions: CustomerSession[];
  settings: AppSettings;
  procedures: CompanyProcedure[];
  quickReplies: QuickReply[];
  scraper: ScraperState & { totalProducts: number };
  productCount: number;
  config: {
    storage: 'rtdb' | 'firestore' | 'local';
    firebaseAdmin: boolean;
    firebaseClient: boolean;
    ai: boolean;
    aiModel: string;
    aiProvider: string;
    aiProviderLabel?: string;
    aiKeyEnv?: string | null;
    aiFreeTier?: string | null;
    aiKeyCount?: number;
    signatureConfigured: boolean;
    deliveryConfigured: boolean;
    discountRulesConfigured: boolean;
    orderFormProvisional: boolean;
  };
}

export type SessionDetail = {
  session: CustomerSession;
  messages: import('@/lib/domain/types').ChatMessage[];
  turns: import('@/lib/domain/types').AssistantTurn[];
  replies: import('@/lib/domain/types').GeneratedReply[];
};