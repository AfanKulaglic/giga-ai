// ---------------------------------------------------------------------------
// AI provider presets. Kept dependency-free so both the server config and the
// settings UI can use it. Every value here is public (no keys).
// ---------------------------------------------------------------------------

export type AIProviderId = 'groq' | 'deepseek' | 'gemini' | 'openrouter' | 'ollama' | 'openai' | 'custom';

export interface AIProviderPreset {
  id: AIProviderId;
  label: string;
  /** OpenAI-compatible base URL (without /chat/completions). */
  baseUrl: string;
  /** Default model id; AI_MODEL always wins. */
  model: string;
  /** Env variable that holds the API key (null = no key needed). */
  keyEnv: string | null;
  /** Short, factual note about the free plan. */
  freeTier: string | null;
  docsUrl: string;
}

export const AI_PROVIDERS: Record<AIProviderId, AIProviderPreset> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keyEnv: 'GROQ_API_KEY',
    freeTier: 'Besplatan nivo: 30 zahtjeva/min, 1.000/dan, ali samo 200.000 tokena/dan (to je oko 40–50 odgovora).',
    docsUrl: 'https://console.groq.com/docs/rate-limits',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
    freeTier: null,
    docsUrl: 'https://api-docs.deepseek.com',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    keyEnv: 'GEMINI_API_KEY',
    freeTier:
      'Besplatan nivo: Flash-Lite 10 zahtjeva/min, 250k ulaznih tokena/min i 500 zahtjeva/dan; Flash modeli samo ~20/dan. Provjeri brojke u AI Studio za svoj projekat.',
    docsUrl: 'https://aistudio.google.com/docs/openai',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    keyEnv: 'OPENROUTER_API_KEY',
    freeTier: 'Modeli sa sufiksom „:free“ imaju dnevni limit i red čekanja.',
    docsUrl: 'https://openrouter.ai/docs',
  },
  ollama: {
    id: 'ollama',
    label: 'Lokalni Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    keyEnv: null,
    freeTier: 'Bez ključa i bez interneta; brzina zavisi od računara.',
    docsUrl: 'https://docs.ollama.com/openai',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    keyEnv: 'OPENAI_API_KEY',
    freeTier: null,
    docsUrl: 'https://platform.openai.com/docs',
  },
  custom: {
    id: 'custom',
    label: 'Prilagođeni endpoint',
    baseUrl: '',
    model: '',
    keyEnv: 'AI_API_KEY',
    freeTier: null,
    docsUrl: '',
  },
};

export function isAIProviderId(value: string | undefined | null): value is AIProviderId {
  return Boolean(value && value in AI_PROVIDERS);
}

export interface AIEnvLike {
  [key: string]: string | undefined;
}

export interface ResolvedAI {
  provider: AIProviderId;
  label: string;
  apiKey: string | null;
  /** All configured keys for this provider, in priority order. */
  apiKeys: string[];
  baseUrl: string;
  model: string;
  keyEnv: string | null;
  freeTier: string | null;
  docsUrl: string;
  timeoutMs: number;
  maxToolRounds: number;
  contextMessages: number;
  /** Only sent to providers that understand it (Groq gpt-oss). */
  reasoningEffort: 'low' | 'medium' | 'high' | null;
}

function nonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim();
}

/** Infer the provider from whichever key is present, so a single env var works. */
function inferProvider(env: AIEnvLike): AIProviderId {
  if (nonEmpty(env.GROQ_API_KEY)) return 'groq';
  if (nonEmpty(env.GEMINI_API_KEY)) return 'gemini';
  if (nonEmpty(env.OPENROUTER_API_KEY)) return 'openrouter';
  if (nonEmpty(env.OPENAI_API_KEY)) return 'openai';
  if (nonEmpty(env.OLLAMA_HOST)) return 'ollama';
  return 'deepseek';
}

export function resolveAI(env: AIEnvLike): ResolvedAI {
  const requested = nonEmpty(env.AI_PROVIDER)?.toLowerCase();
  const provider: AIProviderId = isAIProviderId(requested) ? requested : inferProvider(env);
  const preset = AI_PROVIDERS[provider];

  const apiKey =
    (preset.keyEnv ? nonEmpty(env[preset.keyEnv]) : null) ??
    nonEmpty(env.AI_API_KEY) ??
    (provider === 'ollama' ? 'ollama' : null);

  // One provider, several accounts: AI_API_KEYS=a,b,c wins, otherwise the
  // provider's own key plus GEMINI_API_KEY_2 … _5 are collected in order.
  const keyNames = [
    ...(preset.keyEnv ? [preset.keyEnv] : []),
    ...(preset.keyEnv ? [2, 3, 4, 5].map((n) => `${preset.keyEnv}_${n}`) : []),
    'AI_API_KEY',
  ];
  const apiKeys = (
    nonEmpty(env.AI_API_KEYS)
      ? nonEmpty(env.AI_API_KEYS)!.split(',')
      : keyNames.map((name) => nonEmpty(env[name]) ?? '')
  )
    .map((key) => key.trim())
    .filter((key, index, all) => key.length > 0 && all.indexOf(key) === index);

  const baseUrl =
    nonEmpty(env.AI_BASE_URL) ??
    (provider === 'deepseek' ? nonEmpty(env.DEEPSEEK_BASE_URL) : undefined) ??
    preset.baseUrl;

  const model =
    nonEmpty(env.AI_MODEL) ??
    (provider === 'deepseek' ? nonEmpty(env.DEEPSEEK_MODEL) : undefined) ??
    preset.model;

  const clamp = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };

  const reasoningRaw = nonEmpty(env.AI_REASONING_EFFORT)?.toLowerCase();
  const reasoningEffort =
    reasoningRaw === 'low' || reasoningRaw === 'medium' || reasoningRaw === 'high'
      ? reasoningRaw
      : provider === 'groq'
        ? 'low'
        : null;

  return {
    provider,
    label: preset.label,
    apiKey,
    apiKeys: apiKeys.length ? apiKeys : provider === 'ollama' ? ['ollama'] : [],
    baseUrl: baseUrl.replace(/\/$/, ''),
    model,
    keyEnv: preset.keyEnv,
    freeTier: preset.freeTier,
    docsUrl: preset.docsUrl,
    timeoutMs: clamp(env.AI_TIMEOUT_MS, 60000, 5000, 180000),
    // Every tool round re-sends the whole prompt, so the free/cheap Groq plan gets
    // two rounds by default instead of three.
    maxToolRounds: clamp(env.AI_MAX_TOOL_ROUNDS, provider === 'groq' ? 2 : 4, 1, 6),
    contextMessages: clamp(env.AI_CONTEXT_MESSAGES, provider === 'groq' ? 10 : 14, 4, 40),
    reasoningEffort,
  };
}

/** Human sentence used in errors and the settings UI. */
export function aiSetupHint(ai: Pick<ResolvedAI, 'label' | 'keyEnv' | 'provider'>): string {
  if (ai.provider === 'ollama') return 'Pokrenite Ollama lokalno (ollama serve) ili promijenite AI_PROVIDER.';
  return ai.keyEnv
    ? `Dodajte ${ai.keyEnv} u .env.local i restartujte aplikaciju.`
    : 'Provjerite AI_BASE_URL i AI_MODEL.';
}
