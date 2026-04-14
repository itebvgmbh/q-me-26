import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, deleteDoc, addDoc, DocumentData } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';

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

// Funktion zum Abrufen aller Pausen eines Mitarbeiters für einen bestimmten Tag
export const getBreaksByStaffAndDate = async (staffId: string, date: Date): Promise<Break[]> => {
  try {
    const db = getFirestore(firebaseApp);
    const breaksRef = collection(db, 'breaks');
    
    // Datum auf den Beginn des Tages setzen
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    // Datum auf das Ende des Tages setzen
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Abfrage erstellen
    const q = query(
      breaksRef,
      where('staffId', '==', staffId),
      where('date', '>=', Timestamp.fromDate(startOfDay)),
      where('date', '<=', Timestamp.fromDate(endOfDay))
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Break[];
  } catch (error) {
    console.error('Error getting breaks:', error);
    return [];
  }
};

// Funktion zum Erstellen einer neuen Pause
export const createBreak = async (breakData: Omit<Break, 'id' | 'createdAt' | 'updatedAt'>): Promise<Break> => {
  try {
    const db = getFirestore(firebaseApp);
    const breakRef = doc(collection(db, 'breaks'));
    
    const now = Timestamp.now();
    const newBreakData = {
      id: breakRef.id,
      ...breakData,
      createdAt: now,
      updatedAt: now
    };
    
    await setDoc(breakRef, newBreakData);
    return newBreakData as Break;
  } catch (error) {
    console.error('Error creating break:', error);
    throw error;
  }
};

// Funktion zum Aktualisieren einer Pause
export const updateBreak = async (
  breakId: string, 
  breakData: Partial<Omit<Break, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Break> => {
  try {
    const db = getFirestore(firebaseApp);
    const breakRef = doc(db, 'breaks', breakId);
    
    const updateData = {
      ...breakData,
      updatedAt: Timestamp.now()
    };
    
    await setDoc(breakRef, updateData, { merge: true });
    
    // Holen des aktualisierten Dokuments
    const updatedDoc = await getDoc(breakRef);
    return { id: updatedDoc.id, ...updatedDoc.data() } as Break;
  } catch (error) {
    console.error('Error updating break:', error);
    throw error;
  }
};

// Funktion zum Löschen einer Pause
export const deleteBreak = async (breakId: string): Promise<void> => {
  try {
    const db = getFirestore(firebaseApp);
    const breakRef = doc(db, 'breaks', breakId);
    await deleteDoc(breakRef);
  } catch (error) {
    console.error('Error deleting break:', error);
    throw error;
  }
};

// Funktion zum Überprüfen von Pausenüberschneidungen
export const checkBreakConflicts = async (
  staffId: string, 
  startTime: Timestamp | Date, 
  endTime: Timestamp | Date,
  excludeBreakId?: string
): Promise<boolean> => {
  try {
    // Konvertieren zu Date, falls Timestamp
    const startDate = startTime instanceof Timestamp ? startTime.toDate() : startTime;
    const endDate = endTime instanceof Timestamp ? endTime.toDate() : endTime;
    
    // Datum für die Abfrage (nur das Datum, ohne Uhrzeit)
    const date = new Date(startDate);
    date.setHours(0, 0, 0, 0);
    
    // Alle Pausen des Mitarbeiters für diesen Tag abrufen
    const breaks = await getBreaksByStaffAndDate(staffId, date);
    
    // Überprüfen auf Überschneidungen
    for (const breakItem of breaks) {
      // Aktuelle Pause ausschließen, wenn eine ID angegeben wurde
      if (excludeBreakId && breakItem.id === excludeBreakId) continue;
      
      const breakStart = breakItem.startTime.toDate();
      const breakEnd = breakItem.endTime.toDate();
      
      // Prüfen auf Überschneidung
      if (
        (startDate >= breakStart && startDate < breakEnd) || // Neue Pause beginnt während bestehender Pause
        (endDate > breakStart && endDate <= breakEnd) || // Neue Pause endet während bestehender Pause
        (startDate <= breakStart && endDate >= breakEnd) // Neue Pause umfasst bestehende Pause vollständig
      ) {
        return true; // Überschneidung gefunden
      }
    }
    
    return false; // Keine Überschneidung gefunden
  } catch (error) {
    console.error('Error checking break conflicts:', error);
    return true; // Im Fehlerfall sicherheitshalber als Konflikt behandeln
  }
};
