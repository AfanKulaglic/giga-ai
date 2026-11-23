import 'server-only';
import { z } from 'zod';
import { chatJson, isAIAvailable } from './client';
import { classifyMessageHeuristic } from '@/lib/domain/messageClassifier';
import { SENDER_TYPES, type MessageClassification } from '@/lib/domain/types';
import { CORE_RULES } from './prompts';

const ClassificationSchema = z.object({
  suggestedType: z.enum(['customer', 'agent', 'note', 'instruction']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300).optional(),
});

/**
 * Classify a pasted message. Returns a *suggestion* only — the agent always
 * confirms the final sender type in the UI.
 */
export async function classifyMessage(
  text: string,
  contextHint?: string,
): Promise<{ classification: MessageClassification; source: 'ai' | 'heuristic' }> {
  const clean = text.trim();
  if (!clean) return { classification: classifyMessageHeuristic(clean), source: 'heuristic' };

  if (!isAIAvailable()) {
    return { classification: classifyMessageHeuristic(clean), source: 'heuristic' };
  }

  if (!SENDER_TYPES.includes(classifyMessageHeuristic(clean).suggestedType)) {
    return { classification: classifyMessageHeuristic(clean), source: 'heuristic' };
  }

  try {
    const { data } = await chatJson({
      messages: [
        {
          role: 'system',
          content: `${CORE_RULES}

ZADATAK: klasifikuj jednu poruku u razgovoru prodajnog agenta GIGA.ba.
Tipovi:
- "customer": poruka kupca (pitanje, zahtjev, lični podaci).
- "agent": poruka koju je agent poslao kupcu (firmin nastup, potvrda, potpis).
- "note": interna bilješka agenta koja se ne šalje kupcu.
- "instruction": uputa ili kontekst koji agent daje AI asistentu (npr. "Kupac pita ima li frižider No Frost").
Ne pretpostavljaj da je sve poruka kupca. Ako je agent prepričao kupca, to je "instruction".
Vrati JSON: {"suggestedType":"customer|agent|note|instruction","confidence":0..1,"rationale":"kratko"}`,
        },
        {
          role: 'user',
          content: `${contextHint ? `Kontekst: ${contextHint}
` : ''}Poruka:
"""${clean.slice(0, 2000)}"""`,
        },
      ],
      maxTokens: 200,
    });
    const parsed = ClassificationSchema.parse(data);
    return {
      classification: {
        suggestedType: parsed.suggestedType,
        confidence: parsed.confidence,
        rationale: parsed.rationale ?? 'AI klasifikacija.',
      },
      source: 'ai',
    };
  } catch {
    return { classification: classifyMessageHeuristic(clean), source: 'heuristic' };
  }
}
