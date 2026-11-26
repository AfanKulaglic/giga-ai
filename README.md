# GIGA.ba AI asistent — interni alat za prodaju

Privatni radni asistent za jednog prodajnog agenta koji vodi razgovore sa
kupcima na **Instagramu i Facebooku** za [giga.ba](https://giga.ba).

> ⚠️ Ovo **nije** chatbot za kupce niti generički CRM. AI asistent radi **iza**
> kulisa: priprema odgovore, izračunava narudžbe i priprema obrazac za GigaHub.
> Agent kopira gotove poruke u društvene mreže i **ručno** unosi narudžbu.
> Aplikacija **nikada automatski ne šalje poruke niti ne upisuje narudžbe**.

---

## Šta piše u aplikaciji – pravila

- **Cijene, dostupnost, specifikacije, rokovi** dolaze isključivo iz kataloga
  GIGA.ba (Shopify `products.json`) ili iz postavki koje je potvrdio agent.
- **AI ne smije ništa izmišljati.** Nepotvrđene stavke su označene u postavkama
  (`provjerite tekst`, `privremeno`, `nije konfigurisano`) i asistent ih
  prijavljuje agentu umjesto da pogađa.
- **Iznosi se računaju deterministički** u `lib/domain/calculator.ts` (cijeli
  centi), nikada kroz model.
- **Jedan razgovor, bez historije** – u radu je uvijek jedan kupac; dugme „Reset” briše trenutni razgovor i otvara prazan (nema liste starih sesija).
- Interni podaci (napomene, upute, kalkulacija) **nikada** ne ulaze u poruku kupcu.

## Tehnološki stog

Next.js 15 · React 19 · TypeScript · Tailwind · Firebase Auth / Realtime Database ·
Firebase Admin SDK · OpenAI-kompatibilan AI (podrazumijevano **Groq besplatni
nivo**, model konfigurabilan) · Zod · Vitest · Node.js radnik za katalog.

## Pokretanje

```bash
npm install                  # node_modules je junction na E:\giga_nm
# .env.local je već pripremljen sa AI_PROVIDER=groq — samo upišite ključ:
#   1) otvorite https://console.groq.com/keys (prijava Google nalogom, bez kartice)
#   2) Create API key → kopirajte u GROQ_API_KEY
npm run dev                  # http://localhost:3000
```

Bez ključa sve osim AI funkcija radi: radni prostor, kalkulator, katalog,
postavke, kopiranje poruka i priprema GigaHub obrasca.

Bez Firebase ključeva aplikacija radi u **lokalnom načinu** (jedan korisnik,
podaci u `.data/db.json`).

### Skladištenje podataka

Redom se bira prvi raspoloživi backend:

1. **Realtime Database** — postavljen `FIREBASE_DB_URL` + servisni račun
2. **Firestore** — servisni račun bez `FIREBASE_DB_URL`
3. **Lokalna JSON baza** — bez servisnog računa (`ALLOW_LOCAL_MODE=false` to zabranjuje)

Servisni račun se najsigurnije zadaje putanjom do `.json` fajla koji stoji
**izvan projekta**:

```env
FIREBASE_SERVICE_ACCOUNT_PATH=C:/Users/<vi>/.secrets/gigaba-adminsdk.json
FIREBASE_DB_URL=https://<projekat>-default-rtdb.firebaseio.com
AUTH_MODE=local          # jedan agent, bez login ekrana
```

### Prijava

`AUTH_MODE` bira način ulaza:

| Vrijednost | Ponašanje |
|---|---|
| `password` (podrazumijevano) | jedna zajednička šifra iz `APP_PASSWORD` (default `2026`) |
| `firebase` | pravi nalozi — Email/Password prijava + `AUTHORIZED_EMAILS` |
| `local` | bez prijave (samo za potpuno privatan računar) |

Šifra se provjerava na serveru; browser dobija potpisani `httpOnly` kolačić
(30 dana). API rute bez kolačića vraćaju 401, a stranice preusmjeravaju na
`/login`. Šifru mijenjate samo u `.env.local` (`APP_PASSWORD=…`) i restartujete
aplikaciju — bez izmjene koda.

Postojeći lokalni podaci se prenose u Realtime Database jednom komandom:

```bash
npm run migrate:rtdb
```

Napomena: Realtime Database ne čuva prazne nizove ni `undefined` vrijednosti.
`RtdbStore` to rješava markerom za prazne nizove i spajanjem sa
podrazumijevanim vrijednostima pri čitanju.

### Katalog GIGA.ba

Nema zvaničnog API-ja; koristi se javni, robots.txt-dozvoljen Shopify
endpoint `https://giga.ba/products.json` (250 proizvoda po stranici). Sajt
ograničava promet — radnik poštuje `SCRAPER_DELAY_MS` i `SCRAPER_CONCURRENCY`.

```bash
npm run scraper:test      # 10 proizvoda (proba prije svega)
npm run scraper:sync      # puni katalog, primjenjuje samo stvarne promjene
npm run scraper:full      # kompletan uvoz
npm run scraper:schedule  # periodična sinhronizacija (radnik)
```

Sve se pokreće i iz interfejsa: **Postavke → Katalog**. Testni uvoz sa 10
proizvoda je uspješno prošao (0 grešaka – provjeren SKU, cijena, popust,
dostupnost, 18 specifikacija na spravi za fitness, tačni URL-ovi proizvoda).

## GigaHub narudžbe

- **Postavke → GigaHub obrazac**: definišete polja, redoslijed i mapiranje
  (ime/telefon kupca → iz sesije; artikli/iznos → iz kalkulatora; prazno →
  ručni unos).
- Modal **Pripremi narudžbu** pokazuje vrijednosti tačno tim redom, svako polje
  ima dugme za kopiranje. Ništa se ne šalje u GigaHub — agent lijepi ručno.
- Polja su označena kao *privremena* dok se ne potvrde sa stvarnom šemom.

## Postavke

Svaki dio se uređuje u **Postavke**: brzi odgovori, potpis, procedure firme,
popusti i dostava (pravila kalkulatora), GigaHub obrazac, ručne specifikacije,
AI upute i katalog. Nepotvrđeni sadržaj je eksplicitno označen; ništa se ne
popunjava "otprilike".

## Promjena AI provajdera

Aplikacija govori OpenAI-kompatibilni protokol, pa se provajder mijenja samo
kroz `.env.local` — kod se ne dira. Podržani su: **Groq** (podrazumijevano),
DeepSeek, Google Gemini, OpenRouter, lokalni Ollama i bilo koji prilagođeni
`AI_BASE_URL`.

| Provajder | Ključ | Besplatni nivo (okvirno) |
|---|---|---|
| **Groq** `openai/gpt-oss-120b` | `GROQ_API_KEY` | 30 zahtjeva/min, 1.000/dan, **8.000 tokena/min** |
| **Gemini** `gemini-3.5-flash-lite` | `GEMINI_API_KEY` | 10 zahtjeva/min, 250k tokena/min, **500 zahtjeva/dan** |
| OpenRouter `...:free` | `OPENROUTER_API_KEY` | dnevni limit + red čekanja |
| Ollama `qwen3:8b` | bez ključa | bez limita, troši vaš hardver |

Važno: model **mora podržavati pozivanje alatki** (tools / function calling) —
bez toga asistent ne može čitati katalog ni kalkulator.

**Više naloga = više kvote.** Za isti provajder možete navesti nekoliko ključeva
(`GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` … ili
`AI_API_KEYS=kljuc1,kljuc2`). Asistent koristi prvi dok radi; kad on vrati
dnevni limit, automatski prelazi na sljedeći, a prvi se vraća u igru kad se
kvota resetuje (ponoć po UTC). Ništa se ne restartuje i ništa se ne gubi — u
Postavkama piše koliko je ključeva u rotaciji.

Groqov besplatni nivo ima uzak protok tokena (8.000/min), pa jedan složeniji
razgovor može naići na `429`. Aplikacija tada poštuje `Retry-After`, pokušava
ponovo i, ako i dalje ne ide, jasno kaže koliko treba sačekati. Za veći obim
pređite na Gemini besplatni nivo ili Groq Developer plan.

### AI bez instalacije na radnom računaru

Ako aplikacija radi na računaru na poslu gdje se ne smije instalirati Ollama,
dvije su čiste opcije:

1. **Ključ u oblaku (preporučeno).** Na poslu treba samo internet i `.env.local`:
   ```env
   AI_PROVIDER=gemini
   GEMINI_API_KEY=...            # besplatno na aistudio.google.com/apikey
   AI_MODEL=gemini-3.5-flash-lite
   AI_DAILY_TOKEN_BUDGET=250000
   ```
   Ništa se ne instalira, 500 zahtjeva/dan (dovoljno za ~250 odgovora kupcima).

2. **Model na kućnom računaru, aplikacija na poslu.** Kućni PC vrti Ollama, a
   aplikacija mu pristupa kroz tunel (npr. Tailscale ili Cloudflare Tunnel):
   ```env
   AI_PROVIDER=ollama
   AI_BASE_URL=https://<tvoj-tunel>/v1
   AI_MODEL=qwen3:8b
   ```
   Uslovi: kućni PC mora biti uključen, tunel zaštićen tokenom, a radna mreža
   mora dozvoljavati odlazni HTTPS. Prednost: podaci ne izlaze iz kuće.

3. **Sve na kućnom računaru.** I aplikacija i model su kod kuće, a na poslu se
   otvara samo browser kroz tunel — na radnom računaru se ne instalira ništa.

## Testovi

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (kalkulator, novac, normalizacija, pretraga,
                    # izolacija sesija, potpis, priprema obrasca)
```

## Sigurnost

- Svaki API poziv prolazi kroz `requireAuth` — Firebase ID token + dozvoljeni
  nalozima (`AUTHORIZED_EMAILS`); u lokalnom načinu jedan korisnik.
- Bilježenje radnji (audit log) u Firestore (`giga_audit`) / lokalni JSON.
- Ključevi samo na serveru (`server-only` ispod `lib/ai`, `lib/api`);
  varijable sa prefiksom `NEXT_PUBLIC_` nikada ne nose tajne.
- Radnik dijeli isti nivo pristupa bazi; nikada ne skida HTML niti upisuje kod.

## Struktura

```
lib/domain/     čista logika (tipovi, novac, kalkulator, pretraga, kontekst)
lib/ai/         klijent, prompti, alatke, orchestrator (server-only)
lib/config/     podrazumijevane postavke zrna + provjera env-a
lib/store/      LocalStore (JSON) / FirestoreStore / RtdbStore (Realtime Database)
worker/         radnik za katalog (gigaClient, sync, cli)
app/api/        REST rute (sve autentificirano)
app/            workspace (/), proizvodi (/products), pravila (/rules), postavke (/settings)
tests/          vitest — deterministički dio sistema bez mreže
```

## Produkcijski napomene

- Radnik za periodičnu sinhronizaciju pokrenite kao dugotrajni proces
  (`npm run scraper:schedule`) na VM/instance-i; na serverless platformama
  koristite eksterni cron koji poziva `POST /api/scraper/run` uz Firebase
  prijavu.
- Redovno provjeravajte da li je `AI_MODEL` još dostupan kod provajdera (besplatni modeli se povlače).
- Ažurirajte potpis, procedure i pravila čim se politika firme promijeni —
  asistent uvijek čita trenutne postavke.