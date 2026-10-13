/**
 * Verbindung zur Datenbank (Firestore) in schwierigen Netzen.
 *
 * Firestore hält eine Dauerverbindung offen. Manche WLANs (Router-Filter, Firewalls) lassen einfache
 * Abfragen durch, diese Verbindung aber nicht – dann liefert Firestore still eine leere Liste aus dem
 * Zwischenspeicher, und die App meldete "Shop nicht gefunden". Abhilfe:
 *  - Lesen über getDocFromServer/getDocsFromServer, damit ein Verbindungsfehler ein Fehler ist
 *  - bei Verbindungsfehler einmal mit einfacher Verbindungsart (Long-Polling) neu laden
 *  - klappt auch das nicht: klare Meldung mit Hinweis auf mobile Daten
 * Diese Datei darf nichts aus der App importieren (wird beim Start von firebase.ts gelesen).
 */

const STORAGE_KEY = 'qme-verbindung-einfach';

/** Einfache Verbindungsart gewünscht: per Adresse (?einfach) oder nach einem Fehlschlag in diesem Tab */
export const simpleConnectionWanted = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).has('einfach') || window.sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/** Fehler, die auf eine fehlende Verbindung zur Datenbank hindeuten (nicht: Datensatz fehlt, keine Rechte) */
export const isConnectionError = (error: unknown): boolean => {
  const code = (error as { code?: string })?.code;
  const message = String((error as { message?: string })?.message || '');
  return code === 'unavailable' || code === 'deadline-exceeded' || /offline|could not reach|failed to get document/i.test(message);
};

/** Einmal mit einfacher Verbindungsart neu laden. false, wenn das schon versucht wurde (dann Meldung zeigen). */
export const retryWithSimpleConnection = (): boolean => {
  if (simpleConnectionWanted()) return false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    return false;
  }
  window.location.reload();
  return true;
};

/** Kurze technische Beschreibung für die Fehlermeldung (hilft bei der Fehlersuche per Bildschirmfoto) */
export const describeConnectionError = (error: unknown): string => {
  const code = (error as { code?: string })?.code || 'fehler';
  const message = String((error as { message?: string })?.message || error || '').replace(/\s+/g, ' ').slice(0, 160);
  return `${code}: ${message}${simpleConnectionWanted() ? ' · einfache Verbindung' : ''}`;
};
