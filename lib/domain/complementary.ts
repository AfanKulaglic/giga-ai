/**
 * Dodatna prodaja (cross-sell): kada agent ili kupac traži „predloži još nešto
 * uz ovaj proizvod”, traži se proizvod iz **druge** grupe koja ima smisla uz
 * traženi (stolica -> stol, krevet -> madrac...). Vraća se samo ono što katalog
 * stvarno ima i što je na stanju; ništa se ne izmišlja.
 */
export type ComplementaryGroup =
  | 'chair'
  | 'table'
  | 'bed'
  | 'mattress'
  | 'sofa'
  | 'armchair'
  | 'wardrobe'
  | 'dresser'
  | 'lamp'
  | 'shelf';

/** Grupa kojoj proizvod pripada — po nazivu iz kataloga. */
export function productGroup(name: string): ComplementaryGroup | null {
  const upper = name.toUpperCase();
  if (/STOLICA|STOLAC|TABURE|BAR STOLICA/.test(upper)) return 'chair';
  if (/MADRAC|NADMADRAC/.test(upper)) return 'mattress';
  if (/KREVET|KREVETAC|LEŽAJ|LEZAJ/.test(upper)) return 'bed';
  if (/UGAONA|GARNITURA|TROSJED|DVOSJED|SOFA/.test(upper)) return 'sofa';
  if (/FOTELJA|NASLONJAČ|NASLONJAC/.test(upper)) return 'armchair';
  if (/ORMAR|GARDEROB|PLAKAR/.test(upper)) return 'wardrobe';
  if (/KOMODA|KOMODIC|NOĆNI ORMARIĆ|NOCNI ORMARIC/.test(upper)) return 'dresser';
  if (/LAMPA|SVJETILJKA|PLAFONJERA|VISILICA/.test(upper)) return 'lamp';
  if (/POLICA|REGAL|ETAŽER|ETAZER/.test(upper)) return 'shelf';
  // „Stol” ide poslije stolice i poslije PISTOLJ (oružje), da se ne pomiješa.
  if (!/PISTOLJ|PIŠTOLJ|PISTOLJ/.test(upper) && /\bSTOL\b|\bSTO\b|TRPEZARIJSKI/.test(upper)) return 'table';
  return null;
}

/** Koja grupa ide uz koju (npr. uz stolicu -> stol). */
const COMPANION: Record<ComplementaryGroup, ComplementaryGroup> = {
  chair: 'table',
  table: 'chair',
  bed: 'mattress',
  mattress: 'bed',
  sofa: 'armchair',
  armchair: 'sofa',
  wardrobe: 'dresser',
  dresser: 'wardrobe',
  lamp: 'shelf',
  shelf: 'lamp',
};

/** Pojam za pretragu kataloga za datu grupu. */
const SEARCH_TERM: Record<ComplementaryGroup, string> = {
  chair: 'stolica',
  table: 'stol',
  bed: 'krevet',
  mattress: 'madrac',
  sofa: 'garnitura',
  armchair: 'fotelja',
  wardrobe: 'ormar',
  dresser: 'komoda',
  lamp: 'lampa',
  shelf: 'polica',
};

/** Grupa koja ide uz proizvod, ili null ako par nije poznat. */
export function complementaryGroup(productName: string): ComplementaryGroup | null {
  const own = productGroup(productName);
  return own ? COMPANION[own] : null;
}

/** Pojam za pretragu kataloga za datu grupu. */
export function groupSearchTerm(group: ComplementaryGroup): string {
  return SEARCH_TERM[group];
}

/** Da li naziv proizvoda stvarno pripada traženoj grupi. */
export function matchesGroup(name: string, group: ComplementaryGroup): boolean {
  return productGroup(name) === group;
}

/** Da li poruka traži predlog dodatnog proizvoda („predloži neki stol uz nju”). */
export function asksForSuggestion(text: string): boolean {
  return /predlo[žz]|preporu[čc]|uz\s+ovu|uz\s+ovaj|ide\s+uz|kombinuj|jo[šs]\s+neki|jo[šs]\s+neku|dodaj\s+neki|neki\s+stol|neku\s+stolicu|šta\s+bi\s+išlo|sta\s+bi\s+islo/i.test(
    text,
  );
}
