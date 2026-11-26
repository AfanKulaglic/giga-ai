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
  /** Key that will never work again (no free-tier access, revoked key). */
  disabled: boolean;
  /** Why it was disabled — shown to the agent, never guessed. */
  disabledReason: string | null;
}

export interface KeyRotator {
  readonly size: number;
  /** Keys that can still be used (size minus permanently disabled ones). */
  readonly usableCount: number;
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
  /**
   * Key that will never work again: project has no free-tier access, key was
   * deleted, credentials revoked. It must not be tried on every request.
   */
  disable(index: number, reason: string): void;
  isDisabled(index: number): boolean;
}

const MINUTE = 60_000;

export function createKeyRotator(keys: string[], options: { now?: () => number } = {}): KeyRotator {
  const usableKeys = keys.map((key) => key.trim()).filter(Boolean);
  const coolingUntil = new Map<number, number>();
  const disabledReasons = new Map<number, string>();
  const now = options.now ?? (() => Date.now());
  let preferred = 0;

  return {
    size: usableKeys.length,
    get preferred() {
      return preferred;
    },
    get usableCount() {
      return usableKeys.length - disabledReasons.size;
    },
    setPreferred(index) {
      if (!Number.isInteger(index) || index < 0 || index >= usableKeys.length) return;
      if (disabledReasons.has(index)) return;
      preferred = index;
    },
    status(at = now()) {
      return usableKeys.map((_, index) => ({
        index,
        usableInMs: Math.max(0, (coolingUntil.get(index) ?? 0) - at),
        disabled: disabledReasons.has(index),
        disabledReason: disabledReasons.get(index) ?? null,
      }));
    },
    pick(at = now()) {
      for (let step = 0; step < usableKeys.length; step++) {
        const index = (preferred + step) % usableKeys.length;
        if (disabledReasons.has(index)) continue;
        if ((coolingUntil.get(index) ?? 0) <= at) {
          return { index, key: usableKeys[index]!, retryInMs: 0 };
        }
      }
      const candidates = usableKeys
        .map((_, index) => index)
        .filter((index) => !disabledReasons.has(index));
      if (!candidates.length) {
        // Nijedan ključ više nije upotrebljiv — javi to jasno, bez tihog čekanja.
        return { index: 0, key: '', retryInMs: Number.POSITIVE_INFINITY };
      }
      const earliest = Math.min(...candidates.map((index) => coolingUntil.get(index) ?? 0));
      return { index: 0, key: '', retryInMs: Math.max(1000, earliest - at) };
    },
    disable(index, reason) {
      if (!Number.isInteger(index) || index < 0 || index >= usableKeys.length) return;
      disabledReasons.set(index, reason);
      if (preferred === index) {
        const next = usableKeys.findIndex((_, i) => !disabledReasons.has(i));
        if (next >= 0) preferred = next;
      }
    },
    isDisabled(index) {
      return disabledReasons.has(index);
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
    // Google resetuje dnevnu kvotu u ponoc po pacifickom vremenu (09:00 kod nas).
    const pacific = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(at));
    const read = (type: string) => Number(pacific.find((part) => part.type === type)?.value ?? 0);
    const elapsedMs = ((read('hour') % 24) * 3600 + read('minute') * 60 + read('second')) * 1000;
    return Math.max(MINUTE, 24 * 3600 * 1000 - elapsedMs);
  }
  const seconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds ? retryAfterSeconds : 60;
  return Math.max(5_000, seconds * 1000);
}
