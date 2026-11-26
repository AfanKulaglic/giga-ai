'use client';

import * as React from 'react';
import { apiFetch } from '@/lib/client/api';
import type { BootstrapResponse, SessionDetail } from '@/lib/client/types';
import type {
  AppSettings,
  ChatMessage,
  CompanyProcedure,
  CustomerSession,
  GeneratedReply,
  Product,
  ProductAdditionalData,
  QuickReply,
  SenderType,
  SessionContext,
} from '@/lib/domain/types';
import { calculateOrder, type CalculationResult, type CalcItemInput } from '@/lib/domain/calculator';
import { contextProductFrom } from '@/lib/domain/productSearch';
import { emptySessionContext, upsertContextProduct } from '@/lib/domain/sessionContext';

interface WorkspaceValue {
  ready: boolean;
  error: string | null;
  bootstrap: BootstrapResponse | null;
  sessions: CustomerSession[];
  settings: AppSettings | null;
  procedures: CompanyProcedure[];
  quickReplies: QuickReply[];
  activeSessionId: string | null;
  detail: SessionDetail | null;
  loadingSession: boolean;
  catalog: Record<string, { product: Product; additional: ProductAdditionalData | null }>;

  // composing state
  aiBusy: boolean;
  replyBusy: boolean;
  messageBusy: boolean;

  // calculator
  calculation: CalculationResult | null;
  manualDiscount: number | null;
  setManualDiscount: (value: number | null) => void;

  refreshBootstrap: () => Promise<void>;
  openSession: (id: string | null) => Promise<void>;
  createSession: (label?: string) => Promise<CustomerSession>;
  renameSession: (label: string) => Promise<void>;
  setSessionStatus: (status: 'active' | 'archived') => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /**
   * Reset razgovora: briše SVE sesije i otvara jedan prazan razgovor.
   * Agent ne drži historiju — jedan kupac, jedan razgovor, jedan reset.
   */
  resetWorkspace: () => Promise<CustomerSession | null>;

  sendMessage: (content: string, senderType: SenderType) => Promise<ChatMessage>;
  deleteMessage: (messageId: string) => Promise<void>;
  deleteTurn: (turnId: string) => Promise<void>;
  /** Ispravka teksta odgovora asistenta (ono što ide kupcu). */
  editTurn: (turnId: string, content: string) => Promise<void>;
  askAssistant: (message: string) => Promise<void>;
  generateReply: (opts?: { tone?: 'concise' | 'balanced' | 'detailed'; instruction?: string }) => Promise<GeneratedReply | null>;
  /** Napomene iz zadnjeg generisanja: šta AI nije imao u podacima. */
  replyNotes: string[];
  editReply: (replyId: string, body: string) => Promise<GeneratedReply | null>;
  classify: (text: string) => Promise<{ suggestedType: SenderType; confidence: number; rationale?: string }>;

  setContext: (next: SessionContext) => Promise<void>;
  addProductToContext: (product: Product, quantity?: number) => Promise<void>;
  updateQuantity: (productId: string, quantity: number | null) => Promise<void>;
  removeProduct: (productId: string) => Promise<void>;
  refreshProduct: (productId: string) => Promise<void>;

  saveSettings: (settings: AppSettings) => Promise<void>;
  saveQuickReply: (reply: Partial<QuickReply> & { id?: string }) => Promise<void>;
  deleteQuickReply: (id: string) => Promise<void>;
  saveProcedure: (procedure: Partial<CompanyProcedure>) => Promise<void>;
  deleteProcedure: (id: string) => Promise<void>;
  refreshScraper: () => Promise<void>;
}

/**
 * Tells the navbar token counter that a model call just happened, so the daily
 * spend updates immediately instead of on the next poll.
 */
function notifyAIUsage() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('giga:ai-usage'));
}

const WorkspaceContext = React.createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [bootstrap, setBootstrap] = React.useState<BootstrapResponse | null>(null);
  // Prvi pokušaj učitavanja je završen — uspio ili nije. Bez ovoga neuspjeh
  // ostavlja vječit skeleton i agent ne vidi poruku greške.
  const [bootstrapped, setBootstrapped] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<SessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = React.useState(false);
  const [catalog, setCatalog] = React.useState<Record<string, { product: Product; additional: ProductAdditionalData | null }>>({});
  const [manualDiscount, setManualDiscount] = React.useState<number | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [replyBusy, setReplyBusy] = React.useState(false);
  const [messageBusy, setMessageBusy] = React.useState(false);
  const [replyNotes, setReplyNotes] = React.useState<string[]>([]);

  const refreshBootstrap = React.useCallback(async () => {
    try {
      const data = await apiFetch<BootstrapResponse>('/api/bootstrap');
      setBootstrap(data);
      setError(null);
      setActiveSessionId((current) => {
        if (current && data.sessions.some((s) => s.id === current)) return current;
        return data.sessions.find((s) => s.status === 'active')?.id ?? data.sessions[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nije moguće učitati podatke.');
    } finally {
      setBootstrapped(true);
    }
  }, []);

  const loadCatalog = React.useCallback(async (products: SessionContext['products']) => {
    const entries = await Promise.all(
      products.map(async (p) => {
        try {
          const data = await apiFetch<{ product: Product; additional: ProductAdditionalData | null }>(
            `/api/products/${encodeURIComponent(p.productId)}`,
          );
          return [p.productId, data] as const;
        } catch {
          return null;
        }
      }),
    );
    setCatalog((prev) => {
      const next = { ...prev };
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      return next;
    });
  }, []);

  const openSession = React.useCallback(
    async (id: string | null) => {
      setActiveSessionId(id);
      setManualDiscount(null);
      if (!id) {
        setDetail(null);
        return;
      }
      setLoadingSession(true);
      try {
        const data = await apiFetch<SessionDetail>(`/api/sessions/${id}`);
        setDetail(data);
        await loadCatalog(data.session.context.products);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sesija nije učitana.');
        setDetail(null);
      } finally {
        setLoadingSession(false);
      }
    },
    [loadCatalog],
  );

  // Initial bootstrap.
  React.useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  // Load the selected session whenever bootstrap resolves a default.
  React.useEffect(() => {
    if (activeSessionId && (!detail || detail.session.id !== activeSessionId)) {
      void openSession(activeSessionId);
    }
    if (!activeSessionId && detail) setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const createSession = React.useCallback(
    async (label?: string) => {
      const data = await apiFetch<{ session: CustomerSession }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ label }),
      });
      await refreshBootstrap();
      await openSession(data.session.id);
      return data.session;
    },
    [openSession, refreshBootstrap],
  );

  const applySession = React.useCallback((session: CustomerSession) => {
    setDetail((prev) => (prev ? { ...prev, session } : prev));
    setBootstrap((prev) =>
      prev
        ? {
            ...prev,
            sessions: [session, ...prev.sessions.filter((s) => s.id !== session.id)].sort((a, b) =>
              b.updatedAt.localeCompare(a.updatedAt),
            ),
          }
        : prev,
    );
  }, []);

  const renameSession = React.useCallback(
    async (label: string) => {
      if (!activeSessionId) return;
      const data = await apiFetch<{ session: CustomerSession }>(`/api/sessions/${activeSessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      });
      applySession(data.session);
    },
    [activeSessionId, applySession],
  );

  const setSessionStatus = React.useCallback(
    async (status: 'active' | 'archived') => {
      if (!activeSessionId) return;
      const data = await apiFetch<{ session: CustomerSession }>(`/api/sessions/${activeSessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      applySession(data.session);
    },
    [activeSessionId, applySession],
  );

  const deleteSession = React.useCallback(
    async (id: string) => {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (id === activeSessionId) {
        setActiveSessionId(null);
        setDetail(null);
      }
      await refreshBootstrap();
    },
    [activeSessionId, refreshBootstrap],
  );

  const resetWorkspace = React.useCallback(async () => {
    // Svjeza lista sa servera: stanje u memoriji moze biti staro (npr. sesija
    // otvorena u drugoj kartici), pa bi neki razgovori ostali u bazi.
    let ids = (bootstrap?.sessions ?? []).map((session) => session.id);
    try {
      const fresh = await apiFetch<{ sessions: CustomerSession[] }>('/api/bootstrap');
      ids = (fresh.sessions ?? []).map((session) => session.id);
    } catch {
      // Ako bootstrap ne radi, koristimo ono sto imamo.
    }
    for (const id of ids) {
      try {
        await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      } catch {
        // Sesija je već obrisana (npr. u drugoj kartici) — nastavljamo dalje.
      }
    }
    setActiveSessionId(null);
    setDetail(null);
    setReplyNotes([]);
    setManualDiscount(null);
    const data = await apiFetch<{ session: CustomerSession }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ label: 'Novi razgovor' }),
    });
    await refreshBootstrap();
    await openSession(data.session.id);
    return data.session;
  }, [bootstrap, openSession, refreshBootstrap]);

  const sendMessage = React.useCallback(
    async (content: string, senderType: SenderType) => {
      if (!activeSessionId) throw new Error('Nije odabrana sesija.');
      setMessageBusy(true);
      try {
        const data = await apiFetch<{ message: ChatMessage; session: CustomerSession }>(
          `/api/sessions/${activeSessionId}/messages`,
          { method: 'POST', body: JSON.stringify({ content, senderType }) },
        );
        setDetail((prev) =>
          prev
            ? { ...prev, messages: [...prev.messages, data.message], session: data.session }
            : prev,
        );
        setBootstrap((prev) =>
          prev
            ? {
                ...prev,
                sessions: [data.session, ...prev.sessions.filter((s) => s.id !== data.session.id)].sort((a, b) =>
                  b.updatedAt.localeCompare(a.updatedAt),
                ),
              }
            : prev,
        );

        // Give a fresh session a meaningful label from the first customer line.
        const isAutoLabel = data.session.label.startsWith('Razgovor ');
        if (isAutoLabel && senderType === 'customer' && data.session.messageCount === 1) {
          const label = content.replace(/\s+/g, ' ').trim().slice(0, 60);
          if (label) {
            try {
              const renamed = await apiFetch<{ session: CustomerSession }>(`/api/sessions/${activeSessionId}`, {
                method: 'PATCH',
                body: JSON.stringify({ label }),
              });
              applySession(renamed.session);
            } catch {
              /* labelling is cosmetic; ignore */
            }
          }
        }
        return data.message;
      } finally {
        setMessageBusy(false);
      }
    },
    [activeSessionId, applySession],
  );

  const deleteMessage = React.useCallback(
    async (messageId: string) => {
      if (!activeSessionId) throw new Error('Nije odabrana sesija.');
      const data = await apiFetch<{ deletedId: string; session: CustomerSession | null }>(
        `/api/sessions/${activeSessionId}/messages/${messageId}`,
        { method: 'DELETE' },
      );
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== data.deletedId),
              session: data.session ?? prev.session,
            }
          : prev,
      );
      if (data.session) applySession(data.session);
    },
    [activeSessionId, applySession],
  );

  const deleteTurn = React.useCallback(
    async (turnId: string) => {
      if (!activeSessionId) throw new Error('Nije odabrana sesija.');
      await apiFetch(`/api/sessions/${activeSessionId}/turns/${turnId}`, { method: 'DELETE' });
      setDetail((prev) =>
        prev ? { ...prev, turns: prev.turns.filter((t) => t.id !== turnId) } : prev,
      );
    },
    [activeSessionId],
  );

  const editTurn = React.useCallback(
    async (turnId: string, content: string) => {
      if (!activeSessionId) throw new Error('Nije odabrana sesija.');
      const data = await apiFetch<{ turn: import('@/lib/domain/types').AssistantTurn }>(
        `/api/sessions/${activeSessionId}/turns/${turnId}`,
        { method: 'PATCH', body: JSON.stringify({ content }) },
      );
      setDetail((prev) =>
        prev ? { ...prev, turns: prev.turns.map((t) => (t.id === turnId ? data.turn : t)) } : prev,
      );
    },
    [activeSessionId],
  );

  const askAssistant = React.useCallback(
    async (message: string) => {
      if (!activeSessionId) return;
      setAiBusy(true);
      // optimistic user turn
      const optimistic: import('@/lib/domain/types').AssistantTurn = {
        id: `local_${Date.now()}`,
        sessionId: activeSessionId,
        userId: 'local',
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
        citations: [],
        toolCalls: [],
        replyDraft: null,
        error: null,
      };
      setDetail((prev) => (prev ? { ...prev, turns: [...prev.turns, optimistic] } : prev));
      try {
        const data = await apiFetch<{ turns: import('@/lib/domain/types').AssistantTurn[]; session: CustomerSession }>(
          `/api/sessions/${activeSessionId}/assistant`,
          { method: 'POST', body: JSON.stringify({ message }) },
        );
        setDetail((prev) => (prev ? { ...prev, turns: data.turns, session: data.session } : prev));
        notifyAIUsage();
        if (data.session.context.products.length) await loadCatalog(data.session.context.products);
      } catch (err) {
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                turns: [
                  ...prev.turns.filter((t) => t.id !== optimistic.id),
                  { ...optimistic, error: err instanceof Error ? err.message : 'AI zahtjev nije uspio.' },
                ],
              }
            : prev,
        );
        throw err;
      } finally {
        setAiBusy(false);
      }
    },
    [activeSessionId, loadCatalog],
  );

  const generateReply = React.useCallback(
    async (opts?: { tone?: 'concise' | 'balanced' | 'detailed'; instruction?: string }) => {
      if (!activeSessionId) return null;
      setReplyBusy(true);
      try {
        const data = await apiFetch<{ reply: GeneratedReply; warning: string | null; notes?: string[] }>(
          `/api/sessions/${activeSessionId}/reply`,
          { method: 'POST', body: JSON.stringify(opts ?? {}) },
        );
        setDetail((prev) => (prev ? { ...prev, replies: [...prev.replies, data.reply] } : prev));
        setReplyNotes(data.notes ?? []);
        notifyAIUsage();
        return data.reply;
      } finally {
        setReplyBusy(false);
      }
    },
    [activeSessionId],
  );

  const editReply = React.useCallback(
    async (replyId: string, body: string) => {
      const data = await apiFetch<{ reply: GeneratedReply }>(`/api/replies/${replyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      setDetail((prev) =>
        prev ? { ...prev, replies: prev.replies.map((r) => (r.id === replyId ? data.reply : r)) } : prev,
      );
      return data.reply;
    },
    [],
  );

  const classify = React.useCallback(async (text: string) => {
    const data = await apiFetch<{
      classification: { suggestedType: SenderType; confidence: number; rationale?: string };
    }>('/api/classify', { method: 'POST', body: JSON.stringify({ text }) });
    notifyAIUsage();
    return data.classification;
  }, []);

  const setContext = React.useCallback(
    async (next: SessionContext) => {
      if (!activeSessionId) return;
      const data = await apiFetch<{ session: CustomerSession }>(`/api/sessions/${activeSessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ context: next }),
      });
      applySession(data.session);
    },
    [activeSessionId, applySession],
  );

  const addProductToContext = React.useCallback(
    async (product: Product, quantity = 1) => {
      if (!detail) return;
      const next = upsertContextProduct(detail.session.context, contextProductFrom(product, quantity));
      await setContext(next);
      setCatalog((prev) => ({ ...prev, [product.id]: { product, additional: prev[product.id]?.additional ?? null } }));
    },
    [detail, setContext],
  );

  const updateQuantity = React.useCallback(
    async (productId: string, quantity: number | null) => {
      if (!detail) return;
      const products = detail.session.context.products.map((p) =>
        p.productId === productId ? { ...p, quantity } : p,
      );
      // If this was the last item, keep it but with unknown quantity (agent decides).
      await setContext({ ...detail.session.context, products });
    },
    [detail, setContext],
  );

  const removeProduct = React.useCallback(
    async (productId: string) => {
      if (!detail) return;
      await setContext({
        ...detail.session.context,
        products: detail.session.context.products.filter((p) => p.productId !== productId),
      });
    },
    [detail, setContext],
  );

  const refreshProduct = React.useCallback(async (productId: string) => {
    try {
      const data = await apiFetch<{ product: Product; additional: ProductAdditionalData | null }>(
        `/api/products/${encodeURIComponent(productId)}`,
      );
      setCatalog((prev) => ({ ...prev, [productId]: data }));
      if (detail) {
        const products = detail.session.context.products.map((p) =>
          p.productId === productId
            ? { ...p, unitPrice: data.product.price, priceCheckedAt: data.product.scrapedAt }
            : p,
        );
        await setContext({ ...detail.session.context, products });
      }
    } catch {
      /* surfaced by caller if needed */
    }
  }, [detail, setContext]);

  const saveSettings = React.useCallback(async (settings: AppSettings) => {
    const data = await apiFetch<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setBootstrap((prev) => (prev ? { ...prev, settings: data.settings } : prev));
  }, []);

  const saveQuickReply = React.useCallback(
    async (reply: Partial<QuickReply> & { id?: string }) => {
      if (reply.id) {
        await apiFetch(`/api/quick-replies/${reply.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            code: reply.code ?? '',
            label: reply.label,
            category: reply.category,
            message: reply.message,
            sortOrder: reply.sortOrder,
            requiresReview: reply.requiresReview,
          }),
        });
      } else {
        await apiFetch('/api/quick-replies', {
          method: 'POST',
          body: JSON.stringify({
            code: reply.code ?? '',
            label: reply.label,
            category: reply.category,
            message: reply.message,
            sortOrder: reply.sortOrder,
            requiresReview: reply.requiresReview ?? false,
          }),
        });
      }
      const data = await apiFetch<{ quickReplies: QuickReply[] }>('/api/quick-replies');
      setBootstrap((prev) => (prev ? { ...prev, quickReplies: data.quickReplies } : prev));
    },
    [],
  );

  const deleteQuickReply = React.useCallback(async (id: string) => {
    await apiFetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
    const data = await apiFetch<{ quickReplies: QuickReply[] }>('/api/quick-replies');
    setBootstrap((prev) => (prev ? { ...prev, quickReplies: data.quickReplies } : prev));
  }, []);

  const saveProcedure = React.useCallback(async (procedure: Partial<CompanyProcedure>) => {
    await apiFetch('/api/procedures', {
      method: 'PUT',
      body: JSON.stringify({
        id: procedure.id,
        topic: procedure.topic,
        title: procedure.title,
        keywords: procedure.keywords ?? [],
        answer: procedure.answer ?? '',
        verified: procedure.verified ?? false,
      }),
    });
    const data = await apiFetch<{ procedures: CompanyProcedure[] }>('/api/procedures');
    setBootstrap((prev) => (prev ? { ...prev, procedures: data.procedures } : prev));
  }, []);

  const deleteProcedure = React.useCallback(async (id: string) => {
    await apiFetch(`/api/procedures/${id}`, { method: 'DELETE' });
    const data = await apiFetch<{ procedures: CompanyProcedure[] }>('/api/procedures');
    setBootstrap((prev) => (prev ? { ...prev, procedures: data.procedures } : prev));
  }, []);

  const refreshScraper = React.useCallback(async () => {
    const data = await apiFetch<BootstrapResponse['scraper'] & { runs?: unknown }>('/api/scraper/status');
    setBootstrap((prev) => (prev ? { ...prev, scraper: { ...data, totalProducts: data.totalProducts } } : prev));
  }, []);

  // ---- Derived calculator -------------------------------------------------
  const contextProducts = detail?.session.context.products ?? [];
  const calcItems: CalcItemInput[] = contextProducts.map((p) => ({
    productId: p.productId,
    name: p.name,
    sku: p.sku,
    unitPrice: p.unitPrice,
    quantity: p.quantity,
    currentCatalogPrice: catalog[p.productId]?.product.price ?? null,
    priceCheckedAt: catalog[p.productId]?.product.scrapedAt ?? p.priceCheckedAt,
  }));
  const calculation = React.useMemo(() => {
    if (!bootstrap) return null;
    if (!calcItems.length) return null;
    return calculateOrder({
      items: calcItems,
      config: bootstrap.settings.calculator,
      manualDiscountPercent: manualDiscount,
    });
  }, [bootstrap, calcItems, manualDiscount]);

  const value: WorkspaceValue = {
    ready: bootstrapped,
    error,
    bootstrap,
    sessions: bootstrap?.sessions ?? [],
    settings: bootstrap?.settings ?? null,
    procedures: bootstrap?.procedures ?? [],
    quickReplies: bootstrap?.quickReplies ?? [],
    activeSessionId,
    detail,
    loadingSession,
    catalog,
    aiBusy,
    replyBusy,
    messageBusy,
    calculation,
    manualDiscount,
    setManualDiscount,
    refreshBootstrap,
    openSession,
    createSession,
    renameSession,
    setSessionStatus,
    deleteSession,
    resetWorkspace,
    sendMessage,
    deleteMessage,
    deleteTurn,
    editTurn,
    askAssistant,
    generateReply,
    replyNotes,
    editReply,
    classify,
    setContext,
    addProductToContext,
    updateQuantity,
    removeProduct,
    refreshProduct,
    saveSettings,
    saveQuickReply,
    deleteQuickReply,
    saveProcedure,
    deleteProcedure,
    refreshScraper,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace mora biti unutar WorkspaceProvider.');
  return ctx;
}

export { emptySessionContext };
