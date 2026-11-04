import type { Timestamp } from 'firebase/firestore';
import { backendSenden, liveLesen } from '../live';
import type { RecurringBreak } from './recurring-breaks';

/**
 * Einzelne Pausen über das Backend (requirements/eigene-datenbank.md, Stufe 2; backend/app/apis/pausen,
 * backend/app/libs/pausen.py). Lesen ist öffentlich (freie Plätze), pflegen darf nur der Inhaber – wie bisher in
 * firestore.rules. Nach jeder Änderung rechnet das Backend die freien Zeiten des Tages neu.
 */
export interface Break {
  id: string;
  shopId: string;
  staffId: string;
  date: Timestamp; // Das Datum der Pause
  startTime: Timestamp;
  endTime: Timestamp;
  type?: string; // Optional: Art der Pause (Mittagspause, kurze Pause, etc.)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Einzelne und feste Pausen einer Person in einem Abruf (Pausenverwaltung, Kalender, booking-rules.ts) */
export const getStaffBreaks = (staffId: string) =>
  liveLesen<{ einzeln: Break[]; fest: RecurringBreak[] }>(`live/person/${encodeURIComponent(staffId)}/pausen`);

const alsDatum = (wert: unknown): Date | null =>
  wert && typeof (wert as { toDate?: () => Date }).toDate === 'function' ? (wert as { toDate: () => Date }).toDate() : wert instanceof Date ? wert : null;

// Alle Pausen eines Mitarbeiters für einen bestimmten Tag
export const getBreaksByStaffAndDate = async (staffId: string, date: Date): Promise<Break[]> => {
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const { einzeln } = await getStaffBreaks(staffId);
    // Wie die frühere Abfrage auf date: nur Einträge mit einem Zeitpunkt an diesem Tag
    return einzeln.filter((b) => {
      const tag = alsDatum(b.date);
      return tag !== null && tag >= startOfDay && tag <= endOfDay;
    });
  } catch (error) {
    console.error('Error getting breaks:', error);
    return [];
  }
};

export const createBreak = async (breakData: Omit<Break, 'id' | 'createdAt' | 'updatedAt'>): Promise<Break> =>
  (await backendSenden<{ pause: Break }>('team/pausen', { pause: breakData })).pause;

export const updateBreak = async (breakId: string, breakData: Partial<Omit<Break, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Break> =>
  (await backendSenden<{ pause: Break }>(`team/pausen/${encodeURIComponent(breakId)}`, { aenderung: breakData })).pause;

export const deleteBreak = async (breakId: string): Promise<void> => {
  await backendSenden(`team/pausen/${encodeURIComponent(breakId)}/loeschen`, {});
};

// Überschneidet sich eine neue Pause mit einer anderen am selben Tag?
export const checkBreakConflicts = async (
  staffId: string,
  startTime: Timestamp | Date,
  endTime: Timestamp | Date,
  excludeBreakId?: string,
): Promise<boolean> => {
  try {
    const startDate = alsDatum(startTime);
    const endDate = alsDatum(endTime);
    if (!startDate || !endDate) return true;
    const date = new Date(startDate);
    date.setHours(0, 0, 0, 0);
    const breaks = await getBreaksByStaffAndDate(staffId, date);
    for (const breakItem of breaks) {
      if (excludeBreakId && breakItem.id === excludeBreakId) continue;
      const breakStart = alsDatum(breakItem.startTime);
      const breakEnd = alsDatum(breakItem.endTime);
      if (!breakStart || !breakEnd) continue; // alte Einträge mit Zeiten als Text
      if (
        (startDate >= breakStart && startDate < breakEnd) || // Neue Pause beginnt während bestehender Pause
        (endDate > breakStart && endDate <= breakEnd) || // Neue Pause endet während bestehender Pause
        (startDate <= breakStart && endDate >= breakEnd) // Neue Pause umfasst bestehende Pause vollständig
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking break conflicts:', error);
    return true; // Im Fehlerfall sicherheitshalber als Konflikt behandeln
  }
};
