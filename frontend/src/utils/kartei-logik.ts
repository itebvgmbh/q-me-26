/**
 * Kundenkartei ohne Browser und ohne Backend: Gruppen (Stammkunde, Neu, Lange nicht da), Suche und Sortierung für die
 * Seite „Kunden“ (pages/Kunden.tsx). Die Kennzahlen rechnet das Backend (backend/app/libs/kartei.py).
 * Getestet in dev/kartei.test.mjs. Keine Importe außer Typen, damit der Test ohne Bauen läuft.
 */

export interface Kennzahlen {
  /** vorbei und nicht abgesagt */
  besuche: number;
  /** Summe der Preise dieser Besuche laut Preisliste */
  umsatz: number;
  abgesagt: number;
  nichtGekommen: number;
  zuletzt: Date | null;
  erster: Date | null;
  naechster: Date | null;
  /** üblicher Abstand zwischen zwei Besuchen in Tagen, ab zwei Besuchen */
  abstandTage: number | null;
  lieblingsLeistung: string;
  lieblingsPerson: string;
}

export interface KarteiEintrag {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  userId?: string;
  source?: string;
  angelegt: Date | null;
  hatNotiz?: boolean;
  kennzahlen?: Kennzahlen;
}

export type Gruppe = 'alle' | 'stamm' | 'neu' | 'lange';
export type Sortierung = 'zuletzt' | 'name' | 'umsatz' | 'besuche';

/** Stammkunde ab so vielen Besuchen */
export const STAMM_BESUCHE = 3;
/** Neu: höchstens ein Besuch, und der erste Kontakt liegt höchstens so viele Tage zurück */
export const NEU_TAGE = 60;
/** Lange nicht da ohne üblichen Abstand (nur ein Besuch) */
export const LANGE_TAGE = 90;

const TAG_MS = 86_400_000;

/** Ab wie vielen Tagen ohne Besuch jemand „lange nicht da“ ist: anderthalbmal sein üblicher Abstand, mindestens zwei
 *  Wochen mehr als der Abstand; ohne Abstand LANGE_TAGE */
export const langeNichtDaAb = (z: Kennzahlen): number =>
  z.abstandTage && z.abstandTage > 0 ? Math.max(Math.round(z.abstandTage * 1.5), z.abstandTage + 14) : LANGE_TAGE;

export const tageSeit = (d: Date | null, jetzt: Date): number | null => (d ? Math.floor((jetzt.getTime() - d.getTime()) / TAG_MS) : null);

export const istStammkunde = (z: Kennzahlen) => z.besuche >= STAMM_BESUCHE;

export const istNeu = (e: KarteiEintrag, jetzt: Date) => {
  const z = e.kennzahlen;
  if (!z || z.besuche > 1) return false;
  const seit = tageSeit(z.erster ?? e.angelegt, jetzt);
  return seit !== null && seit <= NEU_TAGE;
};

/** War schon da, hat nichts Kommendes und ist länger weg als sonst */
export const istLangeNichtDa = (z: Kennzahlen, jetzt: Date) => {
  if (z.besuche === 0 || z.naechster) return false;
  const seit = tageSeit(z.zuletzt, jetzt);
  return seit !== null && seit > langeNichtDaAb(z);
};

export const inGruppe = (e: KarteiEintrag, gruppe: Gruppe, jetzt: Date) => {
  if (gruppe === 'alle') return true;
  const z = e.kennzahlen;
  if (!z) return false;
  if (gruppe === 'stamm') return istStammkunde(z);
  if (gruppe === 'neu') return istNeu(e, jetzt);
  return istLangeNichtDa(z, jetzt);
};

/** Kleinbuchstaben ohne Akzente: „Müller“ findet „muller“ und „müller“ */
const normal = (s: string) =>
  s
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');

const ziffern = (s: string) => s.replace(/\D/g, '');

/** Telefonnummer als „49…“ ohne Plus und führende Null, damit 0170 1 und +49 170 1 gleich sind */
const telefonKern = (s: string) => {
  const z = ziffern(s);
  if (z.startsWith('00')) return z.slice(2);
  if (z.startsWith('0')) return `49${z.slice(1)}`;
  return z;
};

/** Suche über Name, E-Mail und Telefon. Mehrere Wörter: alle müssen passen. */
export const passtZurSuche = (e: KarteiEintrag, suche: string) => {
  const woerter = normal(suche).split(/\s+/).filter(Boolean);
  if (!woerter.length) return true;
  const text = normal(`${e.name} ${e.email ?? ''}`);
  const telefon = e.phone ? telefonKern(e.phone) : '';
  return woerter.every((w) => {
    if (text.includes(w)) return true;
    const z = ziffern(w);
    if (z.length < 3 || !telefon) return false;
    return telefon.includes(z.replace(/^0+/, '')) || telefon.includes(telefonKern(w));
  });
};

const zeit = (d: Date | null | undefined) => (d ? d.getTime() : -Infinity);

export const sortiere = (liste: KarteiEintrag[], nach: Sortierung): KarteiEintrag[] => {
  const nachName = (a: KarteiEintrag, b: KarteiEintrag) => (a.name || '').localeCompare(b.name || '', 'de');
  const kopie = [...liste];
  if (nach === 'name') return kopie.sort(nachName);
  return kopie.sort((a, b) => {
    const za = a.kennzahlen;
    const zb = b.kennzahlen;
    let d = 0;
    if (nach === 'umsatz') d = (zb?.umsatz ?? 0) - (za?.umsatz ?? 0);
    else if (nach === 'besuche') d = (zb?.besuche ?? 0) - (za?.besuche ?? 0);
    else {
      // Zuletzt da: neueste zuerst, wer noch nie da war, ans Ende
      const ta = zeit(za?.zuletzt);
      const tb = zeit(zb?.zuletzt);
      d = ta === tb ? 0 : tb > ta ? 1 : -1;
    }
    return d || nachName(a, b);
  });
};

/** Wie viele in jeder Gruppe – für die Knöpfe über der Liste */
export const zaehleGruppen = (liste: KarteiEintrag[], jetzt: Date): Record<Gruppe, number> => {
  const zahl: Record<Gruppe, number> = { alle: liste.length, stamm: 0, neu: 0, lange: 0 };
  for (const e of liste) {
    if (inGruppe(e, 'stamm', jetzt)) zahl.stamm++;
    if (inGruppe(e, 'neu', jetzt)) zahl.neu++;
    if (inGruppe(e, 'lange', jetzt)) zahl.lange++;
  }
  return zahl;
};

/** Üblicher Abstand in Worten-Bausteinen: Wochen ab 14 Tagen, sonst Tage */
export const abstandEinheit = (tage: number): { wert: number; einheit: 'tage' | 'wochen' } =>
  tage >= 14 ? { wert: Math.round(tage / 7), einheit: 'wochen' } : { wert: tage, einheit: 'tage' };
