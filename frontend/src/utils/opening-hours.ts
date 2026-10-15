import type { BusinessHoursDay, WorkingHours } from './firestore/types';

/** Montag zuerst, wie man es in Deutschland liest; Werte sind dayOfWeek (0 = Sonntag) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const DAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const day = (dayOfWeek: number, isOpen: boolean, openTime = '09:00', closeTime = '18:00', breaks: BusinessHoursDay['breaks'] = []): BusinessHoursDay => ({
  dayOfWeek,
  isOpen,
  openTime,
  closeTime,
  breaks,
});

/** Vorlagen zum Antippen; Friseure haben oft montags zu */
export const HOUR_PRESETS: { label: string; hours: () => BusinessHoursDay[] }[] = [
  { label: 'Mo–Fr 9–18', hours: () => [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, d >= 1 && d <= 5)) },
  { label: 'Mo–Fr 9–18, Sa 9–14', hours: () => [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 6 ? day(d, true, '09:00', '14:00') : day(d, d >= 1 && d <= 5))) },
  { label: 'Di–Fr 9–18, Sa 9–14', hours: () => [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 6 ? day(d, true, '09:00', '14:00') : day(d, d >= 2 && d <= 5))) },
];

export const defaultHours = (): BusinessHoursDay[] => HOUR_PRESETS[1].hours();

/** Immer alle sieben Tage, sortiert nach dayOfWeek – fehlende Tage gelten als geschlossen */
export const normalizeHours = (hours: BusinessHoursDay[] | undefined | null): BusinessHoursDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const entry = hours?.find((h) => Number(h.dayOfWeek) === d);
    return entry ? { ...entry, dayOfWeek: d, breaks: entry.breaks ?? [] } : day(d, false);
  });

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Fehler in den Öffnungszeiten als Text, sonst null */
export const hoursProblem = (hours: BusinessHoursDay[]): string | null => {
  const open = hours.filter((h) => h.isOpen);
  if (open.length === 0) return 'Mindestens ein Tag muss geöffnet sein.';
  for (const h of open) {
    const name = DAY_NAMES[h.dayOfWeek];
    if (!(minutes(h.closeTime) > minutes(h.openTime))) return `${name}: Ende muss nach dem Beginn liegen.`;
    for (const b of h.breaks ?? []) {
      const s = minutes(b.startTime);
      const e = minutes(b.endTime);
      if (!(e > s)) return `${name}: Die Pause muss nach ihrem Beginn enden.`;
      if (s <= minutes(h.openTime) || e >= minutes(h.closeTime)) return `${name}: Die Pause muss innerhalb der Öffnungszeit liegen.`;
    }
  }
  return null;
};

/** "09:00–12:30 · 14:00–18:00" bzw. "zu" */
export const formatDayHours = (entry?: Partial<BusinessHoursDay> | null, closed = 'zu'): string => {
  if (!entry?.isOpen) return closed;
  const parts: string[] = [];
  let start = entry.openTime || '';
  for (const b of [...(entry.breaks ?? [])].sort((a, z) => minutes(a.startTime) - minutes(z.startTime))) {
    parts.push(`${start}–${b.startTime}`);
    start = b.endTime;
  }
  parts.push(`${start}–${entry.closeTime || ''}`);
  return parts.join(' · ');
};

/** Arbeitszeiten einer Person = Öffnungszeiten, nur an den gewählten Tagen */
export const workingHoursFromOpening = (hours: BusinessHoursDay[], days?: number[]): WorkingHours[] =>
  normalizeHours(hours).map((h) => ({
    dayOfWeek: h.dayOfWeek,
    startTime: h.openTime,
    endTime: h.closeTime,
    isWorking: h.isOpen && (!days || days.includes(h.dayOfWeek)),
  }));
