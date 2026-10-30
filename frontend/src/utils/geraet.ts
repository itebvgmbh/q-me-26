import { merke } from '@/i18n';

/**
 * Wofür ein Gerät im Laden da ist – einmal gefragt (components/GeraetWahl.tsx), danach startet es immer dort:
 *  - tresen:     Tablet am Empfang – „Heute“ für alle, bleibt an
 *  - handy:      eigenes Handy – „Heute“ nur mit den eigenen Kunden
 *  - bildschirm: Fernseher im Wartezimmer – /bildschirm/<Laden>, auch ohne Anmeldung
 *  - buero:      Planen und Verwalten – „Laden“
 * Gespeichert nur in diesem Browser (localStorage); ein anderes Gerät fragt neu.
 */
export type GeraetRolle = 'tresen' | 'handy' | 'bildschirm' | 'buero';

export interface Geraet {
  rolle: GeraetRolle;
  /** Laden, für den der Wartezimmer-Bildschirm läuft */
  shopId?: string;
}

export const ROLLEN: { rolle: GeraetRolle; titel: string; text: string }[] = [
  { rolle: 'tresen', titel: merke('Tresen-Tablet'), text: merke('Heute, alle Personen, „Fertig – Nächster“. Bleibt an.') },
  { rolle: 'handy', titel: merke('Mein Handy'), text: merke('Heute, nur deine Kunden. Mit Benachrichtigung, wenn jemand bucht.') },
  { rolle: 'bildschirm', titel: merke('Wartezimmer-Bildschirm'), text: merke('Nummern groß für alle im Laden, mit QR-Code zum Einreihen.') },
  { rolle: 'buero', titel: merke('Büro'), text: merke('Woche planen, Team, Leistungen, Auswertung, Tarif.') },
];

const SPEICHER = 'dranzeit-geraet';
// Je Sitzung nur einmal: beim Start der App an die Stelle des Geräts, danach frei bewegen (z. B. Logo → Startseite)
const START_GEPRUEFT = 'dranzeit-geraet-start';
const NICHT_JETZT = 'dranzeit-geraet-spaeter';

export const gespeichertesGeraet = (): Geraet | null => {
  try {
    const wert = JSON.parse(localStorage.getItem(SPEICHER) || 'null');
    return wert && ROLLEN.some((r) => r.rolle === wert.rolle) ? (wert as Geraet) : null;
  } catch {
    return null;
  }
};

export const merkeGeraet = (geraet: Geraet) => {
  try {
    localStorage.setItem(SPEICHER, JSON.stringify(geraet));
  } catch {
    /* privater Modus: dann fragt das Gerät beim nächsten Mal wieder */
  }
};

/** Wohin ein Gerät mit dieser Rolle startet. Mitarbeiter haben nur „Heute“ (Mein Tag) – außer am Wartezimmer-Bildschirm. */
export const startseite = (geraet: Geraet, inhaber: boolean): string => {
  if (!inhaber && geraet.rolle !== 'bildschirm') return '/employee-dashboard';
  switch (geraet.rolle) {
    case 'tresen':
      return '/shop-dashboard';
    case 'handy':
      return inhaber ? '/shop-dashboard?nur=ich' : '/employee-dashboard';
    case 'bildschirm':
      return geraet.shopId ? `/bildschirm/${geraet.shopId}` : '/shop-dashboard';
    case 'buero':
      return '/shop-profile';
  }
};

/** true beim ersten Aufruf in dieser Sitzung (danach false) */
export const ersterStart = (): boolean => {
  try {
    if (sessionStorage.getItem(START_GEPRUEFT)) return false;
    sessionStorage.setItem(START_GEPRUEFT, '1');
    return true;
  } catch {
    return false;
  }
};

/** „Später“ gilt für diese Sitzung */
export const spaeterFragen = () => {
  try {
    sessionStorage.setItem(NICHT_JETZT, '1');
  } catch {
    /* dann fragt die Seite beim nächsten Öffnen wieder */
  }
};

export const jetztFragen = (): boolean => {
  try {
    return !gespeichertesGeraet() && !sessionStorage.getItem(NICHT_JETZT);
  } catch {
    return false;
  }
};
