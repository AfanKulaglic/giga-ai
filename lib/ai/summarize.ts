import 'server-only';
import { chatJson } from './client';
import type { CompanyProcedure, CustomerSession } from '@/lib/domain/types';
import type { Store } from '@/lib/store/types';
import { messagesForModel } from '@/lib/domain/sessionContext';
import { CORE_RULES } from './prompts';

interface SummaryPayload {
  summary?: string;
}

/**
 * Compress older conversation into the stored summary. Uses the model when
 * available; otherwise a deterministic extractive fallback keeps the app
 * usable without an API key.
 */
export async function summarizeSession(args: {
  userId: string;
  sessionId: string;
  store: Store;
  session: CustomerSession;
  messages: import('@/lib/domain/types').ChatMessage[];
  settings: import('@/lib/domain/types').AppSettings;
  procedures: CompanyProcedure[];
}): Promise<CustomerSession> {
  const { store, session, messages } = args;
  const relevant = messages.filter((m) => m.senderType === 'customer' || m.senderType === 'agent');
  const toFold = relevant.slice(0, Math.max(0, relevant.length - 10));
  if (!toFold.length) return session;

  const lines = toFold.map((m) => `${m.senderType === 'customer' ? 'Kupac' : 'Agent'}: ${m.content}`);
  let summary = '';

  try {
    const { data } = await chatJson<SummaryPayload>({
      messages: [
        { role: 'system', content: `${CORE_RULES}

Sažmi razgovor za agenta. Zadrži: šta kupac želi, proizvode i količine, potvrđene podatke, otvorena pitanja i status narudžbe. Ne izmišljaj. Vrati JSON oblika {"summary": "..."} na bosanskom, do 900 znakova.` },
        { role: 'user', content: lines.join('\n').slice(0, 12000) },
      ],
      maxTokens: 700,
    });
    if (data.summary && data.summary.trim()) summary = data.summary.trim().slice(0, 1600);
  } catch {
    summary = '';
  }

  if (!summary) {
    // Deterministic fallback: keep the most recent compact facts.
    const tail = toFold.slice(-12).map((m) => `${m.senderType === 'customer' ? 'K' : 'A'}: ${m.content.slice(0, 160)}`);
    summary = `Prethodni tok (automatski sažetak bez AI):
${tail.join('\n')}`;
  }

  const lastFolded = toFold[toFold.length - 1];
  const updatedContext = {
    ...session.context,
    summary,
    summarizedUpToMessageId: lastFolded?.id ?? session.context.summarizedUpToMessageId,
    messageCountAtLastSummary: relevant.length,
    lastSummarizedAt: new Date().toISOString(),
  };
  return store.updateSession(args.userId, args.sessionId, { context: updatedContext });
}

export function contextWindowMessages(session: CustomerSession, messages: import('@/lib/domain/types').ChatMessage[]) {
  return messagesForModel(messages, session.context);
}
