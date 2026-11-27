import 'server-only';
import type { AiCitation, AiToolTrace, AssistantTurn, ChatMessage, ContextProduct } from '@/lib/domain/types';
import { messagesForModel, shouldSummarize, serializeContext } from '@/lib/domain/sessionContext';
import { randomUUID } from 'node:crypto';
import { chatCompletion, type ModelMessage } from './client';
import { buildAssistantSystemPrompt, transcriptBlock } from './prompts';
import { assistantToolDefinitions, executeTool, type ToolContext } from './tools';
import { summarizeSession } from './summarize';
import type { Store } from '@/lib/store/types';
import { ApiError } from '@/lib/api/errors';
import { serverEnv } from '@/lib/config/env';

export interface AssistantRunResult {
  answer: string;
  citations: AiCitation[];
  toolTraces: AiToolTrace[];
  model: string;
  sessionLabel: string;
}

const MAX_TOOL_ROUNDS = serverEnv.ai.maxToolRounds;
/** Free tiers bill tokens per minute; keep tool payloads compact for them. */
// Smaller tool payloads keep the per-message token cost (and Groq bill) down.
// Tool results are re-sent on every following round, so large payloads multiply
// the token bill. Groq gets only what the model needs to answer.
const TOOL_RESULT_CHARS = serverEnv.ai.provider === 'groq' ? 1200 : 12000;

/** Parse a tool-call argument string defensively; the tool validates it again. */
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/**
 * One private assistant turn. Tools are the only way the model can reach data;
 * it never touches the database directly.
 */
export async function runAssistantTurn(args: {
  userId: string;
  sessionId: string;
  store: Store;
  signal?: AbortSignal;
}): Promise<AssistantRunResult> {
  const { userId, sessionId, store } = args;

  const session = await store.getSession(userId, sessionId);
  if (!session) throw new ApiError(404, 'Sesija nije pronađena.', 'session_not_found');

  const [settings, procedures, messages] = await Promise.all([
    store.getSettings(userId),
    store.listProcedures(userId),
    store.listMessages(userId, sessionId),
  ]);

  // Keep long conversations bounded: fold older turns into a stored summary.
  if (shouldSummarize(session.context, messages)) {
    const updated = await summarizeSession({ userId, sessionId, store, session, messages, settings, procedures });
    Object.assign(session, updated);
  }

  const windowMessages = messagesForModel(messages, session.context, serverEnv.ai.contextMessages);
  const productContext = session.context.products.length
    ? `PROIZVODI VEĆ ZABILJEŽENI U SESIJI (provjeri aktuelno stanje alatom prije navođenja cijene/dostupnosti):
${serializeContext(
        { ...session.context, summary: '', confirmedFacts: [], missingInfo: [], outstandingQuestions: [] },
      )}`
    : '';

  const systemPrompt = buildAssistantSystemPrompt({ procedures, settings, session, productContext });
  const transcript = transcriptBlock(windowMessages);

  const toolCtx: ToolContext = { userId, sessionId, session, store, settings, procedures };

  const modelMessages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${transcript}

ZADATAK: odgovori agentu na njegovu posljednju poruku. Ako su potrebni podaci, koristi alate. Ako saznaš provjerene činjenice, ažuriraj kontekst sesije alatom updateSessionContext.`,
    },
  ];

  const traces: AiToolTrace[] = [];
  const citations: AiCitation[] = [];
  const touchedProducts = new Set<string>();
  let model = '';

  /**
   * Products found by tools become part of the session context, so the reply
   * generator can quote the same price/availability instead of guessing.
   */
  const rememberProducts = async () => {
    const known = new Set(session.context.products.map((p) => p.productId));
    const missing = [...touchedProducts].filter((id) => !known.has(id));
    if (!missing.length) return;
    const products = await store.getProductsByIds(missing);
    const added: ContextProduct[] = products.map((product) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unitPrice: product.price,
      currency: product.currency,
      quantity: null,
      priceCheckedAt: product.availability.checkedAt,
      priceSource: 'scraped',
    }));
    const context = { ...session.context, products: [...session.context.products, ...added] };
    const updated = await store.updateSession(userId, sessionId, { context });
    session.context = updated.context;
  };

  // Isti alat sa istim argumentima drugi put ne donosi nov podatak — prekida se
  // da model ne vrti isti krug dok ne potroši sve runde.
  const seenCalls = new Map<string, number>();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // U zadnjoj rundi alati se NE daju: model mora napisati odgovor od podataka
    // koje je vec dobio. Tako kupac nikad ne dobije „limit poziva alata”.
    const toolsAllowed = round < MAX_TOOL_ROUNDS;
    const result = await chatCompletion({
      messages: toolsAllowed
        ? modelMessages
        : [
            ...modelMessages,
            {
              role: 'user' as const,
              content:
                'Sada napiši konačan odgovor kupcu koristeći isključivo podatke koje si već dobio. Ne pozivaj alate. Ako neki podatak nedostaje, reci da ćemo ga provjeriti.',
            },
          ],
      tools: toolsAllowed ? assistantToolDefinitions() : undefined,
      temperature: 0.35,
      maxTokens: 2000,
      signal: args.signal,
    });
    model = result.model;

    if (!result.toolCalls.length) {
      let answer = result.content.trim();
      if (!answer && !toolsAllowed) {
        // Prazan odgovor u zadnjoj rundi: jedan kratki poziv koji traži samo tekst.
        const retry = await chatCompletion({
          messages: [...modelMessages, { role: 'user' as const, content: 'Napiši odgovor sada, kratko i jasno, bez alata.' }],
          temperature: 0.2,
          maxTokens: 800,
          signal: args.signal,
        });
        answer = retry.content.trim();
        model = retry.model;
      }
      if (!answer) throw new ApiError(502, 'AI je vratio prazan odgovor.', 'ai_empty_response');
      return { answer, citations: dedupeCitations(citations), toolTraces: traces, model, sessionLabel: session.label };
    }

    modelMessages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      const callKey = `${call.function.name}:${call.function.arguments}`;
      const times = (seenCalls.get(callKey) ?? 0) + 1;
      seenCalls.set(callKey, times);
      if (times > 1) {
        modelMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ note: 'Isti poziv je već izvršen — koristi već dobijene podatke i napiši odgovor.' }),
        });
        continue;
      }
      const exec = await executeTool(call.function.name, parseArgs(call.function.arguments), toolCtx);
      traces.push(exec.trace);
      citations.push(...exec.citations);
      for (const id of exec.productIds) touchedProducts.add(id);
      modelMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(exec.data).slice(0, TOOL_RESULT_CHARS),
      });
    }

    if (touchedProducts.size) await rememberProducts();
  }

  throw new ApiError(502, 'AI nije vratio konačan odgovor.', 'ai_no_answer');
}

export function buildAssistantTurn(args: {
  userId: string;
  sessionId: string;
  answer: string;
  citations: AiCitation[];
  toolTraces: AiToolTrace[];
}): AssistantTurn {
  return {
    id: randomUUID(),
    sessionId: args.sessionId,
    userId: args.userId,
    role: 'assistant',
    content: args.answer,
    createdAt: new Date().toISOString(),
    citations: args.citations,
    toolCalls: args.toolTraces,
    replyDraft: null,
    error: null,
  };
}

export function buildUserTurn(userId: string, sessionId: string, content: string): AssistantTurn {
  return {
    id: randomUUID(),
    sessionId,
    userId,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    citations: [],
    toolCalls: [],
    replyDraft: null,
    error: null,
  };
}

function dedupeCitations(list: AiCitation[]): AiCitation[] {
  const seen = new Set<string>();
  const out: AiCitation[] = [];
  for (const c of list) {
    const key = `${c.kind}|${c.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 20);
}

export function lastRelevantMessages(messages: ChatMessage[], limit = 8): ChatMessage[] {
  return messages.filter((m) => m.senderType === 'customer' || m.senderType === 'agent').slice(-limit);
}
