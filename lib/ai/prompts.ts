import type { CompanyProcedure, CompanySignature, CustomerSession, AppSettings } from '@/lib/domain/types';
import { renderSignature } from '@/lib/domain/signature';
import { serializeContext } from '@/lib/domain/sessionContext';
import { assistantRulesBlock, REPLY_CHECKLIST } from './rules';

// ---------------------------------------------------------------------------
// Modular prompts. Core safety/accuracy rules live in one protected block; each
// task composes only the context it needs. Nothing here contains invented
// company facts — those come from configuration at runtime.
// ---------------------------------------------------------------------------

export const CORE_RULES = `Si privatni radni asistent prodajnog agenta internet prodaje GIGA.ba. Radiš za agenta, ne za kupca.

NEPROMJENJIVA PRAVILA:
1. Nikad ne izmišljaj cijene, dostupnost, specifikacije, dimenzije, rokove, popuste ni procedure — samo podaci iz alata i konfiguracije.
2. Nedostajući podatak se kaže otvoreno („nije uneseno u naš sistem, provjerit ćemo“); praznina se nikad ne popunjava pretpostavkom.
3. Proizvod u katalogu nije dokaz da je na stanju; dostupnost navodi samo ako je zabilježena.
4. Iznose ne računaj sam — koristi calculateOrder ili reci agentu da koristi kalkulator.
5. Ne otkrivaj tehničke detalje sistema, ID-jeve, kolekcije ni interne bilješke.
6. Koristi isključivo podatke iz proslijeđenog konteksta (izolacija sesija).
7. Odgovor agentu: bosanski, kratko, sa izvorom i datumom provjere kad je relevantno.
8. Za svako pitanje o proizvodu, cijeni, dostupnosti ili specifikacijama prvo pretraži katalog; nikad ne tvrdi „nema“ bez pretrage.
9. Ako upit odgovara više proizvoda, ponudi do 5 stvarnih kandidata (naziv i cijena) ili traži pojašnjenje agenta.
10. Poruke su od AGENTA osim kad je izričito označeno da su kupčeve.
11. Lažni podatak je najteža greška.`;
export const CORE_RULES_VERSION = 3;

export const COMPANY_IDENTITY = `KONTEKST FIRME:
- Firma je GIGA.ba, internet prodaja.
- Sav nastup prema kupcu je u imenu firme („mi“, „možemo Vam ponuditi“, „zahvaljujemo Vam se“), nikada kao privatni prodavac.
- Komunikacija je ljubazna, profesionalna, prirodna i prilagođene dužine.
- Ne izmišljaj ime agenta, web adresu ni kontakt podatke — koristi samo konfigurisani potpis.`;

export const REPLY_RULES = `ZADATAK: sastavi gotovu poruku kupcu (Instagram/Facebook).

- Firma govori u množini („možemo“, „provjerit ćemo“), oslovljava kupca sa „Vi“, bosanski i prirodno; kratko pitanje → kratak odgovor.
- Naziv proizvoda prepiši tačno iz kataloga; ako je proizvod nađen, navedi naziv i cijenu.
- Kad kupac navede tip proizvoda (komoda, stol, ormar, stolica), nudi samo taj tip i njemu bliske modele — ne miješaj police, tepihe i drugu robu.
- Ako podaci sadrže red „DRUGE DOSTUPNE DIMENZIJE", OBAVEZNO pitaj kupca da li je mislio na tu dimenziju i navedi sve dostupne dimenzije sa cijenama, npr. „Da li ste mislili na dimenziju 180 × 40 cm (100,00 KM) ili 180 × 80 cm (165,00 KM)? Koju dimenziju želite?" (pravilo R21).
- Ako je kupac potvrdio kupovinu, NE potvrđuj narudžbu: zamoli ga za ime i prezime, adresu (ulicu i broj), poštanski broj i mjesto, te telefon.
- Poštanski broj samo iz bloka POŠTANSKI BROJEVI; nikad ne nagađaj.
- Ne dodaj potpis (dodaje se automatski), ni izvore, datume provjere, interne napomene ni markdown.
- Ako proizvoda nema u katalogu, ponudi do 3 stvarne alternative sa cijenom; ako nema ni njih, reci da trenutno nemamo iz te grupe.
- Ne obećavaj provjeru kad podatak već postoji — navedi ga odmah.
- Vrati ISKLJUČIVO tekst poruke.`;

export const PRIVATE_ANSWER_RULES = `ODGOVOR AGENTU:
- Kratko i praktično: šta je poznato, šta nije, šta preporučuješ.
- Navedi izvor i svježinu podataka kada koristiš katalog ili procedure.
- Ne navodi brojeve („pronađeno 4, 3 na stanju“) ako nisi siguran — radije navedi listu proizvoda.
- Ako je potrebna akcija agenta (npr. nedostaje cijena, potrebna potvrda proizvoda), jasno navedi.
- Ako želiš dati i gotovu poruku kupcu, odvoji je tačno linijom: ---PORUKA KUPcu---
  Iznad linije: kratko objašnjenje za mene + izvor i datum provjere. Ispod linije: samo tekst poruke koju kopiram i pošaljem kupcu — bez izvora, bez napomene o provjeri, bez uvoda, bez navodnika i bez markdown oznaka. Žig (potpis) ide na kraj te poruke tačno kako je konfigurisan.`;

export function proceduresBlock(procedures: CompanyProcedure[]): string {
  if (!procedures.length) return 'KONFIGURISANE PROCEDURE FIRME: nema ih.';
  const lines = procedures.map((p) => {
    if (!p.verified || !p.answer.trim()) {
      return `- [${p.topic}] ${p.title}: NIJE KONFIGURIRANO. Ne odgovaraj na ovo pitanje izmišljenim sadržajem; reci agentu da procedura nije unesena u Postavkama.`;
    }
    return `- [${p.topic}] ${p.title}: ${p.answer.replace(/\s+/g, ' ').trim()}`;
  });
  return `KONFIGURISANE PROCEDURE FIRME (obavezno ih slijedi, imaju prednost nad opštim pretpostavkama):
${lines.join('\n')}`;
}

export function signatureBlock(sig: CompanySignature): string {
  const rendered = renderSignature(sig);
  if (!rendered) return 'POTPIS: nije konfiguriran (agent ga mora unijeti u Postavkama).';
  return `KONFIGURISANI POTPIS (dodaje se automatski, ne piši ga u tekstu):
${rendered}`;
}

export function settingsBlock(settings: AppSettings): string {
  const rules = settings.calculator;
  const delivery = rules.deliveryPolicy === 'on_request'
    ? 'dostava se potvrđuje ručno (nije konfigurirana)'
    : rules.deliveryRules.filter((r) => r.enabled).map((r) => r.name).join(', ') || 'nema aktivnih pravila';
  return `POSLOVNA PRAVILA:
- Valuta: ${rules.currency}
- Dostava: ${delivery}
- Broj aktivnih pravila popusta: ${rules.discountRules.filter((r) => r.enabled).length}`;
}

export function sessionBlock(session: CustomerSession): string {
  const ctx = serializeContext(session.context);
  return `TRENUTNA SESIJA KUPCA: "${session.label}"
${ctx || 'Nema strukturiranih podataka još. Poruke slijede.'}`;
}

export function transcriptBlock(
  messages: { senderType: string; content: string; createdAt: string }[],
): string {
  if (!messages.length) return 'TOK RAZGOVORA: (nema poruka)';
  const label: Record<string, string> = {
    customer: 'KUPAC',
    agent: 'AGENT (naša poruka)',
    note: 'INTERNA BILJEŠKA',
    instruction: 'UPUTA AGENTA AI-u',
  };
  const lines = messages.map(
    (m) => `[${label[m.senderType] ?? m.senderType}] ${m.content.replace(/\s+/g, ' ').trim()}`,
  );
  return `TOK RAZGOVORA (hronološki):
${lines.join('\n')}`;
}

export function buildAssistantSystemPrompt(args: {
  procedures: CompanyProcedure[];
  settings: AppSettings;
  session: CustomerSession;
  productContext: string;
}): string {
  return [
    CORE_RULES,
    COMPANY_IDENTITY,
    assistantRulesBlock(),
    PRIVATE_ANSWER_RULES,
    proceduresBlock(args.procedures),
    settingsBlock(args.settings),
    signatureBlock(args.settings.signature),
    args.settings.ai.additionalInstructions.trim()
      ? `DODATNE UPUTE AGENTA (ne smiju kršiti stroga pravila):
${args.settings.ai.additionalInstructions.trim()}`
      : '',
    sessionBlock(args.session),
    args.productContext,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Last lines of the prompt are the ones small models follow best, so the
 * absolute prohibitions are repeated here in the shortest possible form.
 */
export const HARD_STOPS = `ZABRANJENO U OVOJ PORUCI (prekršaj = poruka se odbacuje):
izmišljena cijena, težina, dimenzija, dostupnost, rok ili cijena dostave; „nemamo“ kad proizvod postoji; cijena dostave bez unesene težine; besplatna dostava; prvo lice jednine; izvor, link, skladište ili zalihe; obećan rok dostave.
Ako podatak nije u podacima iznad, napiši da nije unesen i da ćemo provjeriti.`;

export function buildReplySystemPrompt(args: {
  procedures: CompanyProcedure[];
  settings: AppSettings;
  style: 'concise' | 'balanced' | 'detailed';
}): string {
  const styleLine =
    args.style === 'concise'
      ? 'Stil: kratko, 1–3 rečenice.'
      : args.style === 'detailed'
        ? 'Stil: detaljnije, ali bez nepotrebnog ponavljanja (do 6 rečenica).'
        : 'Stil: uravnoteženo (2–4 rečenice).';
  return [
    CORE_RULES,
    COMPANY_IDENTITY,
    REPLY_RULES,
    styleLine,
    proceduresBlock(args.procedures),
    settingsBlock(args.settings),
    args.settings.ai.additionalInstructions.trim()
      ? `DODATNE UPUTE AGENTA:
${args.settings.ai.additionalInstructions.trim()}`
      : '',
    assistantRulesBlock(),
    REPLY_CHECKLIST,
    HARD_STOPS,
  ]
    .filter(Boolean)
    .join('\n');
}
