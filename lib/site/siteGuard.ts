/**
 * Tvrda granica na saobraćaj prema giga.ba.
 *
 * Pravilo je jednostavno: koliko god aplikacija radila, prema giga.ba nikad ne
 * ide više od `SITE_MAX_REQUESTS_PER_HOUR` zahtjeva na sat i nikad dva zahtjeva
 * u razmaku manjem od `SITE_MIN_GAP_MS`. Kad se granica dosegne, provjera se
 * preskače (podaci ostaju iz baze) — sajt ima prednost nad svime.
 *
 * Brojač je u memoriji procesa; resetuje se na restart. Na stvarnom radu
 * potrošnja je daleko ispod granice: jedan ciklus cijelog kataloga je 10
 * zahtjeva, a provjera uz odgovor najviše 5.
 */

const HOUR_MS = 60 * 60 * 1000;

export interface SiteGuardConfig {
  maxPerHour: number;
  minGapMs: number;
}

export interface SiteGuardState {
  /** Vremena zahtjeva u zadnjem satu. */
  stamps: number[];
  lastAt: number;
  skipped: number;
}

const globalForGuard = globalThis as unknown as { __gigaSiteGuard?: SiteGuardState };

function state(): SiteGuardState {
  return (globalForGuard.__gigaSiteGuard ??= { stamps: [], lastAt: 0, skipped: 0 });
}

export function siteGuardConfig(): SiteGuardConfig {
  const maxPerHour = Number(process.env.SITE_MAX_REQUESTS_PER_HOUR ?? 120);
  const minGapMs = Number(process.env.SITE_MIN_GAP_MS ?? 250);
  return {
    maxPerHour: Number.isFinite(maxPerHour) && maxPerHour > 0 ? maxPerHour : 120,
    minGapMs: Number.isFinite(minGapMs) && minGapMs >= 0 ? minGapMs : 250,
  };
}

/** Koliko je zahtjeva prema giga.ba poslano u zadnjih sat vremena. */
export function siteRequestsLastHour(now: number = Date.now()): number {
  const s = state();
  s.stamps = s.stamps.filter((stamp) => now - stamp < HOUR_MS);
  return s.stamps.length;
}

/**
 * Traži dozvolu za jedan zahtjev prema giga.ba.
 * `false` znači: ne diraj sajt, koristi podatke iz baze.
 */
export function acquireSiteSlot(now: number = Date.now()): boolean {
  const { maxPerHour, minGapMs } = siteGuardConfig();
  const s = state();
  s.stamps = s.stamps.filter((stamp) => now - stamp < HOUR_MS);

  if (s.stamps.length >= maxPerHour) {
    s.skipped++;
    return false;
  }
  if (minGapMs > 0 && now - s.lastAt < minGapMs) {
    s.skipped++;
    return false;
  }

  s.stamps.push(now);
  s.lastAt = now;
  return true;
}

export interface SiteGuardSnapshot {
  usedLastHour: number;
  maxPerHour: number;
  minGapMs: number;
  skipped: number;
  nextSlotInMs: number;
}

export function siteGuardSnapshot(now: number = Date.now()): SiteGuardSnapshot {
  const { maxPerHour, minGapMs } = siteGuardConfig();
  const s = state();
  const used = siteRequestsLastHour(now);
  const gapLeft = Math.max(0, minGapMs - (now - s.lastAt));
  return {
    usedLastHour: used,
    maxPerHour,
    minGapMs,
    skipped: s.skipped,
    nextSlotInMs: used >= maxPerHour ? 0 : gapLeft,
  };
}

/** Samo za testove. */
export function resetSiteGuard(): void {
  globalForGuard.__gigaSiteGuard = { stamps: [], lastAt: 0, skipped: 0 };
}
