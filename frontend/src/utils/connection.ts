/**
 * Verbindung zum Server in schwierigen Netzen.
 *
 * Früher hielt Firestore eine Dauerverbindung offen, die manche WLANs und Safari auf dem iPhone nicht durchließen
 * (Sonderweg Long-Polling, PR #39/#40). Seit Stufe 2 (requirements/eigene-datenbank.md) liest der Browser alles über
 * normale Abrufe beim eigenen Server (utils/live.ts). Hier bleibt nur: Verbindungsfehler erkennen – damit die Seite
 * „Keine Verbindung“ sagt statt „Laden nicht gefunden“ – und für die Meldung kurz beschreiben.
 */

/** Fehler, die auf eine fehlende Verbindung hindeuten (nicht: gibt es nicht, keine Rechte) */
export const isConnectionError = (error: unknown): boolean => {
  // fetch ohne Netz: TypeError ("Failed to fetch", Safari "Load failed", Firefox "NetworkError …")
  if (error instanceof TypeError) return true;
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') return status === 0 || status === 502 || status === 503 || status === 504;
  const message = String((error as { message?: string })?.message || '');
  return /offline|failed to fetch|load failed|networkerror|keine verbindung/i.test(message);
};

/** Kurze technische Beschreibung für die Fehlermeldung (hilft bei der Fehlersuche per Bildschirmfoto) */
export const describeConnectionError = (error: unknown): string => {
  const status = (error as { status?: number })?.status;
  const code = (error as { code?: string })?.code || (typeof status === 'number' ? `http-${status}` : 'fehler');
  const message = String((error as { message?: string })?.message || error || '').replace(/\s+/g, ' ').slice(0, 160);
  return `${code}: ${message}`;
};
