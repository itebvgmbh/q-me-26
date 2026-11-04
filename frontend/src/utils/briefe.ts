// Briefe an Salons in Wellen (Betreiber-Bereich, Reiter Briefe; requirements/briefversand.md, Stufe A)
// Backend: backend/app/apis/betreiber/briefe.py, Regeln: backend/app/libs/briefaktion.py
import { request, send } from './betreiber';
import type { Kategorie } from './verzeichnis';

export type BriefArt = 'brief' | 'erinnerung';

export interface BriefEinstellungen {
  proWelle: number;
  proMonat: number;
  preis: number;
}

/** Ein Salon aus dem Verzeichnis; gruende[art] leer = auswählbar */
export interface BriefSalon {
  id: string;
  name: string;
  kategorie: Kategorie;
  street: string;
  postalCode: string;
  city: string;
  bezirk: string;
  ortsteil: string;
  status: string;
  pfad: string;
  briefe: number;
  letzterBrief: string | null;
  gruende: Record<BriefArt, string>;
}

export interface Welle {
  id: string;
  art: BriefArt;
  am: string;
  status: 'erzeugt' | 'verschickt';
  anzahl: number;
  preis: number;
  kosten: number;
  verschicktAm: string | null;
  auswertung: { uebernommen: number; unzustellbar: number; entfernt: number; keinePost: number; kostenJeUebernahme: number | null };
}

export interface BriefeDaten {
  einstellungen: BriefEinstellungen;
  monat: { kosten: number; grenze: number };
  eintraege: BriefSalon[];
  wellen: Welle[];
  erinnerungTage: number;
}

const BASE = '/routes/betreiber/briefe';
const wellePath = (id: string, action: string) => `${BASE}/welle/${encodeURIComponent(id)}/${action}`;

export const loadBriefe = () => send<BriefeDaten>(BASE);
export const saveEinstellungen = (werte: BriefEinstellungen) => send<BriefEinstellungen>(`${BASE}/einstellungen`, werte);
export const markHochgeladen = (id: string) => send<{ ok: boolean }>(wellePath(id, 'hochgeladen'), {});
export const discardWelle = (id: string) => send<{ ok: boolean }>(wellePath(id, 'verwerfen'), {});

/** Welle erzeugen und das Sammel-PDF speichern. Die Codes stehen nur darin, später zeigt sie niemand mehr an. */
export const createWelle = async (art: BriefArt, ids: string[]) => {
  const res = await request(`${BASE}/welle`, { art, ids });
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'Dranzeit-Briefe.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return res.headers.get('X-Welle') || '';
};
