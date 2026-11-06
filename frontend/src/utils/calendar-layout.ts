/**
 * Rechnungen für den Kalender am Tresen (components/counter/CounterCalendar.tsx): sichtbare Stunden,
 * Termine nebeneinander, Ziehen und Klicken. Zeiten in Minuten seit Mitternacht (Ortszeit des Ladens).
 * Ohne Abhängigkeiten, damit der Test sie direkt in Node laden kann: node --experimental-strip-types dev/kalender.test.mjs
 */

export interface Span {
  start: number;
  end: number;
}

/** Minute des Tages eines Zeitpunkts */
export const minuteOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

/** Zeitpunkt an einer Minute des Tages (über 24 Uhr hinaus zählt der nächste Tag) */
export const atMinute = (day: Date, minute: number): Date => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute);

/** Montag bis Sonntag der Woche, in der day liegt */
export const weekDays = (day: Date): Date[] => {
  const offset = (day.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset + i));
};

/** Sichtbare volle Stunden: alle buchbaren Fenster und Termine; ohne beides 9–18 Uhr */
export const visibleHours = (spans: Span[]): { first: number; last: number } => {
  const valid = spans.filter((s) => s.end > s.start);
  if (!valid.length) return { first: 9, last: 18 };
  const first = Math.max(0, Math.floor(Math.min(...valid.map((s) => s.start)) / 60));
  const last = Math.min(24, Math.ceil(Math.max(...valid.map((s) => s.end)) / 60));
  return { first, last: Math.max(last, first + 1) };
};

/**
 * Überschneidende Termine einer Spalte nebeneinander: Spur je Termin und Zahl der Spuren seiner Gruppe.
 * Eine Gruppe sind Termine, die sich (auch über andere) überschneiden; jeder nimmt die erste freie Spur.
 */
export const sideBySide = <T extends Span & { id: string }>(items: T[]): Map<string, { lane: number; lanes: number }> => {
  const result = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = 0;
  const close = () => {
    group.forEach(({ id, lane }) => result.set(id, { lane, lanes: laneEnds.length }));
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) close();
    if (!group.length) groupEnd = item.end;
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.push(item.end) - 1;
    else laneEnds[lane] = item.end;
    group.push({ id: item.id, lane });
    groupEnd = Math.max(groupEnd, item.end);
  }
  close();
  return result;
};

/** Beginn nach dem Ziehen um deltaMinutes, auf step Minuten gerundet und im Tag gehalten */
export const movedStart = (start: number, duration: number, deltaMinutes: number, step = 5): number => {
  const snapped = Math.round((start + deltaMinutes) / step) * step;
  return Math.min(Math.max(snapped, 0), Math.max(0, 24 * 60 - duration));
};

/** Minute an einer Stelle im Raster (Pixel ab Rasterbeginn), abgerundet auf step – für "in freie Zeit klicken" */
export const minuteAt = (y: number, firstHour: number, pxPerMinute: number, step = 15): number =>
  firstHour * 60 + Math.floor(Math.max(0, y) / pxPerMinute / step) * step;
