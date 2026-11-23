/**
 * Telefonski brojevi za GigaHub narudžbu.
 *
 * GigaHub polje prima samo lokalni format: `062576456`, bez državnog poziva
 * (387 / +387 / 00387) i bez crtica, razmaka ili zagrada. Više brojeva se piše
 * odvojeno zarezom i razmakom: `062576456, 066234888`.
 */
export function normalizeOrderPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  let local = digits;
  // 00387..., 387..., +387... -> bez državnog poziva.
  if (local.startsWith('00387')) local = local.slice(5);
  else if (local.startsWith('387')) local = local.slice(3);
  // Ponekad je broj zapisan kao "387 62 576 456" pa je vodeća nula izgubljena.
  if (!local.startsWith('0') && local.length <= 9) local = `0${local}`;

  // Lokalni broj u BiH ima 9 cifara (0 + 8). Sve preko toga je ostatak
  // nekog prefiksa — zadržavamo prvih 9 da polje ostane validno.
  if (local.length > 9) local = local.slice(0, 9);
  return local;
}

/**
 * Više brojeva u jednoj vrijednosti: `062576456; 066/234-888` ->
 * `062576456, 066234888`. Duplikati se uklanjaju, redoslijed se zadržava.
 */
export function normalizeOrderPhones(raw: string | null | undefined): string {
  if (!raw) return '';
  const parts = raw
    .split(/[,;/]|\s+-\s+|\bi\b/i)
    .flatMap((part) => part.split(/\s{2,}/))
    .map((part) => normalizeOrderPhone(part))
    .filter(Boolean);
  const unique: string[] = [];
  for (const phone of parts) if (!unique.includes(phone)) unique.push(phone);
  return unique.join(', ');
}

/** Ima li vrijednost barem jedan upotrebljiv broj (9 cifara, počinje nulom). */
export function isUsableOrderPhone(raw: string | null | undefined): boolean {
  const phone = normalizeOrderPhone(raw);
  return /^0\d{8}$/.test(phone);
}
