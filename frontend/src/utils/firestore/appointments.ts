import { collection, doc, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { assertBookable, bookableOf } from '../booking-rules';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Appointment } from './types';
import { backendSenden, liveLesen, LiveFehlt } from '../live';
import { t } from '@/i18n';

export const getAppointmentsInRange = async (shopId: string, startDate: Date, endDate: Date, staffId?: string): Promise<Appointment[]> => {
  console.log('Getting appointments for shop:', shopId, 'between:', startDate, 'and:', endDate);
  try {
    const db = getFirestore(firebaseApp);
    const appointmentsRef = collection(db, 'appointments');

    // Create query with shopId and date range
    const q = query(
      appointmentsRef,
      where('shopId', '==', shopId),
      where('startTime', '>=', Timestamp.fromDate(startDate)),
      where('startTime', '<', Timestamp.fromDate(endDate))
    );

    const snapshot = await getDocs(q);
    // Filter by staffId in memory if provided
    let appointments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Appointment[];
    
    if (staffId) {
      appointments = appointments.filter(apt => apt.staffId === staffId);
    }

    console.log('Found appointments:', appointments);
    return appointments;
  } catch (error) {
    console.error('Error getting appointments:', error);
    return [];
  }
};

export const getTodayAppointments = async (shopId: string): Promise<Appointment[]> => {
  console.log('Getting appointments for shop:', shopId);
  try {
  const db = getFirestore(firebaseApp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Simplified query until index is created
  const appointmentsRef = collection(db, 'appointments');
  const q = query(
    appointmentsRef,
    where('shopId', '==', shopId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Appointment))
    .filter(app => {
      const startTime = app.startTime.toDate();
      return startTime >= today && startTime < tomorrow;
    });

  } catch (error) {
    console.error('Error getting appointments:', error);
    return [];
  }
};

export const getAppointmentsByCustomerId = async (customerId: string): Promise<Appointment[]> => {
  console.log('Getting appointments for customer:', customerId);
  try {
    const db = getFirestore(firebaseApp);
    const appointmentsRef = collection(db, 'appointments');
    // Simplified query until index is created
    const q = query(
      appointmentsRef,
      where('customerId', '==', customerId)
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as Appointment[];
  } catch (error) {
    console.error('Error getting appointments:', error);
    throw error;
  }
};

// Hilfsfunktion zur Überprüfung, ob ein Zeitslot verfügbar ist
export const isTimeSlotAvailable = async (
  shopId: string,
  staffId: string,
  startTime: Timestamp | Date,
  endTime: Timestamp | Date
): Promise<boolean> => {
  // Convert Date objects to Timestamp if needed
  const startTimestamp = startTime instanceof Date ? Timestamp.fromDate(startTime) : startTime;
  const endTimestamp = endTime instanceof Date ? Timestamp.fromDate(endTime) : endTime;
  
  // Additional type checking for Timestamp objects
  if (!startTimestamp || !endTimestamp) {
    console.error('Invalid timestamps provided:', { startTime, endTime });
    return false;
  }
  
  // Ensure we have proper Timestamp objects with toDate method
  if (typeof startTimestamp.toDate !== 'function' || typeof endTimestamp.toDate !== 'function') {
    console.error('Invalid timestamp format - toDate is not a function:', { 
      startTimestampType: typeof startTimestamp, 
      endTimestampType: typeof endTimestamp,
      startTimestamp,
      endTimestamp
    });
    return false;
  }
  
  console.log(`Checking if timeslot is available: ${startTimestamp.toDate().toLocaleString()} - ${endTimestamp.toDate().toLocaleString()}`);
  try {
    const db = getFirestore(firebaseApp);
    const appointmentsRef = collection(db, 'appointments');
    
    // Query für Termine, die sich mit dem gewünschten Zeitraum überschneiden
    const q = query(
      appointmentsRef,
      where('shopId', '==', shopId),
      where('staffId', '==', staffId)
    );
    
    const querySnapshot = await getDocs(q);
    const overlappingAppointments = [];
    
    console.log(`Found ${querySnapshot.size} appointments for shop ${shopId} and staff ${staffId}`);
    
    // Überprüfe alle Termine, die dem Shop und Staff gehören, auf Überschneidungen
    for (const doc of querySnapshot.docs) {
      const appointment = { id: doc.id, ...doc.data() } as Appointment;
      
      // Safety check for startTime and endTime
      if (!appointment.startTime || !appointment.endTime) {
        console.error('Missing startTime or endTime for appointment:', appointment.id);
        continue; // Skip this appointment
      }
      
      // Additional type checking for appointment timestamps
      if (typeof appointment.startTime.toDate !== 'function' || 
          typeof appointment.endTime.toDate !== 'function') {
        console.error('Invalid appointment time format:', {
          id: appointment.id, 
          startTimeType: typeof appointment.startTime,
          endTimeType: typeof appointment.endTime,
          startTime: appointment.startTime,
          endTime: appointment.endTime
        });
        continue; // Skip this appointment
      }
      
      console.log(`Checking appointment: ${appointment.id}, status: ${appointment.status}, time: ${appointment.startTime.toDate().toLocaleString()} - ${appointment.endTime.toDate().toLocaleString()}`);
      
      // Termine mit Status 'cancelled' können ignoriert werden
      if (appointment.status === 'cancelled') {
        console.log('Appointment is cancelled, ignoring');
        continue;
      }
      
      // Überprüfe die Zeitüberschneidung
      try {
        // Extra safety checks for timestamp objects
        if (!appointment.startTime || !appointment.endTime ||
            typeof appointment.startTime.toDate !== 'function' || 
            typeof appointment.endTime.toDate !== 'function') {
          console.error('Invalid timestamp format for overlap check:', appointment.id);
          continue;
        }
        
        const existingStart = appointment.startTime.toDate().getTime();
        const existingEnd = appointment.endTime.toDate().getTime();
        const newStart = startTimestamp.toDate().getTime();
        const newEnd = endTimestamp.toDate().getTime();
        
        console.log(`Comparing: New ${new Date(newStart).toLocaleTimeString()}-${new Date(newEnd).toLocaleTimeString()} vs. Existing ${new Date(existingStart).toLocaleTimeString()}-${new Date(existingEnd).toLocaleTimeString()}`);
        
        // Tolerate very small overlaps (less than a minute) since our time slots might have 1-second overlaps
        const overlapTolerance = 60000; // 1 minute in milliseconds
        
        // Check for significant overlaps
        if (
          (newStart >= existingStart && newStart < existingEnd - overlapTolerance) || // New appointment starts during existing
          (newEnd > existingStart + overlapTolerance && newEnd <= existingEnd) || // New appointment ends during existing
          (newStart <= existingStart && newEnd >= existingEnd) || // New appointment encompasses existing
          (newStart >= existingStart && newEnd <= existingEnd) // Existing appointment encompasses new
        ) {
          console.log('Overlap detected!');
          overlappingAppointments.push(appointment);
        } else {
          console.log('No overlap detected');
        }
      } catch (error) {
        console.error('Error comparing appointment times:', error, {
          appointmentId: appointment.id,
          startTimeType: typeof appointment.startTime,
          endTimeType: typeof appointment.endTime
        });
        continue; // Skip this appointment if error
      }
    }
    
    // Wenn überlappende Termine gefunden wurden, ist der Zeitslot nicht verfügbar
    if (overlappingAppointments.length > 0) {
      console.log(`Found ${overlappingAppointments.length} overlapping appointments:`, overlappingAppointments);
      return false;
    }
    
    console.log('Timeslot is available');
    return true;
  } catch (error) {
    console.error('Error checking timeslot availability:', error);
    // Im Zweifelsfall als nicht verfügbar markieren
    return false;
  }
};

// Timestamp, Date oder {seconds} einheitlich in Date umwandeln
const toDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
};

/** Freie Zeiten im Browser neu rechnen und den anderen Ansichten Bescheid sagen (wie bisher nach jeder Änderung) */
const nachDemSpeichern = async (art: 'neu' | 'geaendert', termin: Appointment, vorher?: Appointment) => {
  try {
    const { default: useTimeSlotStore } = await import('../timeSlotStore');
    const events = await import('../firebase/event-system');
    const start = toDateValue(termin.startTime);
    const alt = vorher ? toDateValue(vorher.startTime) : null;
    if (alt && vorher) useTimeSlotStore.getState().invalidateCache(vorher.shopId, alt);
    if (start) useTimeSlotStore.getState().invalidateCache(termin.shopId, start);
    if (art === 'neu' && start) {
      events.emitAppointmentCreated({
        appointmentId: termin.id,
        shopId: termin.shopId,
        staffId: termin.staffId,
        date: start.toISOString().split('T')[0],
        timeSlot: { start, end: toDateValue(termin.endTime) ?? start },
      });
    } else if (art === 'geaendert') {
      events.emitAppointmentUpdated({
        appointmentId: termin.id,
        shopId: termin.shopId,
        staffId: termin.staffId,
        originalDate: alt ?? undefined,
        newDate: start ?? undefined,
        status: termin.status,
      });
    }
  } catch (error) {
    // Zwischenspeicher und Ereignisse dürfen das Speichern nicht scheitern lassen
    console.error('Error invalidating cache or emitting event:', error);
  }
};

/**
 * Legt einen Termin an (Tresen, Kalender, Mein Tag). Die Regeln – Öffnungs- und Arbeitszeiten, Pausen, andere
 * Termine – prüft der Browser wie bisher (booking-rules.ts). Platz belegen, Tagesnummer und öffentliche Kurzfassung
 * erledigt seit Stufe 2 das Backend in einer Transaktion (POST /routes/team/termine, backend/app/libs/team_termine.py):
 * Wer zeitgleich denselben Platz will, bekommt SlotConflictError („Da ist schon ein Termin …“). Freie Zeiten im
 * Backend und „Früher dran“ stößt das Backend selbst an.
 */
export const createAppointment = async (data: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Appointment> => {
  const start = toDateValue(data.startTime);
  const end = toDateValue(data.endTime);
  if (!start || !end) {
    throw new Error(t('Ungültige Zeitangabe für den Termin.'));
  }
  if (data.status !== 'cancelled') {
    await bookableOf(data.shopId, [{ staffId: data.staffId, start, end }]);
  }
  const { termin } = await backendSenden<{ termin: Appointment }>('team/termine', {
    termin: { ...data, startTime: start, endTime: end },
  });
  await nachDemSpeichern('neu', termin);
  return termin;
};

export const updateAppointment = async (
  appointmentId: string,
  appointmentData: Partial<Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>>,
  /** notifyCustomer: Der Laden ändert – bei Absage oder neuer Zeit bekommt der Kunde Bescheid */
  options: { notifyCustomer?: boolean } = {},
): Promise<Appointment> => {
  const pfad = `team/termine/${encodeURIComponent(appointmentId)}`;
  let originalAppointment: Appointment;
  try {
    originalAppointment = (await liveLesen<{ termin: Appointment }>(pfad, true)).termin;
  } catch (error) {
    if (error instanceof LiveFehlt) throw new Error('Appointment not found for update');
    throw error;
  }

  // Ändern sich Zeit oder Person, gelten dieselben Regeln wie beim Anlegen (ohne den Termin selbst).
  // Abgesagten Termin wieder aufnehmen belegt seinen Platz neu – dieselben Regeln.
  const merged = { ...originalAppointment, ...appointmentData } as Appointment;
  const before = [toDateValue(originalAppointment.startTime)?.getTime(), toDateValue(originalAppointment.endTime)?.getTime(), originalAppointment.staffId];
  const after = [toDateValue(merged.startTime)?.getTime(), toDateValue(merged.endTime)?.getTime(), merged.staffId];
  const timeOrStaffChanged = before.some((value, i) => value !== after[i]);
  const reactivated = originalAppointment.status === 'cancelled' && merged.status !== 'cancelled';
  if ((timeOrStaffChanged || reactivated) && merged.status !== 'cancelled') {
    const start = toDateValue(merged.startTime);
    const end = toDateValue(merged.endTime);
    if (!start || !end) throw new Error(t('Ungültige Zeitangabe für den Termin.'));
    await assertBookable({ shopId: merged.shopId, staffId: merged.staffId, start, end, excludeAppointmentId: appointmentId });
  }

  // Zeitpunkte (Aufruf, Fertig), Nachricht an den Kunden, Belegung und Kurzfassung setzt das Backend in einer
  // Transaktion (POST /routes/team/termine/{id}); auch „Früher dran“ stößt es an, wo ein Platz frei wird
  const { termin: updatedAppointment } = await backendSenden<{ termin: Appointment }>(pfad, {
    aenderung: appointmentData,
    kundeBenachrichtigen: Boolean(options.notifyCustomer),
  });
  await nachDemSpeichern('geaendert', updatedAppointment, originalAppointment);
  return updatedAppointment;
};

export const getDailyRevenue = async (shopId: string): Promise<number> => {
  const appointments = await getTodayAppointments(shopId);
  return appointments
    .filter(app => app.status === 'completed')
    .reduce((sum, app) => sum + (app.price || 0), 0);
};

/**
 * Retrieves available time slots based on the provided parameters
 * @param params The parameters for retrieving available time slots
 * @returns An array of available time slots
 */
export const getAvailableTimeSlots = async (params: {
  shopId: string;
  serviceId: string;
  staffId: string;
  isAuthenticated: boolean;
}): Promise<any[]> => {
  const { shopId, serviceId, staffId, isAuthenticated } = params;
  
  try {
    // Import the timeSlotStore dynamically to avoid circular dependencies
    const { default: useTimeSlotStore } = await import('../timeSlotStore');
    
    // Use the current date as the default search date
    const currentDate = new Date();
    
    // Get time slots for today using the timeSlotStore
    const timeSlots = await useTimeSlotStore.getState().getTimeSlots(
      shopId,
      serviceId,
      staffId,
      currentDate,
      false,
      isAuthenticated
    );
    
    // Filter only available time slots
    return timeSlots.filter(slot => slot.isAvailable);
  } catch (error) {
    console.error('Error getting available time slots:', error);
    return [];
  }
};