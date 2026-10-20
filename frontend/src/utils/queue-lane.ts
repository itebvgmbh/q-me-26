/**
 * Die Schlange einer Person an einem Tag – eine Regel für Tresen, Bildschirm, Nummernseite, "Meine Termine"
 * und die Platzsuche (booking-rules). Das Backend rechnet "Gleich bist du dran" genauso
 * (backend/app/libs/queue_notify.py) – Änderungen immer an beiden Stellen. Getestet in dev/schlange.test.mjs.
 *
 * - Wartend ist, wer den Status "scheduled" hat – bis er aufgerufen oder abgesagt wird. Die geplante Endzeit
 *   zählt nicht: Hängt der Laden hinterher, bleibt der Kunde in der Schlange. Vorher fiel er heraus, sobald
 *   seine geplante Zeit vorbei war (weg vom Tresen, vom Bildschirm, aus "Vor dir" und "Gleich dran").
 * - Reihenfolge: nach geplanter Startzeit.
 * - Belegt ist bei einer Person, wer wartet (geplante Zeit), wer dran ist (ab Aufruf, so lange wie geplant)
 *   und wer fertig ist (nur bis "Fertig"). Wer früher fertig ist, gibt den Rest seiner Zeit frei.
 * - Prognose ("ca."): Wer dran ist, ist nach seiner geplanten Dauer ab Aufruf fertig, frühestens jetzt.
 *   Die Wartenden folgen nacheinander, jeder frühestens zu seiner geplanten Zeit (nie früher als angekündigt).
 *   Gerechnet wird nur, wenn am Tresen dieser Person heute schon aufgerufen wurde – ohne Aufrufe (der Laden
 *   arbeitet nur mit Terminen und hakt nichts ab) gelten die geplanten Zeiten.
 *
 * Ohne Abhängigkeiten, damit der Test sie direkt in Node laden kann.
 */

const MIN = 60_000;
/** Ein Wartender ist fällig, wenn seine geplante Zeit höchstens so weit entfernt ist ("Nächste Nummer aufrufen") */
export const DUE_MINUTES = 15;
/** Ab so viel Verzug zeigt die "ca."-Zeit die Prognose statt der geplanten Zeit */
export const SHOW_DELAY_MINUTES = 5;

export interface LaneItem {
  id: string;
  status?: string;
  startTime?: unknown;
  endTime?: unknown;
  /** erster Aufruf (Auswertung) */
  calledAt?: unknown;
  /** letzter Aufruf – nach "zurück auf Wartet" und erneutem Aufruf */
  lastCalledAt?: unknown;
  completedAt?: unknown;
}

export interface Window {
  start: number;
  end: number;
}

/** Timestamp, Date, {seconds}, Zahl oder Text in Millisekunden; null, wenn nichts Brauchbares drinsteht */
export const toMs = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const parsed = new Date(value as string).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

export const isWaiting = (a: LaneItem): boolean => a.status === 'scheduled';

const plannedStart = (a: LaneItem) => toMs(a.startTime) ?? 0;
const plannedDuration = (a: LaneItem) => {
  const s = toMs(a.startTime);
  const e = toMs(a.endTime);
  return s !== null && e !== null && e > s ? e - s : 0;
};
const calledTime = (a: LaneItem) => toMs(a.lastCalledAt) ?? toMs(a.calledAt) ?? toMs(a.startTime);

/** Wartende nach geplanter Startzeit */
export const waitingInOrder = <T extends LaneItem>(items: T[]): T[] =>
  items.filter(isWaiting).sort((a, b) => plannedStart(a) - plannedStart(b) || a.id.localeCompare(b.id));

/**
 * Welche Zeit ein Termin bei der Person tatsächlich belegt (Platzsuche und Speichern), null = nichts.
 * Hängt nicht von der Uhr ab – damit derselbe Platz beim Suchen und beim Speichern gleich bewertet wird.
 */
export const occupiedWindow = (a: LaneItem): Window | null => {
  const start = toMs(a.startTime);
  const end = toMs(a.endTime);
  if (a.status === 'cancelled' || start === null || end === null || end <= start) return null;
  if (a.status === 'in-progress') {
    const begin = calledTime(a) ?? start;
    return { start: begin, end: begin + (end - start) };
  }
  if (a.status === 'completed') {
    const done = toMs(a.completedAt);
    if (done === null) return { start, end }; // Altbestand ohne Zeitpunkt
    // Ab geplanter Zeit bzw. früherem Aufruf bis "Fertig"; fertig vor der geplanten Zeit = nichts belegt
    const begin = Math.min(start, calledTime(a) ?? start);
    return done > begin ? { start: begin, end: done } : null;
  }
  return { start, end };
};

/** Wurde bei dieser Person heute schon aufgerufen? Nur dann rechnet die Prognose mit Verzug. */
export const laneIsRunning = (items: LaneItem[]): boolean => items.some((a) => a.status === 'in-progress' || a.status === 'completed');

/**
 * Prognose je Kunde, der dran ist oder wartet: voraussichtlicher Beginn und Ende (ms).
 * Nur für heute sinnvoll; an anderen Tagen und ohne Aufrufe kommen die geplanten Zeiten zurück.
 */
export const projectLane = (items: LaneItem[], now: number): Map<string, Window> => {
  const result = new Map<string, Window>();
  const running = laneIsRunning(items);
  let cursor = -Infinity;
  items
    .filter((a) => a.status === 'in-progress')
    .forEach((a) => {
      const begin = calledTime(a) ?? plannedStart(a);
      const end = Math.max(begin + plannedDuration(a), now); // läuft noch, also frühestens jetzt fertig
      result.set(a.id, { start: begin, end });
      cursor = Math.max(cursor, end);
    });
  waitingInOrder(items).forEach((a) => {
    const planned = plannedStart(a);
    const start = running ? Math.max(planned, cursor, now) : planned;
    const end = start + plannedDuration(a);
    result.set(a.id, { start, end });
    cursor = Math.max(cursor, end);
  });
  return result;
};

/** Verzug eines Wartenden laut Prognose in Minuten (0 = pünktlich) */
export const delayMinutes = (a: LaneItem, projection: Map<string, Window>): number => {
  const p = projection.get(a.id);
  return p ? Math.max(0, Math.round((p.start - plannedStart(a)) / MIN)) : 0;
};

/**
 * "Dran um ca." für Kunden und Bildschirm: die geplante Zeit, bei spürbarem Verzug die Prognose,
 * auf 5 Minuten aufgerundet (springt dann nicht mit jeder Minute).
 */
export const expectedStart = (a: LaneItem, projection: Map<string, Window>): Date => {
  const planned = plannedStart(a);
  const p = projection.get(a.id);
  if (!p || p.start - planned < SHOW_DELAY_MINUTES * MIN) return new Date(planned);
  const step = 5 * MIN;
  return new Date(Math.ceil(p.start / step) * step);
};

/** Ist ein Wartender jetzt dran-fähig? Sonst fragt der Tresen vor dem Aufrufen nach. */
export const isDue = (a: LaneItem, now: number): boolean => plannedStart(a) - now <= DUE_MINUTES * MIN;

/** Wie viele vor diesem Kunden dran sind oder warten (gleiche Person, gleicher Tag) */
export const aheadOf = (a: LaneItem, lane: LaneItem[]): number => {
  const mine = plannedStart(a);
  return lane.filter(
    (x) => x.id !== a.id && (x.status === 'in-progress' || (isWaiting(x) && (plannedStart(x) < mine || (plannedStart(x) === mine && x.id < a.id)))),
  ).length;
};
