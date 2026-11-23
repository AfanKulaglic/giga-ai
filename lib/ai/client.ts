import 'server-only';
import { serverEnv } from '@/lib/config/env';
import { aiSetupHint } from '@/lib/config/providers';
import { ApiError } from '@/lib/api/errors';
import { recordAIUsage } from './usage';
import { cooldownForRateLimit, createKeyRotator, type KeyRotator } from './keyRotator';

// ---------------------------------------------------------------------------
// Minimal OpenAI-compatible chat-completions client. DeepSeek is the default
// provider; the base URL and model are configurable so the provider can be
// swapped without touching application logic.
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface CompletionOptions {
  messages: ModelMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export function isAIAvailable(): boolean {
  return serverEnv.ai.apiKeys.length > 0;
}

/**
 * Keys are listed per provider in .env.local (GEMINI_API_KEY, GEMINI_API_KEY_2 …).
 * The rotator remembers which one hit its quota so the next key takes over
 * automatically — no restart, no manual switching of accounts.
 */
let rotator: KeyRotator | null = null;
let rotatorSignature = '';

function keyRotator(): KeyRotator {
  const signature = `${serverEnv.ai.provider}:${serverEnv.ai.apiKeys.join('|')}`;
  if (!rotator || signature !== rotatorSignature) {
    rotator = createKeyRotator(serverEnv.ai.apiKeys);
    rotatorSignature = signature;
  }
  return rotator;
}

export function aiKeyCount(): number {
  return serverEnv.ai.apiKeys.length;
}

/** Masked key list + availability, for the navbar indicator. */
export function aiKeyStatus(): {
  index: number;
  label: string;
  usableInMs: number;
  preferred: boolean;
  disabled: boolean;
  disabledReason: string | null;
}[] {
  const keys = keyRotator();
  return keys.status().map((entry) => {
    const key = serverEnv.ai.apiKeys[entry.index] ?? '';
    return {
      index: entry.index,
      label: key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key,
      usableInMs: entry.usableInMs,
      preferred: keys.preferred === entry.index,
      disabled: entry.disabled,
      disabledReason: entry.disabledReason,
    };
  });
}

/** Koliko ključeva stvarno može odgovoriti (trajno odbijeni se ne broje). */
export function aiUsableKeyCount(): number {
  return keyRotator().usableCount;
}

/** Lets the agent force a specific key (e.g. to test the second account). */
export function selectAIKey(index: number): { ok: boolean; message: string } {
  const keys = keyRotator();
  if (!Number.isInteger(index) || index < 0 || index >= keys.size) {
    return { ok: false, message: `Ključ ${index + 1} ne postoji.` };
  }
  if (keys.isDisabled(index)) {
    return { ok: false, message: `Ključ ${index + 1} je trajno isključen (nema pravo na besplatni paket).` };
  }
  const wait = keys.waitFor(index);
  if (wait > 0) {
    const minutes = Math.max(1, Math.ceil(wait / 60000));
    return { ok: false, message: `Ključ ${index + 1} je potrošen — slobodan je za ~${minutes} min.` };
  }
  keys.setPreferred(index);
  return { ok: true, message: `Od sada ide ključ ${index + 1}.` };
}

export function aiModelName(): string {
  return serverEnv.ai.model;
}

function providerError(status: number, body: string, retryAfterSeconds?: number | null): ApiError {
  const ai = serverEnv.ai;
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      `${ai.label} je odbio kredencijale. ${aiSetupHint(ai)}`,
      'ai_auth_error',
    );
  }
  if (status === 429) {
    const wait = retryAfterSeconds ? ` Sačekajte ~${Math.ceil(retryAfterSeconds)} s` : ' Sačekajte minut';
    const limit = ai.freeTier ? ` ${ai.freeTier}` : '';
    return new ApiError(
      503,
      `${ai.label} je dostigao limit zahtjeva.${wait} pa pokušajte ponovo.${limit}`,
      'ai_rate_limited',
    );
  }
  if (status >= 500) {
    return new ApiError(
      502,
      `${ai.label} je vratio grešku na serveru. Pokušajte ponovo.`,
      'ai_provider_error',
    );
  }
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message ?? '';
  } catch {
    detail = body.slice(0, 200);
  }
  return new ApiError(
    502,
    `${ai.label} zahtjev nije uspio (${status})${detail ? `: ${detail}` : '.'}`,
    'ai_provider_error',
  );
}

/**
 * Groq's gpt-oss models sometimes emit a tool call even when the request offers
 * no tools ("Tool choice is none, but model called a tool"). These tasks want
 * plain text, so we state explicitly that no tools exist.
 */
function noToolsGuard(messages: ModelMessage[]): ModelMessage[] {
  if (serverEnv.ai.provider !== 'groq') return messages;
  return [
    ...messages,
    {
      role: 'system',
      content: 'U ovom zadatku nemaš pristup alatima ni funkcijama. Ne pozivaj alate; vrati isključivo traženi tekst.',
    },
  ];
}

/** Providers differ slightly: only ask for JSON mode where it is supported. */
function messagesForJson(messages: ModelMessage[]): ModelMessage[] {
  const mentionsJson = messages.some((m) => (m.content ?? '').toLowerCase().includes('json'));
  if (mentionsJson) return messages;
  return [
    { role: 'system', content: 'Odgovori isključivo jednim JSON objektom, bez dodatnog teksta i bez markdown ograda.' },
    ...messages,
  ];
}

export async function chatCompletion(options: CompletionOptions): Promise<CompletionResult> {
  if (!serverEnv.ai.apiKey) {
    throw new ApiError(
      503,
      `AI nije konfiguriran (${serverEnv.ai.label}). ${aiSetupHint(serverEnv.ai)}`,
      'ai_not_configured',
    );
  }

  const url = `${serverEnv.ai.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: serverEnv.ai.model,
    messages: options.json
      ? messagesForJson(options.messages)
      : options.tools?.length
        ? options.messages
        : noToolsGuard(options.messages),
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2000,
    stream: false,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }
  // gpt-oss on Groq is a reasoning model: without a low effort the thinking
  // tokens eat the whole free-tier budget before an answer is produced.
  if (serverEnv.ai.reasoningEffort) body.reasoning_effort = serverEnv.ai.reasoningEffort;
  // Ollama's OpenAI bridge does not forward response_format reliably; the prompt
  // already demands JSON and chatJson strips code fences.
  if (options.json && serverEnv.ai.provider !== 'ollama') body.response_format = { type: 'json_object' };

  const keys = keyRotator();
  // Every key may burn one attempt on a quota error before the next takes over.
  const attempts = Math.max(3, keys.size * 2 + 1);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const active = keys.pick();
    if (!active.key) {
      if (keys.usableCount === 0) {
        // Nema više nijednog upotrebljivog ključa — to je postavka, ne privremeni limit.
        throw new ApiError(
          503,
          `${serverEnv.ai.label}: nijedan AI ključ nije upotrebljiv. Provjerite ključeve u Postavkama ili dodajte novi u .env.local.`,
          'ai_no_usable_key',
        );
      }
      const minutes = Math.max(1, Math.ceil(active.retryInMs / 60000));
      throw new ApiError(
        503,
        `${serverEnv.ai.label}: svi ključevi su dostigli limit. Sljedeći se oslobađa za ~${minutes} min.${serverEnv.ai.freeTier ? ` ${serverEnv.ai.freeTier}` : ''}`,
        'ai_rate_limited',
      );
    }
    if (keys.size > 1) {
      console.info(`[ai:${serverEnv.ai.provider}] key ${active.index + 1}/${keys.size}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), serverEnv.ai.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    let waitMs = 0;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${active.key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryAfterRaw = res.headers.get('retry-after');
        const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : null;
        const toolUseFailed = res.status === 400 && /tool_use_failed|Tool choice is none/i.test(text);
        // Kvota ili mrtav ključ: parkiraj ga i odmah probaj sljedeći račun.
        const keyProblem = res.status === 429 || res.status === 401 || res.status === 403;
        // 403 „free tier is not available for this project” i neispravan ključ se
        // ne popravljaju čekanjem — takav ključ se isključuje trajno.
        const permanentlyDead =
          res.status === 403 ||
          (res.status === 401 && /API_KEY_INVALID|API key not valid/i.test(text)) ||
          (res.status === 400 && /API key not valid/i.test(text));
        if (permanentlyDead) {
          const reason = /free tier is not available/i.test(text)
            ? 'projekat nema pravo na besplatni paket (treba novi Google projekat ili naplata)'
            : 'ključ je odbijen (neispravan ili opozvan)';
          keys.disable(active.index, reason);
          console.warn(`[ai:${serverEnv.ai.provider}] key ${active.index + 1} trajno isključen: ${reason}`);
          if (keys.usableCount > 0 && attempt < attempts - 1) continue;
        }
        if (keyProblem && keys.usableCount > 1 && attempt < attempts - 1) {
          keys.coolDown(
            active.index,
            res.status === 429
              ? cooldownForRateLimit(text, Number.isFinite(retryAfter) ? retryAfter : null)
              : 10 * 60_000,
          );
          console.warn(`[ai:${serverEnv.ai.provider}] key ${active.index + 1} parked; switching key`);
          continue;
        }
        const err = toolUseFailed && attempt === 0
          ? new ApiError(502, 'Model je pokušao pozvati alat koji nije dostupan. Pokušavam ponovo bez alata.', 'ai_tool_use_failed')
          : providerError(res.status, text, Number.isFinite(retryAfter) ? retryAfter : null);
        const retryable = res.status === 429 || res.status >= 500 || toolUseFailed;
        if (retryable && attempt < attempts - 1) {
          lastError = err;
          if (toolUseFailed) {
            const previous = body.messages as ModelMessage[];
            body.messages = [
              ...previous,
              { role: 'system', content: 'Prethodni pokušaj je odbijen jer si pozvao alat. Nemaš pristup alatima — vrati samo tekst.' },
            ];
          }
          // Honour Retry-After, but never keep a web request waiting too long.
          const suggested = Number.isFinite(retryAfter) && retryAfter ? retryAfter * 1000 : 0;
          waitMs = Math.min(20000, suggested || (attempt + 1) * 1500);
          continue;
        }
        throw err;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
        model?: string;
        usage?: CompletionResult['usage'];
      };
      const message = data.choices?.[0]?.message;
      if (!message) throw new ApiError(502, 'AI je vratio prazan odgovor.', 'ai_empty_response');
      if (data.usage) {
        console.info(
          `[ai:${serverEnv.ai.provider}] prompt=${data.usage.prompt_tokens ?? '?'} completion=${data.usage.completion_tokens ?? '?'}`,
        );
        // Fire-and-forget: the daily token budget must stay visible in Settings.
        void recordAIUsage({ ...data.usage, model: data.model ?? serverEnv.ai.model });
      }
      return {
        content: message.content ?? '',
        toolCalls: message.tool_calls ?? [],
        model: data.model ?? serverEnv.ai.model,
        usage: data.usage,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = err;
      const aborted = (err as Error)?.name === 'AbortError';
      if (aborted) {
        throw new ApiError(504, 'AI zahtjev je istekao. Pokušajte ponovo.', 'ai_timeout');
      }
      if (attempt < attempts - 1) {
        waitMs = (attempt + 1) * 800;
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  throw new ApiError(
    502,
    `Nije moguće dohvatiti AI odgovor: ${lastError instanceof Error ? lastError.message : 'nepoznata greška'}`,
    'ai_unreachable',
  );
}

/** Ask the model for a JSON object and validate shape by the caller. */
export async function chatJson<T = unknown>(
  options: Omit<CompletionOptions, 'json'>,
): Promise<{ data: T; raw: string; model: string }> {
  const result = await chatCompletion({ ...options, json: true, temperature: 0.1 });
  const raw = result.content.trim();
  const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
  try {
    return { data: JSON.parse(candidate) as T, raw, model: result.model };
  } catch {
    throw new ApiError(502, 'AI je vratio neispravan JSON. Pokušajte ponovo.', 'ai_invalid_json');
  }
}
