/**
 * Several API keys, one provider: when one key hits its quota the next one takes
 * over, so two free Gemini accounts double the daily allowance (500 → 1000).
 * Kept free of server-only imports so it can be unit tested.
 */
export interface PickedKey {
  index: number;
  key: string;
  /** Set when every key is cooling down: how long until one frees up. */
  retryInMs: number;
}

export interface KeyStatus {
  index: number;
  /** 0 = usable now, otherwise milliseconds left before the key is usable again. */
  usableInMs: number;
}

export interface KeyRotator {
  readonly size: number;
  /** Which key the next request starts from. */
  readonly preferred: number;
  /** Force the next request to start from this key (agent's manual choice). */
  setPreferred(index: number): void;
  /** Per-key availability, for the navbar indicator. */
  status(now?: number): KeyStatus[];
  /** First key that is not cooling down, or the shortest wait if all are. */
  pick(now?: number): PickedKey;
  /** Stop using a key for `ms` (quota reached, bad credentials). */
  coolDown(index: number, ms: number, now?: number): void;
  /** Milliseconds until the key is usable again (0 = usable now). */
  waitFor(index: number, now?: number): number;
}

const MINUTE = 60_000;

export function createKeyRotator(keys: string[], options: { now?: () => number } = {}): KeyRotator {
  const usableKeys = keys.map((key) => key.trim()).filter(Boolean);
  const coolingUntil = new Map<number, number>();
  const now = options.now ?? (() => Date.now());
  let preferred = 0;

  return {
    size: usableKeys.length,
    get preferred() {
      return preferred;
    },
    setPreferred(index) {
      if (Number.isInteger(index) && index >= 0 && index < usableKeys.length) preferred = index;
    },
    status(at = now()) {
      return usableKeys.map((_, index) => ({
        index,
        usableInMs: Math.max(0, (coolingUntil.get(index) ?? 0) - at),
      }));
    },
    pick(at = now()) {
      for (let step = 0; step < usableKeys.length; step++) {
        const index = (preferred + step) % usableKeys.length;
        if ((coolingUntil.get(index) ?? 0) <= at) {
          return { index, key: usableKeys[index]!, retryInMs: 0 };
        }
      }
      const earliest = usableKeys.length
        ? Math.min(...usableKeys.map((_, index) => coolingUntil.get(index) ?? 0))
        : at + MINUTE;
      return { index: 0, key: '', retryInMs: Math.max(1000, earliest - at) };
    },
    coolDown(index, ms, at = now()) {
      const current = coolingUntil.get(index) ?? 0;
      // Never shorten an existing cooldown (a daily quota beats a per-minute one).
      coolingUntil.set(index, Math.max(current, at + Math.max(0, ms)));
    },
    waitFor(index, at = now()) {
      return Math.max(0, (coolingUntil.get(index) ?? 0) - at);
    },
  };
}

/** A daily quota error should park the key until the quota resets, not for a minute. */
export function cooldownForRateLimit(body: string, retryAfterSeconds: number | null, at = Date.now()): number {
  const daily = /per\s*day|daily|per-day|quota|billing|exceeded your current quota|insufficient_quota/i.test(body);
  if (daily) {
    const nextMidnight = new Date(at);
    nextMidnight.setUTCHours(24, 0, 0, 0);
    return Math.max(MINUTE, nextMidnight.getTime() - at);
  }
  const seconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds ? retryAfterSeconds : 60;
  return Math.max(5_000, seconds * 1000);
}
