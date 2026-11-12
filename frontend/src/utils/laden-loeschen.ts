import { backendSenden, liveLesen } from './live';

/** Laden löschen durch den Inhaber (backend/app/apis/laden_loeschen, Logik in backend/app/libs/laden_loeschen.py) */
export interface LoeschVorschau {
  id: string;
  name: string;
  /** Das muss zur Bestätigung eingetippt werden: der Name des Ladens */
  bestaetigung: string;
  /** Warum es (noch) nicht geht – z. B. ein laufendes Abo; null: es geht */
  hindernis: string | null;
  /** Wohin der Dialog verweist: tarif, telefon; itebv ohne Link */
  hindernisArt: 'tarif' | 'telefon' | 'itebv' | null;
  anzahl: { kommende: number; termine: number; team: number; leistungen: number; kunden: number };
  gruender: boolean;
  /** Gekündigtes Abo: bezahlt bis hier (ISO), danach endet es von selbst */
  aboEndet: string | null;
}

const pfad = (shopId: string) => `team/laeden/${encodeURIComponent(shopId)}/loeschen`;

export const loeschVorschau = (shopId: string) => liveLesen<LoeschVorschau>(pfad(shopId), true);

export const ladenLoeschen = (shopId: string, bestaetigung: string) =>
  backendSenden<{ geloescht: boolean; reste: number }>(pfad(shopId), { bestaetigung });

/** Wie das Backend vergleicht: ohne Leerzeichen am Rand, Groß/klein egal */
export const passt = (eingabe: string, wort: string) => eingabe.trim().toLocaleLowerCase() === wort.trim().toLocaleLowerCase();
