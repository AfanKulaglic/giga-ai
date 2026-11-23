import 'server-only';
import { getStore } from '@/lib/store';
import { serverEnv } from '@/lib/config/env';

/**
 * Groq's free plan allows 200.000 tokens per day per organisation, and it is
 * easy to burn that while testing. Every model call is logged as an audit
 * entry so the daily spend is visible in Settings instead of a surprise 429.
 */
const USAGE_ACTION = 'ai.call';

/** Password mode has exactly one agent, so usage is attributed to it. */
const SINGLE_AGENT_ID = 'local-user';

/** Published free-plan limit for the gpt-oss models (Groq Free plan). */
export const FREE_DAILY_TOKEN_LIMIT = 200_000;

/**
 * Per-million-token prices (USD) for the models we actually use. Used only to
 * show a cost estimate; free-plan usage costs nothing.
 */
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
};

/** Daily token budget shown in Settings; override with AI_DAILY_TOKEN_BUDGET. */
function dailyBudget(): number {
  const fromEnv = Number(process.env.AI_DAILY_TOKEN_BUDGET);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.round(fromEnv) : FREE_DAILY_TOKEN_LIMIT;
}

export interface AIUsageSummary {
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  limit: number;
  percent: number;
  provider: string;
  model: string;
  /** Rough USD estimate at the provider's list price (0 when unknown). */
  estimatedCostUsd: number;
  /** Token split per model, so Groq and Gemini spending never get mixed up. */
  byModel: { model: string; calls: number; tokens: number }[];
  /** When the provider's daily counter starts over (UTC midnight). */
  resetAt: string;
  resetInMinutes: number;
}

/** Groq (and most providers) reset daily counters at 00:00 UTC. */
function nextUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
}

export async function recordAIUsage(usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  /** Actual model the provider answered with (may differ from the request). */
  model?: string | null;
}): Promise<void> {
  try {
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    await getStore().logAudit({
      id: crypto.randomUUID(),
      userId: SINGLE_AGENT_ID,
      action: USAGE_ACTION,
      entity: 'ai',
      entityId: usage.model ?? serverEnv.ai.model,
      detail: JSON.stringify({
        promptTokens,
        completionTokens,
        model: usage.model ?? serverEnv.ai.model,
      }),
      at: new Date().toISOString(),
    });
  } catch {
    // Usage logging must never break a reply.
  }
}

export async function getTodayAIUsage(): Promise<AIUsageSummary> {
  const day = new Date().toISOString().slice(0, 10);
  const empty: AIUsageSummary = {
    day,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    limit: dailyBudget(),
    percent: 0,
    provider: serverEnv.ai.provider,
    model: serverEnv.ai.model,
    estimatedCostUsd: 0,
    byModel: [],
    resetAt: nextUtcMidnight().toISOString(),
    resetInMinutes: Math.max(0, Math.round((nextUtcMidnight().getTime() - Date.now()) / 60000)),
  };

  try {
    // A busy day can be 900+ calls (300 messages × 3 model calls), so read deep
    // enough that a full day is never under-counted.
    const entries = await getStore().listAudit(SINGLE_AGENT_ID, 3000);
    let calls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    const perModel = new Map<string, { calls: number; tokens: number }>();
    for (const entry of entries) {
      if (entry.action !== USAGE_ACTION || !entry.at.startsWith(day)) continue;
      calls += 1;
      try {
        const detail = entry.detail ? (JSON.parse(entry.detail) as Record<string, number>) : null;
        promptTokens += detail?.promptTokens ?? 0;
        completionTokens += detail?.completionTokens ?? 0;
        const model = String((detail as Record<string, unknown> | null)?.model ?? 'raniji pozivi (bez modela)');
        const current = perModel.get(model) ?? { calls: 0, tokens: 0 };
        current.calls += 1;
        current.tokens += (detail?.promptTokens ?? 0) + (detail?.completionTokens ?? 0);
        perModel.set(model, current);
      } catch {
        // Older entries may only have a plain detail string.
      }
    }
    const totalTokens = promptTokens + completionTokens;
    const price = PRICES_PER_MILLION[serverEnv.ai.model];
    const estimatedCostUsd = price
      ? (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output
      : 0;
    return {
      ...empty,
      calls,
      promptTokens,
      completionTokens,
      totalTokens,
      percent: Math.min(100, Math.round((totalTokens / empty.limit) * 100)),
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      byModel: [...perModel.entries()]
        .map(([model, value]) => ({ model, calls: value.calls, tokens: value.tokens }))
        .sort((a, b) => b.tokens - a.tokens),
    };
  } catch {
    return empty;
  }
}
