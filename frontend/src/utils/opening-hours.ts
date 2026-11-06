import type { BusinessHoursDay, WorkingHours } from './firestore/types';
import { merke, t } from '@/i18n';

// Liest die Namen erst beim Zugriff in der gewählten Sprache (beim Laden der Datei steht sie noch nicht fest);
// die Liste selbst bleibt deutsch, damit DAY_NAMES[d] überall ohne eigenes t() übersetzt ankommt
const uebersetzt = (namen: string[]): readonly string[] =>
  new Proxy(namen, {
    get: (ziel, schluessel, empfaenger) =>
      typeof schluessel === 'string' && /^\d+$/.test(schluessel) ? t(ziel[Number(schluessel)]) : Reflect.get(ziel, schluessel, empfaenger),
  });

/** Montag zuerst, wie man es in Deutschland liest; Werte sind dayOfWeek (0 = Sonntag) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES = uebersetzt([merke('Sonntag'), merke('Montag'), merke('Dienstag'), merke('Mittwoch'), merke('Donnerstag'), merke('Freitag'), merke('Samstag')]);
export const DAY_SHORT = uebersetzt([merke('So'), merke('Mo'), merke('Di'), merke('Mi'), merke('Do'), merke('Fr'), merke('Sa')]);

const day = (dayOfWeek: number, isOpen: boolean, openTime = '09:00', closeTime = '18:00', breaks: BusinessHoursDay['breaks'] = []): BusinessHoursDay => ({
  dayOfWeek,
  isOpen,
  openTime,
  closeTime,
  breaks,
});

/** Vorlagen zum Antippen; Friseure haben oft montags zu */
export const HOUR_PRESETS: { label: string; hours: () => BusinessHoursDay[] }[] = [
  { get label() { return t('Mo–Fr 9–18'); }, hours: () => [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, d >= 1 && d <= 5)) },
  { get label() { return t('Mo–Fr 9–18, Sa 9–14'); }, hours: () => [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 6 ? day(d, true, '09:00', '14:00') : day(d, d >= 1 && d <= 5))) },
  { get label() { return t('Di–Fr 9–18, Sa 9–14'); }, hours: () => [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 6 ? day(d, true, '09:00', '14:00') : day(d, d >= 2 && d <= 5))) },
];

export const defaultHours = (): BusinessHoursDay[] => HOUR_PRESETS[1].hours();

/** Altes Format "9:00-18:00" (gilt jeden Tag) als Tage – zum Anzeigen im Editor; null, wenn unlesbar */
export const hoursFromLegacy = (legacy?: string | null): BusinessHoursDay[] | null => {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(legacy || '');
  if (!m) return null;
  const pad = (h: string, min: string) => `${h.padStart(2, '0')}:${min}`;
  return [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, true, pad(m[1], m[2]), pad(m[3], m[4])));
};

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
  if (open.length === 0) return t('Mindestens ein Tag muss geöffnet sein.');
  for (const h of open) {
    const tag = DAY_NAMES[h.dayOfWeek];
    if (!(minutes(h.closeTime) > minutes(h.openTime))) return t('{tag}: Ende muss nach dem Beginn liegen.', { tag });
    for (const b of h.breaks ?? []) {
      const s = minutes(b.startTime);
      const e = minutes(b.endTime);
      if (!(e > s)) return t('{tag}: Die Pause muss nach ihrem Beginn enden.', { tag });
      if (s <= minutes(h.openTime) || e >= minutes(h.closeTime)) return t('{tag}: Die Pause muss innerhalb der Öffnungszeit liegen.', { tag });
    }
  }
  return null;
};

/** "09:00–12:30 · 14:00–18:00" bzw. "zu" */
export const formatDayHours = (entry?: Partial<BusinessHoursDay> | null, closed = t('zu')): string => {
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
