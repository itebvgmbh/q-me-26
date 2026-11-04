import type { Timestamp } from 'firebase/firestore';
import { backendSenden } from '../live';
import { getStaffBreaks } from './breaks';

/**
 * Feste Pausen (je Wochentag) über das Backend (requirements/eigene-datenbank.md, Stufe 2; backend/app/apis/pausen).
 * Lesen öffentlich, pflegen nur der Inhaber; nach jeder Änderung rechnet das Backend die freien Zeiten aller Tage neu.
 */
export interface RecurringBreak {
  id: string;
  shopId: string;
  staffId: string;
  dayOfWeek: number; // 0 = Sonntag, 1 = Montag, ... 6 = Samstag
  startTime: string; // Format: "HH:mm"
  endTime: string; // Format: "HH:mm"
  type?: 'lunch' | 'coffee' | 'personal' | 'other'; // Typ der Pause
  active: boolean; // Ist die Pause aktiv?
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export const createRecurringBreak = async (breakData: Omit<RecurringBreak, 'id' | 'createdAt' | 'updatedAt'>): Promise<RecurringBreak> =>
  (await backendSenden<{ pause: RecurringBreak }>('team/feste-pausen', { pause: breakData })).pause;

export const updateRecurringBreak = async (breakId: string, breakData: Partial<Omit<RecurringBreak, 'id' | 'createdAt' | 'updatedAt'>>): Promise<RecurringBreak> =>
  (await backendSenden<{ pause: RecurringBreak }>(`team/feste-pausen/${encodeURIComponent(breakId)}`, { aenderung: breakData })).pause;

export const deleteRecurringBreak = async (breakId: string): Promise<void> => {
  await backendSenden(`team/feste-pausen/${encodeURIComponent(breakId)}/loeschen`, {});
};

export const getRecurringBreaksByStaff = async (staffId: string): Promise<RecurringBreak[]> => {
  try {
    return (await getStaffBreaks(staffId)).fest;
  } catch (error) {
    console.error('Error getting recurring breaks:', error);
    return [];
  }
};

/** Aktive feste Pausen einer Person an einem Wochentag */
export const getRecurringBreaksByStaffAndDay = async (staffId: string, dayOfWeek: number): Promise<RecurringBreak[]> =>
  (await getRecurringBreaksByStaff(staffId)).filter((b) => b.dayOfWeek === dayOfWeek && b.active === true);

// Überprüfen auf Überschneidungen mit anderen Pausen am selben Wochentag
export const checkRecurringBreakConflicts = async (
  staffId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeBreakId?: string,
): Promise<boolean> => {
  try {
    const breaks = await getRecurringBreaksByStaffAndDay(staffId, dayOfWeek);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    const newStartMinutes = startHour * 60 + startMinute;
    const newEndMinutes = endHour * 60 + endMinute;
    for (const breakItem of breaks) {
      if (excludeBreakId && breakItem.id === excludeBreakId) continue;
      const [existingStartHour, existingStartMinute] = breakItem.startTime.split(':').map(Number);
      const [existingEndHour, existingEndMinute] = breakItem.endTime.split(':').map(Number);
      const existingStartMinutes = existingStartHour * 60 + existingStartMinute;
      const existingEndMinutes = existingEndHour * 60 + existingEndMinute;
      if (
        (newStartMinutes >= existingStartMinutes && newStartMinutes < existingEndMinutes) ||
        (newEndMinutes > existingStartMinutes && newEndMinutes <= existingEndMinutes) ||
        (newStartMinutes <= existingStartMinutes && newEndMinutes >= existingEndMinutes)
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking recurring break conflicts:', error);
    return true; // Im Fehlerfall sicherheitshalber als Konflikt behandeln
  }
};
