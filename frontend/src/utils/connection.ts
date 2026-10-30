/**
 * Verbindung zur Datenbank (Firestore) in schwierigen Netzen.
 *
 * Firestore hält eine Dauerverbindung offen. Manche WLANs (Router-Filter, Firewalls) lassen einfache
 * Abfragen durch, diese Verbindung aber nicht – dann liefert Firestore still eine leere Liste aus dem
 * Zwischenspeicher, und die App meldete "Shop nicht gefunden". Abhilfe:
 *  - Lesen über getDocFromServer/getDocsFromServer, damit ein Verbindungsfehler ein Fehler ist
 *  - bei Verbindungsfehler einmal mit einfacher Verbindungsart (Long-Polling) neu laden
 *  - klappt auch das nicht: klare Meldung mit Hinweis auf mobile Daten
 *  - Safari und alle Browser auf iPhone/iPad (dort ist jeder Browser Safari darunter) nehmen die einfache
 *    Verbindungsart gleich von Anfang an. Dort hing die Dauerverbindung ohne Fehler: Am 21.10.2026 brauchte die
 *    Nummernseite nach dem Einreihen auf einem iPhone (iOS 18.7, iCloud Private Relay) 59 Sekunden, mit ?einfach
 *    kam sie sofort. Firestores eigene Erkennung (experimentalAutoDetectLongPolling, Standard) half nicht.
 *  - Bleibt die Nummernseite trotzdem hängen (anderes Netz), lädt sie nach ein paar Sekunden mit der
 *    einfachen Verbindungsart neu (pages/Nummer.tsx).
 * Diese Datei darf nichts aus der App importieren (wird beim Start von firebase.ts gelesen).
 */

const STORAGE_KEY = 'qme-verbindung-einfach';

/** Safari (Mac, iPhone, iPad) oder ein anderer Browser auf iPhone/iPad – alle mit Safaris Technik (WebKit) */
export const isSafariEngine = (userAgent: string, platform = '', maxTouchPoints = 0): boolean => {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  // iPad in der Desktop-Ansicht meldet sich als Mac, hat aber einen Touchscreen
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true;
  // Safari auf dem Mac; Chrome, Edge, Opera und Firefox schreiben ebenfalls "Safari" in ihre Kennung
  return /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\/|Android/.test(userAgent);
};

/** Einfache Verbindungsart gewünscht: per Adresse (?einfach), nach einem Fehlschlag in diesem Tab oder in Safari */
export const simpleConnectionWanted = (): boolean => {
  try {
    return (
      new URLSearchParams(window.location.search).has('einfach') ||
      window.sessionStorage.getItem(STORAGE_KEY) === '1' ||
      isSafariEngine(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
    );
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
