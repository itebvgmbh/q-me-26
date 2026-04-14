import { collection, addDoc, updateDoc, doc, Timestamp, query, where, getDocs, deleteDoc, getDoc } from 'firebase/firestore';
import { firestore as db } from '../firestore-client';
import { Staff } from './types';

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

export const createRecurringBreak = async (breakData: Omit<RecurringBreak, 'id' | 'createdAt' | 'updatedAt'>): Promise<RecurringBreak> => {
  try {
    const now = Timestamp.now();
    const newBreakData = {
      ...breakData,
      createdAt: now,
      updatedAt: now
    };
    
    const docRef = await addDoc(collection(db, 'recurring-breaks'), newBreakData);
    return {
      id: docRef.id,
      ...newBreakData
    } as RecurringBreak;
  } catch (error) {
    console.error('Error creating recurring break:', error);
    throw error;
  }
};

export const updateRecurringBreak = async (breakId: string, breakData: Partial<Omit<RecurringBreak, 'id' | 'createdAt' | 'updatedAt'>>): Promise<RecurringBreak> => {
  try {
    const breakRef = doc(db, 'recurring-breaks', breakId);
    const updateData = {
      ...breakData,
      updatedAt: Timestamp.now()
    };
    
    await updateDoc(breakRef, updateData);
    const updatedDoc = await getDoc(breakRef);
    
    return {
      id: updatedDoc.id,
      ...updatedDoc.data()
    } as RecurringBreak;
  } catch (error) {
    console.error('Error updating recurring break:', error);
    throw error;
  }
};

export const deleteRecurringBreak = async (breakId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'recurring-breaks', breakId));
  } catch (error) {
    console.error('Error deleting recurring break:', error);
    throw error;
  }
};

export const getRecurringBreaksByStaff = async (staffId: string): Promise<RecurringBreak[]> => {
  try {
    const breaksQuery = query(
      collection(db, 'recurring-breaks'),
      where('staffId', '==', staffId)
    );
    
    const querySnapshot = await getDocs(breaksQuery);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as RecurringBreak[];
  } catch (error) {
    console.error('Error getting recurring breaks:', error);
    return [];
  }
};

export const getRecurringBreaksByStaffAndDay = async (staffId: string, dayOfWeek: number): Promise<RecurringBreak[]> => {
  try {
    const breaksQuery = query(
      collection(db, 'recurring-breaks'),
      where('staffId', '==', staffId),
      where('dayOfWeek', '==', dayOfWeek),
      where('active', '==', true)
    );
    
    const querySnapshot = await getDocs(breaksQuery);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as RecurringBreak[];
  } catch (error) {
    console.error('Error getting recurring breaks for day:', error);
    return [];
  }
};

// Überprüfen auf Überschneidungen mit anderen Pausen am selben Wochentag
export const checkRecurringBreakConflicts = async (
  staffId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeBreakId?: string
): Promise<boolean> => {
  try {
    const breaks = await getRecurringBreaksByStaffAndDay(staffId, dayOfWeek);
    
    // Konvertiere Zeiten zum Vergleich
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    const newStartMinutes = startHour * 60 + startMinute;
    const newEndMinutes = endHour * 60 + endMinute;
    
    // Überprüfe auf Überschneidungen
    for (const breakItem of breaks) {
      // Überspringe die aktuell bearbeitete Pause
      if (excludeBreakId && breakItem.id === excludeBreakId) {
        continue;
      }
      
      const [existingStartHour, existingStartMinute] = breakItem.startTime.split(':').map(Number);
      const [existingEndHour, existingEndMinute] = breakItem.endTime.split(':').map(Number);
      
      const existingStartMinutes = existingStartHour * 60 + existingStartMinute;
      const existingEndMinutes = existingEndHour * 60 + existingEndMinute;
      
      // Prüfe auf Überschneidungen
      if (
        (newStartMinutes >= existingStartMinutes && newStartMinutes < existingEndMinutes) || // Neue Pause beginnt während bestehender Pause
        (newEndMinutes > existingStartMinutes && newEndMinutes <= existingEndMinutes) || // Neue Pause endet während bestehender Pause
        (newStartMinutes <= existingStartMinutes && newEndMinutes >= existingEndMinutes) // Neue Pause umspannt bestehende Pause vollständig
      ) {
        return true; // Überschneidung gefunden
      }
    }
    
    return false; // Keine Überschneidung
  } catch (error) {
    console.error('Error checking recurring break conflicts:', error);
    return true; // Im Fehlerfall sicherheitshalber als Konflikt behandeln
  }
};
