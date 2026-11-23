/**
 * Zaštita giga.ba od prečestih sinhronizacija.
 *
 * Sinhronizacija čita javni `products.json` (10 strana za cijeli katalog), pa je
 * jedini rizik da neko pritisne dugme mnogo puta zaredom. Ovaj modul drži pravilo
 * na jednom mjestu i daje ga testirati bez ijednog mrežnog poziva.
 */

/** Koliko sekundi mora proći između dvije sinhronizacije (default 60). */
export const DEFAULT_SYNC_COOLDOWN_SECONDS = 60;

export interface CooldownVerdict {
  allowed: boolean;
  /** Koliko sekundi još treba čekati (0 kada je dozvoljeno). */
  waitSeconds: number;
}

export function checkSyncCooldown(
  lastAttemptedSyncAt: string | null | undefined,
  now: Date = new Date(),
  cooldownSeconds: number = DEFAULT_SYNC_COOLDOWN_SECONDS,
): CooldownVerdict {
  if (cooldownSeconds <= 0) return { allowed: true, waitSeconds: 0 };
  if (!lastAttemptedSyncAt) return { allowed: true, waitSeconds: 0 };

  const last = new Date(lastAttemptedSyncAt).getTime();
  if (!Number.isFinite(last)) return { allowed: true, waitSeconds: 0 };

  const elapsedSeconds = (now.getTime() - last) / 1000;
  if (elapsedSeconds >= cooldownSeconds) return { allowed: true, waitSeconds: 0 };

  return { allowed: false, waitSeconds: Math.max(1, Math.ceil(cooldownSeconds - elapsedSeconds)) };
}
