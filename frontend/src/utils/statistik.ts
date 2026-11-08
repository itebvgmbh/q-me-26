/**
 * Google Analytics 4 mit Einwilligung – Zugang für die App. Die Regeln (Consent Mode v2, Mess-ID, wo nie gemessen
 * wird) stehen in public/statistik.js; das lädt index.html vor der App und stellt window.dranzeitStatistik bereit.
 * Ereignisse nur über ereignis(): Ohne Einwilligung geht nichts raus. Keine personenbezogenen Daten in den Werten
 * (keine Namen, E-Mail-Adressen, Telefonnummern, Konto- oder Termin-IDs).
 */

export type CookieWahl = 'alle' | 'notwendig';

interface DranzeitStatistik {
  aus: boolean;
  wahl: () => CookieWahl | null;
  setzen: (erlaubt: boolean) => void;
  ereignis: (name: string, werte?: Record<string, string | number | boolean>) => void;
  abschalten: () => void;
}

declare global {
  interface Window {
    dranzeitStatistik?: DranzeitStatistik;
  }
}

const statistik = (): DranzeitStatistik | undefined => (typeof window === 'undefined' ? undefined : window.dranzeitStatistik);

/** Banner zeigen? Nur, wenn hier gemessen werden kann und noch nicht gewählt wurde */
export const einwilligungOffen = (): boolean => {
  const s = statistik();
  return Boolean(s && !s.aus && s.wahl() === null);
};

/** Gibt es hier überhaupt etwas einzustellen (nicht in der App aus dem Store, nicht auf dem Bildschirm)? */
export const statistikMoeglich = (): boolean => {
  const s = statistik();
  return Boolean(s && !s.aus);
};

export const einwilligungSetzen = (erlaubt: boolean) => statistik()?.setzen(erlaubt);

/** GA4-Ereignis, nur mit Einwilligung */
export const ereignis = (name: string, werte?: Record<string, string | number | boolean>) => statistik()?.ereignis(name, werte);

/** Für Flächen, die kein Besucher bedient (Wartezimmer-Bildschirm): bis zum Neuladen nichts mehr messen */
export const statistikAbschalten = () => statistik()?.abschalten();

/** „Cookie-Einstellungen“ (Fußzeile, Datenschutz) öffnet den Banner erneut */
export const COOKIE_EINSTELLUNGEN = 'dranzeit:cookie-einstellungen';
export const cookieEinstellungenOeffnen = () => window.dispatchEvent(new Event(COOKIE_EINSTELLUNGEN));
