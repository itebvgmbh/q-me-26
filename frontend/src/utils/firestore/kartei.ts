import { backendSenden, liveLesen, type Zeitpunkt } from '../live';
import type { KarteiEintrag, Kennzahlen } from '../kartei-logik';

/**
 * Kundenkartei über das Backend (backend/app/apis/team_laden, Logik backend/app/libs/kartei.py): Liste mit Kennzahlen,
 * Kundenseite mit Verlauf und Notizen. Inhaber und Team; das Tablet am Tresen kommt nicht dran (nur an die
 * Kundenliste ohne Notizen, utils/firestore/customers.ts). Kennzahlen und Notizen nur mit Tarif ab Solo (kartei).
 */

type Zeit = Zeitpunkt | null | undefined;

const datum = (z: Zeit): Date | null => (z && typeof z.toDate === 'function' ? z.toDate() : null);

type RohKennzahlen = Omit<Kennzahlen, 'zuletzt' | 'erster' | 'naechster'> & { zuletzt: Zeit; erster: Zeit; naechster: Zeit };

type RohEintrag = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
  source?: string;
  createdAt?: Zeit;
  hatNotiz?: boolean;
  kennzahlen?: RohKennzahlen;
  notiz?: string;
  notizGeaendert?: Zeit;
};

const kennzahlenAus = (z: RohKennzahlen): Kennzahlen => ({ ...z, zuletzt: datum(z.zuletzt), erster: datum(z.erster), naechster: datum(z.naechster) });

const eintragAus = (k: RohEintrag): KarteiEintrag => ({
  id: k.id,
  name: k.name || '',
  email: k.email || '',
  phone: k.phone || '',
  userId: k.userId || undefined,
  source: k.source || undefined,
  angelegt: datum(k.createdAt),
  hatNotiz: Boolean(k.hatNotiz),
  ...(k.kennzahlen ? { kennzahlen: kennzahlenAus(k.kennzahlen) } : {}),
});

export interface KarteiKunde extends KarteiEintrag {
  notiz: string;
  notizGeaendert: Date | null;
}

export interface KarteiTermin {
  id: string;
  start: Date | null;
  ende: Date | null;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  type?: 'queue' | 'booked';
  source?: string;
  referenceCode?: string;
  noShow: boolean;
  leistung: string;
  person: string;
  preis: number;
  /** ohne Konto über die Handynummer oder am Tresen zugeordnet */
  zugeordnet: boolean;
  notiz?: string;
  notizGeaendert?: Date | null;
}

type RohTermin = Omit<KarteiTermin, 'start' | 'ende' | 'notizGeaendert'> & { startTime: Zeit; endTime: Zeit; notizGeaendert?: Zeit };

const terminAus = (t: RohTermin): KarteiTermin => ({
  ...t,
  start: datum(t.startTime),
  ende: datum(t.endTime),
  notizGeaendert: datum(t.notizGeaendert),
});

const pfad = (shopId: string, ...teile: string[]) =>
  ['team/laeden', encodeURIComponent(shopId), 'kartei', ...teile.map(encodeURIComponent)].join('/');

/** Alle Kunden des Ladens; kartei = Tarif mit Kennzahlen und Notizen */
export const ladeKartei = async (shopId: string): Promise<{ kunden: KarteiEintrag[]; kartei: boolean }> => {
  const roh = await liveLesen<{ kunden: RohEintrag[]; kartei: boolean }>(pfad(shopId), true);
  return { kunden: roh.kunden.map(eintragAus), kartei: roh.kartei };
};

export interface KundenSeite {
  kunde: KarteiKunde;
  termine: KarteiTermin[];
  kennzahlen?: Kennzahlen;
  kartei: boolean;
}

const kundeAus = (k: RohEintrag): KarteiKunde => ({ ...eintragAus(k), notiz: k.notiz || '', notizGeaendert: datum(k.notizGeaendert) });

export const ladeKunde = async (shopId: string, kundeId: string): Promise<KundenSeite> => {
  const roh = await liveLesen<{ kunde: RohEintrag; termine: RohTermin[]; kennzahlen?: RohKennzahlen; kartei: boolean }>(pfad(shopId, kundeId), true);
  return {
    kunde: kundeAus(roh.kunde),
    termine: roh.termine.map(terminAus),
    ...(roh.kennzahlen ? { kennzahlen: kennzahlenAus(roh.kennzahlen) } : {}),
    kartei: roh.kartei,
  };
};

export type KundenAenderung = Partial<{ name: string; phone: string; email: string; notiz: string }>;

export const aendereKunde = async (shopId: string, kundeId: string, aenderung: KundenAenderung): Promise<KarteiKunde> =>
  kundeAus((await backendSenden<{ kunde: RohEintrag }>(pfad(shopId, kundeId), { aenderung })).kunde);

/** Notiz zu einem Besuch (z. B. Farbrezeptur); leer löscht sie */
export const speichereBesuchsnotiz = async (shopId: string, kundeId: string, terminId: string, notiz: string) =>
  (await backendSenden<{ notiz: { text?: string; geaendert?: Zeit } }>(pfad(shopId, kundeId, 'besuch', terminId), { notiz })).notiz;
