# Postavljanje na Vercel

Vercel je serverless: **fajl-sistem je samo za čitanje**, pa lokalna baza
(`.data/db.json`) tamo ne može raditi. Aplikacija zato na Vercelu radi samo sa
Firebase Realtime Database. Ako baza nije konfigurisana, `/api/health` i
`/api/bootstrap` vraćaju jasnu grešku i navode koje varijable nedostaju —
aplikacija više ne ostaje u vječitom učitavanju.

## 1. Uzmi bazu (Realtime Database)

1. Firebase Console → **Realtime Database** → Create database (region npr. `europe-west1`).
2. Kopiraj URL baze: `https://<projekat>-default-rtdb.europe-west1.firebasedatabase.app`
   (ili `...firebaseio.com`).
3. Project settings → **Service accounts** → *Generate new private key* → preuzmi JSON.

> Service-account JSON **nikad** ne ide u repozitorij ni u chat.
> `.gitignore` već pokriva `*adminsdk*.json`, `serviceAccount*.json`, `.secrets/`.

## 2. Environment Variables na Vercelu

Project → Settings → Environment Variables → dodaj za **Production** (i Preview):

### Obavezno za bazu

| Varijabla | Vrijednost |
|---|---|
| `FIREBASE_DB_URL` | URL baze iz koraka 1 |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | cijeli preuzeti JSON, kodiran u base64 |

Base64 je najsigurniji način jer nema problema sa `\n` u privatnom ključu.
Na Windowsu (Git Bash):

```bash
base64 -w0 gigaba-adminsdk.json
```

Alternativa sa tri odvojena polja (tada `\n` mora ostati zapisano kao `\n`):

| Varijabla | Vrijednost |
|---|---|
| `FIREBASE_PROJECT_ID` | `gigaba-asistent` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxxxx@<projekat>.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | cijeli `"private_key"` iz JSON-a, sa `\n` |

### Prijava i AI

| Varijabla | Vrijednost |
|---|---|
| `APP_PASSWORD` | tvoja šifra (npr. `2026`) |
| `AUTH_SECRET` | nasumičan string, npr. `openssl rand -base64 32` |
| `AUTH_MODE` | `password` |
| `AI_PROVIDER` | `gemini` |
| `AI_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | ključ 1 |
| `GEMINI_API_KEY_2` | ključ 2 (ako radi na besplatnom paketu) |
| `GEMINI_API_KEY_3` | ključ 3 |
| `AI_DAILY_TOKEN_BUDGET` | `3000000` |

**Ne dodavaj** `NEXT_PUBLIC_FIREBASE_*` ako ne koristiš Firebase Auth — klijent
tada pokušava prijavu koja nije potrebna i u konzoli se pojavljuje `403`.

### Katalog i zaštita sajta

| Varijabla | Vrijednost |
|---|---|
| `LIVE_SITE_CHECK` | `true` |
| `SCRAPER_MIN_INTERVAL_SECONDS` | `60` |
| `AUTO_SYNC_MINUTES` | `60` (ili `0` da se sajt nikad ne dira u pozadini) |
| `SITE_MAX_REQUESTS_PER_HOUR` | `120` |
| `SITE_MIN_GAP_MS` | `250` |

## 3. Prvi deploy i provjera

1. Push na `main` → Vercel sam napravi deploy.
2. Otvori `https://<app>.vercel.app/api/health`. Mora pisati:

```json
{ "ok": true, "storage": "rtdb", "firebaseAdmin": true, "ai": true, "missingEnv": [] }
```

Ako piše `ok: false`, u `error` i `missingEnv` je tačno šta dodati.

3. Uloguj se sa `APP_PASSWORD`.
4. Postavke → **Katalog i sinhronizacija** → pokreni uvoz (10 zahtjeva prema giga.ba,
   ~7 min). Bez toga je katalog prazan.

## 4. Pravila baze

Admin SDK zaobilazi pravila, ali klijentski pristup treba zatvoriti:

```json
{ "rules": { ".read": false, ".write": false } }
```

## 5. Šta na Vercelu ne radi

- Lokalna baza (`.data/`) — samo čitanje fajl-sistema.
- `npm run shot` (headless Chrome) — nije za Vercel, samo lokalno.
- Pozadinsko osvježavanje kataloga se pokreće prvim zahtjevom poslije deploya;
  na serverless funkciji tajmer ne živi dugo, pa je osvježavanje najbolje
  pokretati ručno ili preko Vercel Cron-a koji poziva `/api/scraper/run`.
