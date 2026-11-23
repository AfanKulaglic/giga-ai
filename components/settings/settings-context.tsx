'use client';

import * as React from 'react';
import { apiFetch } from '@/lib/client/api';
import type { BootstrapResponse } from '@/lib/client/types';
import type {
  AppSettings,
  CompanyProcedure,
  QuickReply,
  ScraperRun,
  ScraperState,
} from '@/lib/domain/types';

interface SettingsContextValue {
  loading: boolean;
  error: string | null;
  settings: AppSettings | null;
  quickReplies: QuickReply[];
  procedures: CompanyProcedure[];
  scraper: BootstrapResponse['scraper'] | null;
  config: BootstrapResponse['config'] | null;
  dirty: boolean;
  saving: boolean;
  refresh: () => Promise<void>;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  save: () => Promise<void>;
  saveQuickReply: (reply: Partial<QuickReply> & { id?: string }) => Promise<void>;
  deleteQuickReply: (id: string) => Promise<void>;
  saveProcedure: (procedure: Partial<CompanyProcedure> & { id?: string }) => Promise<void>;
  deleteProcedure: (id: string) => Promise<void>;
  runScrape: (mode: 'test' | 'sync' | 'full') => Promise<{ run?: ScraperRun; message?: string }>;
  refreshScraper: () => Promise<void>;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [bootstrap, setBootstrap] = React.useState<BootstrapResponse | null>(null);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const data = await apiFetch<BootstrapResponse>('/api/bootstrap');
      setBootstrap(data);
      setSettings(data.settings);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettings = React.useCallback((updater: (prev: AppSettings) => AppSettings) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setDirty(true);
      return next;
    });
  }, []);

  const save = React.useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const data = await apiFetch<{ settings: AppSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(data.settings);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const saveQuickReply = React.useCallback(async (reply: Partial<QuickReply> & { id?: string }) => {
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
        body: JSON.stringify(reply),
      });
    }
    const data = await apiFetch<{ quickReplies: QuickReply[] }>('/api/quick-replies');
    setBootstrap((prev) => (prev ? { ...prev, quickReplies: data.quickReplies } : prev));
  }, []);

  const deleteQuickReply = React.useCallback(async (id: string) => {
    await apiFetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
    const data = await apiFetch<{ quickReplies: QuickReply[] }>('/api/quick-replies');
    setBootstrap((prev) => (prev ? { ...prev, quickReplies: data.quickReplies } : prev));
  }, []);

  const saveProcedure = React.useCallback(async (procedure: Partial<CompanyProcedure> & { id?: string }) => {
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
    const data = await apiFetch<ScraperState & { totalProducts: number; runs: ScraperRun[] }>('/api/scraper/status');
    setBootstrap((prev) =>
      prev
        ? {
            ...prev,
            scraper: { ...prev.scraper, ...data, totalProducts: data.totalProducts },
            productCount: data.totalProducts,
          }
        : prev,
    );
  }, []);

  const runScrape = React.useCallback(
    async (mode: 'test' | 'sync' | 'full') => {
      const data = await apiFetch<{ run?: ScraperRun; message?: string; status?: unknown }>('/api/scraper/run', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      await refreshScraper();
      await refresh();
      return { run: data.run, message: data.message };
    },
    [refresh, refreshScraper],
  );

  const value: SettingsContextValue = {
    loading: !bootstrap,
    error,
    settings,
    quickReplies: bootstrap?.quickReplies ?? [],
    procedures: bootstrap?.procedures ?? [],
    scraper: bootstrap?.scraper ?? null,
    config: bootstrap?.config ?? null,
    dirty,
    saving,
    refresh,
    updateSettings,
    save,
    saveQuickReply,
    deleteQuickReply,
    saveProcedure,
    deleteProcedure,
    runScrape,
    refreshScraper,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings mora biti unutar SettingsProvider.');
  return ctx;
}
