/**
 * Bosnian sentences start with a capital letter. Models occasionally break that
 * rule ("… 650 KM. stojimo Vam …"), so the published reply is normalised here —
 * deterministically, without touching product names or prices.
 */
export function capitalizeSentences(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-zšđčćž])/g, (_m, before: string, ch: string) => `${before}${ch.toUpperCase()}`);
}

/**
 * Normalises model output into a message that can be pasted into Instagram or
 * Facebook: no code fences, no markdown emphasis, correct sentence case.
 */
export function sanitizeReplyText(text: string): string {
  let out = text.trim();
  out = out.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  out = out.replace(/^(poruka kupcu|odgovor|reply)\s*:\s*/i, '');
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith('„') && out.endsWith('”'))) {
    out = out.slice(1, -1).trim();
  }
  out = out.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  out = capitalizeSentences(out);
  return out.replace(/\n{3,}/g, '\n').trim();
}

/**
 * The assistant may append a ready-to-send customer message after a marker
 * (see PRIVATE_ANSWER_RULES). Splitting it lets the UI show "for the agent"
 * and "for the customer" as two clearly different blocks.
 *
 * Tolerates casing and typos such as "---PORUKA KUPCU--" from smaller models.
 */
const CUSTOMER_MARKER = /^[-\s]*poruka\s+kupc[uo]m?[\s-]*$/im;
const CUSTOMER_HEADING = /^\s*(?:\*\*|__)?[^\n]{0,60}(?:kupcu|kupca|klijentu)[^\n]{0,40}:?\s*(?:\*\*|__)?\s*$/im;
const SOURCE_LINE = /^\s*\*{0,2}izvor\b/i;

export function splitAssistantTurn(content: string): { internal: string; customer: string } {
  const match = CUSTOMER_MARKER.exec(content);
  let internal = content;
  let customer = '';

  if (match && match.index !== undefined) {
    internal = content.slice(0, match.index);
    customer = content.slice(match.index + match[0].length);
  } else if (/^\s*(poštovani|postovani|dobar dan)/i.test(content.trim())) {
    internal = '';
    customer = content;
  }

  customer = customer
    .trim()
    .replace(CUSTOMER_HEADING, '')
    .replace(/^\s*[:\-–—]+\s*/, '')
    // A customer never needs the internal source line.
    .split('\n')
    .filter((line) => !SOURCE_LINE.test(line))
    .join('\n')
    .trim();

  return { internal: internal.trim(), customer };
}
