import type { MessageClassification, SenderType } from './types';

// ---------------------------------------------------------------------------
// Deterministic first-pass message classifier.
// It NEVER decides the stored message type on its own: the UI always shows the
// suggestion and the agent confirms or corrects it before saving.
// ---------------------------------------------------------------------------

interface Signal {
  type: SenderType;
  weight: number;
  label: string;
}

const INSTRUCTION_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b(ai|asistent|asistentu)\b/i, weight: 3, label: 'spominje AI/asistenta' },
  { re: /\b(predloži|predlozi|napiši|napisi|sastavi|preformuliši|preformulisi|odgovori mi|reci mi)\b/i, weight: 2.5, label: 'traži da se nešto sastavi' },
  { re: /\b(uputa|uputstvo|instrukcija|kontekst|napomena za tebe|za tebe)\b/i, weight: 2.5, label: 'eksplicitna uputa' },
  { re: /\b(kupac pita|kupac kaže|kupac kaze|kupac traži|kupac trazi|kupac je rekao)\b/i, weight: 3, label: 'agent prepričava kupca' },
  { re: /\b(ne odgovaraj|ne spominji|pazi|obrati pažnju|obrati paznju)\b/i, weight: 2, label: 'uputa o ponašanju' },
  { re: /\b(provjeri|provjeri u katalogu|izračunaj|izracunaj)\b/i, weight: 1.5, label: 'traži provjeru/izračun' },
];

const AGENT_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b(možemo vam|mozemo vam|rado ćemo|rado cemo|stojimo vam na raspolaganju|zahvaljujemo vam)\b/i, weight: 3, label: 'koristi firmin nastup' },
  { re: /\bs poštovanjem\b|\bs postovanjem\b/i, weight: 3, label: 'sadrži potpis' },
  { re: /\b(poslali smo|šaljemo vam|saljemo vam|obavještavamo vas|obavjestavamo vas|naša dostava|nasa dostava)\b/i, weight: 2.5, label: 'agentov glas' },
  { re: /\b(vaša narudžba|vasa narudzba|vaš paket|vas paket)\b/i, weight: 2, label: 'potvrda narudžbe' },
  { re: /\b(hvala vam na|hvala na povjerenju)\b/i, weight: 1.5, label: 'zahvala kupcu' },
];

const CUSTOMER_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b(imate li|imaju li|da li imate|dali imate)\b/i, weight: 3, label: 'pita o dostupnosti' },
  { re: /\b(koliko košta|koliko kosta|koja je cijena|koja je cijena|cijena)\b/i, weight: 2.5, label: 'pita za cijenu' },
  { re: /\b(zanima me|trebam|treba mi|htio bih|htjela bih|želio bih|zelio bih|kupio bih)\b/i, weight: 2.5, label: 'izražava interes' },
  { re: /\b(garancija|dostava|reklamacija|povrat|plaćanje|placanje)\b/i, weight: 1, label: 'pita o uslovima' },
  { re: /\b(ja sam|moje ime|moja adresa|moj broj|moj telefon|šaljem|saljem)\b/i, weight: 2, label: 'daje lične podatke' },
  { re: /\b(možete li|mozete li|da li možete|da li mozete|kada|zašto|zasto|gdje|gdje se)\b/i, weight: 1.5, label: 'postavlja pitanje' },
  { re: /\b(pozdrav|dobar dan|dobro veče|dobro vece|laku noć|laku noc)\b/i, weight: 1.5, label: 'pozdrav' },
];

function score(patterns: { re: RegExp; weight: number; label: string }[], text: string): { total: number; labels: string[] } {
  let total = 0;
  const labels: string[] = [];
  for (const p of patterns) {
    if (p.re.test(text)) {
      total += p.weight;
      labels.push(p.label);
    }
  }
  return { total, labels };
}

export function classifyMessageHeuristic(text: string): MessageClassification {
  const clean = text.trim();
  if (!clean) return { suggestedType: 'note', confidence: 0.1, rationale: 'Prazna poruka.' };

  if (/^\[[^\]]*\]$/.test(clean) || /^napomena:/i.test(clean)) {
    return { suggestedType: 'note', confidence: 0.7, rationale: 'Izvorno označeno kao bilješka.' };
  }

  const instruction = score(INSTRUCTION_PATTERNS, clean);
  const agent = score(AGENT_PATTERNS, clean);
  const customer = score(CUSTOMER_PATTERNS, clean);

  // Agent copying a customer's words ("Kupac pita ...") is an instruction.
  if (/\bkupac (pita|kaže|kaze|traži|trazi|je rekao)\b/i.test(clean)) {
    return {
      suggestedType: 'instruction',
      confidence: 0.85,
      rationale: 'Agent prepričava kupčevu poruku — to je uputa, ne poruka kupca.',
    };
  }

  const candidates: { type: SenderType; total: number; labels: string[] }[] = [
    { type: 'instruction', total: instruction.total, labels: instruction.labels },
    { type: 'agent', total: agent.total, labels: agent.labels },
    { type: 'customer', total: customer.total, labels: customer.labels },
  ];
  candidates.sort((a, b) => b.total - a.total);

  const best = candidates[0]!;
  const second = candidates[1]!;

  if (best.total === 0) {
    return {
      suggestedType: 'customer',
      confidence: 0.3,
      rationale: 'Nema jasnih signala — provjerite pošiljaoca prije slanja.',
    };
  }

  const margin = best.total - second.total;
  const confidence = Math.max(0.35, Math.min(0.95, 0.45 + margin * 0.12 + Math.min(best.total, 6) * 0.03));

  return {
    suggestedType: best.type,
    confidence: Number(confidence.toFixed(2)),
    rationale: `${best.labels.slice(0, 2).join(', ') || 'signal'} (razlika prema sljedećoj opciji: ${margin.toFixed(1)}).`,
  };
}
