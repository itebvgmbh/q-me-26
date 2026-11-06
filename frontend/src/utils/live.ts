import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from 'app';
import { t } from '@/i18n';

/**
 * Live-Daten vom Backend statt direkt aus Firestore (requirements/eigene-datenbank.md, Stufe 2;
 * backend/app/apis/live, backend/app/apis/team_termine, backend/app/libs/live.py).
 *
 * Eine Seite lädt ihre Daten mit einem normalen Abruf. Jede Antwort nennt ihre Kanäle, und die Seite hört per
 * Server-Sent Events auf sie. Meldet das Backend „aenderung“, lädt sie neu. Dazu kommt ein Neuladen jede Minute,
 * sobald die Seite wieder sichtbar ist und wenn das Netz zurück ist. So bleibt sie aktuell, auch wenn einmal ein
 * Hinweis verloren geht. Das ersetzt Firestores Dauerverbindung und damit die Sonderwege für Safari (utils/connection.ts).
 *
 * Pfade sind relativ zu /routes/ (z. B. "live/nummer/…", "team/termine?…"). Mit anmelden: true geht das
 * Anmelde-Token mit (Tresen, Kalender); die Ereignisse selbst brauchen keins, über sie gehen keine Daten.
 */

/** Zeitpunkt aus dem Backend ({"__zeit": "…Z"}). Verhält sich wie ein Firestore-Timestamp: toDate(), toMillis(), seconds. */
export class Zeitpunkt {
  readonly seconds: number;
  readonly nanoseconds: number;
  private readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
    this.seconds = Math.floor(ms / 1000);
    this.nanoseconds = (ms - this.seconds * 1000) * 1_000_000;
  }

  static aus(iso: string) {
    return new Zeitpunkt(Date.parse(iso));
  }

  static fromDate(d: Date) {
    return new Zeitpunkt(d.getTime());
  }

  static now() {
    return new Zeitpunkt(Date.now());
  }

  toDate() {
    return new Date(this.ms);
  }

  toMillis() {
    return this.ms;
  }

  isEqual(other: { toMillis(): number }) {
    return other.toMillis() === this.ms;
  }

  /** Vergleiche mit < und > gehen wie bei Zahlen */
  valueOf() {
    return this.ms;
  }

  toJSON() {
    return new Date(this.ms).toISOString();
  }
}

/** Antwort des Backends lesbar machen: {"__zeit": …} wird überall zum Zeitpunkt */
export const ausBackend = <T,>(wert: unknown): T => {
  if (Array.isArray(wert)) return wert.map((w) => ausBackend(w)) as T;
  if (wert && typeof wert === 'object') {
    const eintraege = Object.entries(wert as Record<string, unknown>);
    if (eintraege.length === 1 && eintraege[0][0] === '__zeit' && typeof eintraege[0][1] === 'string') {
      return Zeitpunkt.aus(eintraege[0][1]) as T;
    }
    return Object.fromEntries(eintraege.map(([k, v]) => [k, ausBackend(v)])) as T;
  }
  return wert as T;
};

/** Für Anfragen ans Backend: Zeitpunkte (Date, Firestore-Timestamp, Zeitpunkt) werden zu {"__zeit": …}, undefined fällt weg */
export const zuBackend = (wert: unknown): unknown => {
  if (wert instanceof Date) return { __zeit: wert.toISOString() };
  if (Array.isArray(wert)) return wert.map(zuBackend);
  if (wert && typeof wert === 'object') {
    const zeit = wert as { toDate?: () => Date };
    if (typeof zeit.toDate === 'function') return { __zeit: zeit.toDate().toISOString() };
    return Object.fromEntries(
      Object.entries(wert as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, zuBackend(v)]),
    );
  }
  return wert;
};

/** 404 vom Backend: Nummer, Laden oder Termin gibt es nicht */
export class LiveFehlt extends Error {}

const kopf = async (anmelden: boolean): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (anmelden) headers.Authorization = await auth.getAuthHeaderValue();
  return headers;
};

const fehlerAus = async (res: Response): Promise<Error> => {
  let detail = '';
  try {
    detail = (await res.json())?.detail;
  } catch {
    /* keine JSON-Antwort */
  }
  const text = typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status });
  const fehler = new Error(text);
  // 409: Der Platz ist inzwischen belegt – wie bisher aus der Transaktion im Browser (isSlotConflict in booking-rules.ts
  // erkennt den Namen; die Klasse selbst wird hier nicht geladen, sonst hinge Firestore an jeder Seite mit Live-Daten)
  if (res.status === 409) fehler.name = 'SlotConflictError';
  (fehler as Error & { status?: number }).status = res.status;
  return fehler;
};

export const liveLesen = async <T,>(pfad: string, anmelden = false): Promise<T> => {
  const res = await fetch(`/routes/${pfad}`, { headers: await kopf(anmelden), cache: 'no-store' });
  if (res.status === 404) throw new LiveFehlt(pfad);
  if (!res.ok) throw await fehlerAus(res);
  return ausBackend<T>(await res.json());
};

/** POST ans Backend mit Anmeldung; Zeitpunkte hin und zurück wie oben */
export const backendSenden = async <T,>(pfad: string, daten: unknown): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`/routes/${pfad}`, {
      method: 'POST',
      headers: { ...(await kopf(true)), 'Content-Type': 'application/json' },
      body: JSON.stringify(zuBackend(daten)),
    });
  } catch {
    throw new Error(t('Keine Verbindung zum Server. Bitte prüf dein Internet.'));
  }
  if (!res.ok) throw await fehlerAus(res);
  return ausBackend<T>(await res.json());
};

/** Termine eines Ladens, die in [von, bis) beginnen – nur für Inhaber und Team (backend/app/apis/team_termine) */
export const teamTerminePfad = (shopId: string, von: Date, bis: Date) =>
  `team/termine?${new URLSearchParams({ shopId, von: von.toISOString(), bis: bis.toISOString() })}`;

export const ereignisAdresse = (kanaele: string[]) =>
  `/routes/live/ereignisse?${kanaele.map((k) => `kanal=${encodeURIComponent(k)}`).join('&')}`;

/** So schnell nach einem Fehler noch einmal versuchen; danach wieder im normalen Takt */
const NEUER_VERSUCH_MS = 5_000;
/** Mehrere Hinweise kurz hintereinander (z. B. Termin und Kurzfassung): einmal neu laden */
const ENTPRELLEN_MS = 250;
/** Gerade erst geladen: das „bereit“ der frischen Verbindung braucht dann kein zweites Laden */
const FRISCH_MS = 3_000;

export interface LiveZustand<T> {
  daten: T | null;
  /** 404: gibt es nicht */
  fehlt: boolean;
  /** Der letzte Abruf hat nicht geklappt (kein Netz, Server neu gestartet); es wird weiter versucht */
  stoerung: boolean;
  neuLaden: () => void;
}

/**
 * Daten von /routes/<pfad>, live gehalten. pfad null: (noch) nichts laden. Neuer pfad: neu laden; die alten Daten
 * bleiben stehen, bis die neuen da sind (z. B. Bildschirm um Mitternacht). anmelden: mit Anmelde-Token (Team).
 */
export function useLive<T extends { kanaele?: string[] }>(
  pfad: string | null,
  { anmelden = false, neuLadenMs = 60_000 }: { anmelden?: boolean; neuLadenMs?: number } = {},
): LiveZustand<T> {
  const [daten, setDaten] = useState<T | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const [fehlversuche, setFehlversuche] = useState(0);
  const lauf = useRef(0);
  const geladenUm = useRef(0);

  const laden = useCallback(async () => {
    if (!pfad) return;
    const nr = ++lauf.current;
    try {
      const neu = await liveLesen<T>(pfad, anmelden);
      if (nr !== lauf.current) return; // ein neuerer Abruf läuft schon
      geladenUm.current = Date.now();
      setDaten(neu);
      setFehlt(false);
      setFehlversuche(0);
    } catch (e) {
      if (nr !== lauf.current) return;
      const status = (e as { status?: number } | null)?.status;
      if (e instanceof LiveFehlt) {
        setDaten(null);
        setFehlt(true);
        setFehlversuche(0);
      } else if (status === 401 || status === 403) {
        // Keine Berechtigung (z. B. aus dem Team genommen): nicht alle paar Sekunden neu fragen, der Takt reicht
        setFehlversuche(0);
      } else {
        setFehlversuche((n) => n + 1);
      }
    }
  }, [pfad, anmelden]);

  // Erst laden, dann im Takt, beim Wiederkommen und wenn das Netz zurück ist
  useEffect(() => {
    if (!pfad) return;
    setFehlt(false);
    void laden();
    const takt = window.setInterval(() => void laden(), neuLadenMs);
    const wieder = () => {
      if (document.visibilityState === 'visible') void laden();
    };
    document.addEventListener('visibilitychange', wieder);
    window.addEventListener('online', wieder);
    return () => {
      window.clearInterval(takt);
      document.removeEventListener('visibilitychange', wieder);
      window.removeEventListener('online', wieder);
    };
  }, [pfad, laden, neuLadenMs]);

  // Nach einem Fehler bald noch einmal
  useEffect(() => {
    if (fehlversuche === 0) return;
    const timer = window.setTimeout(() => void laden(), NEUER_VERSUCH_MS);
    return () => window.clearTimeout(timer);
  }, [fehlversuche, laden]);

  // Auf die Kanäle der letzten Antwort hören
  const kanaele = daten?.kanaele?.join('|') ?? '';
  useEffect(() => {
    if (!kanaele || typeof EventSource === 'undefined') return;
    let quelle: EventSource | null = null;
    let neuVerbinden: number | undefined;
    let entprellen: number | undefined;
    let zu = false;
    const anstossen = () => {
      window.clearTimeout(entprellen);
      entprellen = window.setTimeout(() => void laden(), ENTPRELLEN_MS);
    };
    const verbinden = () => {
      quelle = new EventSource(ereignisAdresse(kanaele.split('|')));
      quelle.addEventListener('aenderung', anstossen);
      // Nach jedem (Neu-)Verbinden einmal nachladen: in der Lücke kann etwas passiert sein
      quelle.addEventListener('bereit', () => {
        if (Date.now() - geladenUm.current > FRISCH_MS) anstossen();
      });
      quelle.onerror = () => {
        // Meist verbindet der Browser von selbst neu; hat der Server abgelehnt (z. B. beim Ausrollen), ist die Quelle zu
        if (!zu && quelle?.readyState === EventSource.CLOSED) {
          window.clearTimeout(neuVerbinden);
          neuVerbinden = window.setTimeout(verbinden, NEUER_VERSUCH_MS);
        }
      };
    };
    verbinden();
    return () => {
      zu = true;
      window.clearTimeout(neuVerbinden);
      window.clearTimeout(entprellen);
      quelle?.close();
    };
  }, [kanaele, laden]);

  const neuLaden = useCallback(() => void laden(), [laden]);
  return { daten, fehlt, stoerung: fehlversuche > 0, neuLaden };
}
