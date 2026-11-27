import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Owner-authored assistant rules live in a plain Markdown file so they can be
 * changed without touching code. The file is re-read when it changes on disk.
 */
export const RULES_RELATIVE_PATH = 'docs/pravila-asistenta.md';

let cache: { path: string; mtimeMs: number; text: string } | null = null;

function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, '');
}

export function loadAssistantRules(): string {
  const path = resolve(process.cwd(), RULES_RELATIVE_PATH);
  try {
    const { mtimeMs } = statSync(path);
    if (!cache || cache.path !== path || cache.mtimeMs !== mtimeMs) {
      cache = { path, mtimeMs, text: stripHtmlComments(readFileSync(path, 'utf8')).trim() };
    }
    return cache.text;
  } catch {
    // Missing file must never break a turn — fall back to core rules only.
    cache = null;
    return '';
  }
}

export interface CompiledRule {
  id: string;
  title: string;
  /** Date written next to the rule heading, e.g. "28.11.2026". */
  date: string | null;
  points: string[];
}

/**
 * Turns the readable Markdown into a terse numbered list. Small models follow
 * short imperative lines far better than a long document with prose.
 */
export function compileRules(markdown: string): CompiledRule[] {
  const rules: CompiledRule[] = [];
  let current: CompiledRule | null = null;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = /^\*\*R(\d+)\s*[—–-]\s*(.+?)\*\*$/.exec(line);
    if (heading) {
      const rawTitle = heading[2]!;
      const date = /\((\d{1,2}\.\d{1,2}\.\d{4})\)\s*$/.exec(rawTitle)?.[1] ?? null;
      const title = rawTitle.replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/, '').trim();
      current = { id: `R${heading[1]}`, title, date, points: [] };
      rules.push(current);
      continue;
    }

    if (current && /^[-•*]\s+/.test(line)) {
      current.points.push(line.replace(/^[-•*]\s+/, '').trim());
    }
  }

  return rules;
}

/** Ready-to-inject prompt block, or an empty string when no rules are set. */
export function assistantRulesBlock(): string {
  const markdown = loadAssistantRules();
  if (!markdown) return '';

  const rules = compileRules(markdown);
  // Dates are owner metadata, not instructions the model needs on every call.
  const body = rules.length
    ? rules.map((rule) => `${rule.id} — ${rule.title}: ${rule.points.join('; ')}`).join('\n')
    : markdown;

  return `PRAVILA VLASNIKA (obavezna, primijeni doslovno — vrijede i za poruke kupcu i za odgovore agentu):
${body}`;
}

/** Short, concrete self-check appended last, where small models pay attention. */
export const REPLY_CHECKLIST = `KONTROLA PRIJE SLANJA (ako ne prolazi, prepiši poruku):
1. Naziv i cijena su iz kataloga; dostupnost riječima iz podataka.
2. Nema izvora, datuma, skladišta, zaliha ni markdowna; potpis se dodaje sam.
3. Množina i „Vi“; nema izmišljene cijene, težine, dimenzije, roka ni dostave.
4. Ciklus prodaje (R22): specifikacije koje imamo -> cijena dostave po težini -> podaci za narudžbu (ime, telefon, adresa, grad, poštanski broj) -> rok 2–5 radnih dana. Nijedan korak se ne preskače.
5. Uz cijenu SVAKOG proizvoda i SVAKE dimenzije napiši i cijenu dostave. Ako težina nije unesena, napiši tačno „dostava: ________ KM” (praznina koju agent dopuni) — nikad ne izmišljaj iznos dostave i NIKAD ne piši kupcu da težina nedostaje ni da se dostava ne može izračunati (R24). Slobodno napiši da se dostava obračunava po težini pošiljke, ali NIKAD ne navodi broj kilograma (R35).
6. Samo proizvodi, dimenzije i boje koje su na stanju smiju se ponuditi; ono što nije na stanju ne predstavljaj kao da imamo (R26).
7. Rečenicu „Akcija traje do isteka zaliha.” piši samo ako kupac pita dokad traje akcija (R25).
8. Popust na količinu važi SAMO za isti proizvod i samo sa podešenim pragovima (2 kom = 5%, 5 kom = 7%, 10 kom = 10%); različiti proizvodi se ne sabiraju, a procente nikad ne izmišljaj (R28).`;

/** Exposed for tests and diagnostics. */
export function rulesFileExists(): boolean {
  try {
    statSync(resolve(process.cwd(), RULES_RELATIVE_PATH));
    return true;
  } catch {
    return false;
  }
}
