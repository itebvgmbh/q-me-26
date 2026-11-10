import { backendSenden, liveLesen, type Zeitpunkt } from './live';

/**
 * Schlüssel für die Termin-API eines Ladens (backend/app/apis/api_zugang, backend/app/libs/api_schluessel.py).
 * Nur der Inhaber. Den Schlüssel selbst gibt es nur einmal, direkt nach dem Anlegen; die Liste zeigt nur seinen Anfang.
 * Die API selbst: /api/v1 (backend/app/schnittstelle), Beschreibung unter /api/v1/docs.
 */
export type ApiSchluessel = {
  id: string;
  name: string;
  /** Anfang des Schlüssels zum Wiedererkennen, z. B. „dz_1a2b3c4d5e6f7a8b“ */
  anfang: string;
  angelegt?: Zeitpunkt | null;
  zuletzt_benutzt?: Zeitpunkt | null;
};

export const API_BESCHREIBUNG = '/api/v1/docs';

const pfad = (shopId: string) => `team/laeden/${encodeURIComponent(shopId)}/api-schluessel`;

export const ladeSchluessel = (shopId: string) => liveLesen<{ schluessel: ApiSchluessel[]; tarif: boolean }>(pfad(shopId), true);

export const schluesselAnlegen = (shopId: string, name: string) =>
  backendSenden<{ eintrag: ApiSchluessel; schluessel: string }>(pfad(shopId), { name });

export const schluesselWiderrufen = (shopId: string, id: string) =>
  backendSenden<{ ok: boolean }>(`${pfad(shopId)}/${encodeURIComponent(id)}/widerrufen`, {});
