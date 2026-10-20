import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, runTransaction, deleteField } from 'firebase/firestore';
import { assertBookable, SlotConflictError } from '../booking-rules';
import { freesOrWantsSlot, requestEarlierSlotCheck } from '../earlierSlots';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Appointment } from './types';
import { dayKey, pickReferenceCode, placementOf, readPlacement, shopDayRef } from './schedule';

// Gleichzeitige Buchungen derselben Person laufen nacheinander (siehe schedule.ts); bei einem Ansturm
// braucht die letzte mehrere Anläufe
const TRANSACTION_OPTIONS = { maxAttempts: 12 };

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

export const createAppointment = async (data: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Appointment> => {
  console.log('Creating appointment with data:', data);
  try {
    const db = getFirestore(firebaseApp);
    const appointmentRef = doc(collection(db, 'appointments'));
    
    // Jeder neue Termin muss die Regeln erfüllen: Öffnungszeiten, Arbeitszeiten, Pausen, andere Termine.
    // Vorher wurde hier nur auf Überschneidung mit Terminen geprüft – Pausen und Zeiten fehlten.
    // Gleichzeitige Buchungen fängt erst die Transaktion unten ab (Belegung je Person und Tag).
    const newStart = toDateValue(data.startTime);
    const newEnd = toDateValue(data.endTime);
    if (!newStart || !newEnd) {
      throw new Error('Ungültige Zeitangabe für den Termin.');
    }
    if (data.status !== 'cancelled') {
      await assertBookable({ shopId: data.shopId, staffId: data.staffId, start: newStart, end: newEnd });
    }
    
    // Ensure startTime and endTime are Timestamp objects
    const processedData = { ...data };
    if (processedData.startTime instanceof Date) {
      processedData.startTime = Timestamp.fromDate(processedData.startTime);
    }
    if (processedData.endTime instanceof Date) {
      processedData.endTime = Timestamp.fromDate(processedData.endTime);
    }
    
    // Nummer für den Aufruf: jede Nummer aus der Schlange (auch vom Tresen) und jede Buchung ohne Konto,
    // am selben Tag im selben Laden nur einmal (Wartezimmer-Bildschirm, Nummernseite). Vergeben wird sie
    // in der Transaktion über shop_days; die Termine des Tages zählen für Nummern von vor dieser Umstellung.
    const needsCode = Boolean(processedData.isAnonymous || processedData.type === 'queue');
    const codeDay = toDateValue(processedData.startTime) ?? new Date();
    const earlierCodes = needsCode ? await referenceCodesOfDay(processedData.shopId, codeDay) : [];

    // Verbessere die Namenshandhabung für Kunden - IMMER den Namen aus der user-Collection holen, wenn customerId vorhanden ist
    if (processedData.customerId && processedData.customerId !== 'walk-in') {
      try {
        console.log(`Looking up customer name for user ID: ${processedData.customerId}`);
        // Die customerId ist die uid des Users, daher direkt in der users-Collection nachschauen
        const userRef = doc(db, 'users', processedData.customerId);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          console.log(`Found user data:`, userData);
          
          // TASK QME-61: Verwende IMMER users.displayName wenn verfügbar
          // Priorität: displayName > email > customers.name > 'Unbekannter Kunde'
          if (userData.displayName) {
            processedData.customerName = userData.displayName;
            console.log(`Using displayName from users collection: ${processedData.customerName}`);
          } else if (userData.email) {
            processedData.customerName = userData.email;
            console.log(`Using email from users collection: ${processedData.customerName}`);
          } else {
            // Fallback auf vorhandenen Namen oder 'Unbekannter Kunde'
            processedData.customerName = processedData.customerName || 'Unbekannter Kunde';
            console.log(`No valid name or email found, using: ${processedData.customerName}`);
          }
          // Handynummer aus dem Profil ("Damit der Laden dich erreicht"): steht am Tresen, nach 90 Tagen gelöscht
          if (userData.phoneNumber && !processedData.customerPhone) {
            processedData.customerPhone = userData.phoneNumber;
          }
        } else {
          console.log(`No user document found for ID: ${processedData.customerId}`);
          // Fallback auf vorhandenen Namen oder 'Unbekannter Kunde'
          processedData.customerName = processedData.customerName || 'Unbekannter Kunde';
        }
      } catch (err) {
        console.error('Error fetching customer name:', err);
        // Bei Fehler den vorhandenen Namen beibehalten oder Fallback verwenden
        processedData.customerName = processedData.customerName || 'Unbekannter Kunde';
      }
    }
    
    const baseData = {
      id: appointmentRef.id,
      ...processedData,
      // Standardwert für type, falls nicht angegeben
      type: processedData.type || 'booked',
      // Sicherstellen, dass customerName nie undefined ist
      customerName: processedData.customerName || 'Unbekannter Kunde',
    };
    // Platz belegen, Nummer ziehen und Termin speichern in einem Schritt: Wer zeitgleich denselben Platz
    // will, läuft neu an und bekommt SlotConflictError ("Der Platz ist gerade weggegangen").
    const occupy = placementOf(baseData);
    const appointmentData = await runTransaction(db, async (tx) => {
      const placement = occupy ? await readPlacement(tx, db, appointmentRef.id, { shopId: baseData.shopId, occupy }) : null;
      const numbersRef = needsCode ? shopDayRef(db, baseData.shopId, codeDay) : null;
      const numbers = numbersRef ? await tx.get(numbersRef) : null;
      if (placement?.conflict) throw new SlotConflictError(placement.conflict);
      const codes: string[] = (numbers?.data()?.codes as string[]) || [];
      const referenceCode = needsCode ? pickReferenceCode(new Set([...earlierCodes, ...codes])) : undefined;
      const now = Timestamp.now();
      const created = { ...baseData, ...(referenceCode ? { referenceCode } : {}), createdAt: now, updatedAt: now };
      tx.set(appointmentRef, created);
      placement?.write();
      if (numbersRef && referenceCode) {
        tx.set(numbersRef, { shopId: baseData.shopId, day: dayKey(codeDay), codes: [...codes, referenceCode], updatedAt: now });
      }
      return created;
    }, TRANSACTION_OPTIONS);
    // Neuer Termin mit "früher benachrichtigen": gleich nach einem früheren Platz suchen
    if (appointmentData.checkEarlierOptions) requestEarlierSlotCheck(appointmentData.shopId, appointmentData.staffId);
    
    // NEUE FUNKTIONALITÄT: Cache-Invalidierung und Event-Emission
    try {
      // 1. Importiere benötigte Module dynamisch um zirkuläre Abhängigkeiten zu vermeiden
      const { default: useTimeSlotStore } = await import('../timeSlotStore');
      const { emitAppointmentCreated } = await import('../firebase/event-system');
      
      // 2. Cache für den entsprechenden Shop und das Datum invalidieren
      console.log('Invalidating timeslot cache after appointment creation...');
      if (appointmentData.startTime && typeof appointmentData.startTime.toDate === 'function') {
        const appointmentDate = appointmentData.startTime.toDate();
        useTimeSlotStore.getState().invalidateCache(appointmentData.shopId, appointmentDate);
        
        // 3. Event emittieren, damit andere Komponenten wissen, dass es eine neue Buchung gibt
        console.log('Emitting APPOINTMENT_CREATED event...');
        emitAppointmentCreated({
          appointmentId: appointmentData.id,
          shopId: appointmentData.shopId,
          staffId: appointmentData.staffId,
          date: appointmentDate.toISOString().split('T')[0],
          timeSlot: {
            start: appointmentData.startTime.toDate(),
            end: appointmentData.endTime.toDate()
          }
        });
        
        // 4. Backend über Cache-Invalidierung informieren
        try {
          const { default: brain } = await import('brain');
          console.log('Notifying backend about cache invalidation...');
          brain.get_available_timeslots({
            shop_id: appointmentData.shopId,
            service_id: "force_refresh", // Dummy service ID
            staff_id: appointmentData.staffId,
            date: appointmentDate.toISOString().split('T')[0],
            force_refresh: true
          }).catch(e => console.error('Error notifying backend of cache invalidation:', e));
        } catch (e) {
          console.error('Error importing brain client:', e);
        }
      }
    } catch (cacheError) {
      // Cache-Fehler sollten den Erfolg der Buchung nicht beeinträchtigen
      console.error('Error invalidating cache or emitting event:', cacheError);
    }
    
    return appointmentData;
  } catch (error) {
    console.error('Error creating appointment:', error);
    throw error;
  }
};

// Nummern, die an diesem Tag im Laden schon an Termine vergeben sind (auch abgesagte)
async function referenceCodesOfDay(shopId: string, day: Date): Promise<string[]> {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const todays = await getAppointmentsInRange(shopId, dayStart, dayEnd);
  return todays.map((a) => a.referenceCode).filter((c): c is string => Boolean(c));
}

export const cancelAppointment = async (appointmentId: string): Promise<Appointment> => {
  console.log('Cancelling appointment...', { appointmentId });
  try {
    const db = getFirestore(firebaseApp);
    const appointmentRef = doc(db, 'appointments', appointmentId);

    // Absagen gibt den Platz in der Belegung frei – in derselben Transaktion
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(appointmentRef);
      if (!snap.exists()) throw new Error('Appointment not found');
      const current = snap.data() as Appointment;
      const release = placementOf(current);
      const placement = release ? await readPlacement(tx, db, appointmentId, { shopId: current.shopId, release }) : null;
      tx.set(appointmentRef, { status: 'cancelled', updatedAt: Timestamp.now() }, { merge: true });
      placement?.write();
    }, TRANSACTION_OPTIONS);
    console.log('Appointment cancelled successfully');

    // Fetch the updated document
    const updatedDoc = await getDoc(appointmentRef);
    if (!updatedDoc.exists()) {
      throw new Error('Appointment not found after cancellation');
    }

    const cancelled = { id: updatedDoc.id, ...updatedDoc.data() } as Appointment;
    requestEarlierSlotCheck(cancelled.shopId, cancelled.staffId);
    return cancelled;
  } catch (error) {
    console.error('Error in cancelAppointment:', error);
    throw error;
  }
};

/**
 * Nachricht an den Kunden vormerken, wenn der Laden absagt oder die Zeit ändert. Der Benachrichtigungsdienst
 * (backend/app/libs/notify_worker.py) schickt sie per Push/E-Mail und löscht den Merker. Vergangene Tage nicht.
 */
const customerNoticeFor = (before: Appointment, after: Appointment): Record<string, unknown> | null => {
  const start = toDateValue(before.startTime);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!start || start < today || before.status === 'cancelled' || before.status === 'completed') return null;
  if (after.status === 'cancelled') return { customerNotice: 'cancelled' };
  const moved = toDateValue(after.startTime)?.getTime() !== start.getTime();
  // Merker von vorher behalten: zweimal verschieben ist eine Nachricht mit der neuesten Zeit
  return moved ? { customerNotice: 'moved', customerNoticePreviousStart: before.customerNoticePreviousStart ?? before.startTime } : null;
};

export const updateAppointment = async (
  appointmentId: string,
  appointmentData: Partial<Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>>,
  /** notifyCustomer: Der Laden ändert – bei Absage oder neuer Zeit bekommt der Kunde Bescheid */
  options: { notifyCustomer?: boolean } = {},
): Promise<Appointment> => {
  console.log('Updating appointment...', { appointmentId, appointmentData });
  try {
    const db = getFirestore(firebaseApp);
    const appointmentRef = doc(db, 'appointments', appointmentId);
    
    // First, get the original appointment data to handle cache invalidation properly
    const originalAppointmentDoc = await getDoc(appointmentRef);
    if (!originalAppointmentDoc.exists()) {
      throw new Error('Appointment not found for update');
    }
    const originalAppointment = { id: originalAppointmentDoc.id, ...originalAppointmentDoc.data() } as Appointment;
    
    // Ändern sich Zeit oder Person, gelten dieselben Regeln wie beim Anlegen (ohne den Termin selbst)
    const merged = { ...originalAppointment, ...appointmentData } as Appointment;
    const before = [toDateValue(originalAppointment.startTime)?.getTime(), toDateValue(originalAppointment.endTime)?.getTime(), originalAppointment.staffId];
    const after = [toDateValue(merged.startTime)?.getTime(), toDateValue(merged.endTime)?.getTime(), merged.staffId];
    const timeOrStaffChanged = before.some((value, i) => value !== after[i]);
    // Abgesagten Termin wieder aufnehmen belegt seinen Platz neu – dieselben Regeln
    const reactivated = originalAppointment.status === 'cancelled' && merged.status !== 'cancelled';
    const cancelling = originalAppointment.status !== 'cancelled' && merged.status === 'cancelled';
    if ((timeOrStaffChanged || reactivated) && merged.status !== 'cancelled') {
      const start = toDateValue(merged.startTime);
      const end = toDateValue(merged.endTime);
      if (!start || !end) throw new Error('Ungültige Zeitangabe für den Termin.');
      await assertBookable({ shopId: merged.shopId, staffId: merged.staffId, start, end, excludeAppointmentId: appointmentId });
    }
    
    const now = Timestamp.now();
    const updateData: Record<string, unknown> = {
      ...appointmentData,
      updatedAt: now
    };
    // Zeitpunkte für die Auswertung (Wartezeit = Nummer ziehen bis Aufruf), nur beim ersten Wechsel
    const called = appointmentData.status === 'in-progress' && originalAppointment.status !== 'in-progress';
    if (called && !originalAppointment.calledAt) {
      updateData.calledAt = now;
    }
    // Letzter Aufruf: ab hier rechnet die Schlange, wie lange er noch dran ist (utils/queue-lane.ts)
    if (called) updateData.lastCalledAt = now;
    if (appointmentData.status === 'completed' && originalAppointment.status !== 'completed') {
      updateData.completedAt = now;
      if (!originalAppointment.calledAt && !updateData.calledAt) updateData.calledAt = now;
    }
    // Zurück auf "Wartet": beim nächsten Aufruf kommt "Du bist dran" noch einmal
    if (appointmentData.status === 'scheduled' && originalAppointment.status === 'in-progress') {
      updateData.notifiedCalledAt = deleteField();
    }
    if (options.notifyCustomer) {
      const notice = customerNoticeFor(originalAppointment, merged);
      if (notice) Object.assign(updateData, notice, { customerNoticeAt: now });
    }

    if (timeOrStaffChanged || reactivated || cancelling) {
      // Platz wechselt: alten in der Belegung freigeben, neuen prüfen und belegen – in einer Transaktion
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(appointmentRef);
        if (!snap.exists()) throw new Error('Appointment not found for update');
        const current = snap.data() as Appointment;
        const release = placementOf(current);
        const occupy = placementOf({ ...current, ...appointmentData } as Appointment);
        const placement = await readPlacement(tx, db, appointmentId, { shopId: current.shopId, release, occupy });
        if (occupy && placement.conflict) throw new SlotConflictError(placement.conflict);
        tx.set(appointmentRef, updateData, { merge: true });
        placement.write();
      }, TRANSACTION_OPTIONS);
    } else {
      await setDoc(appointmentRef, updateData, { merge: true });
    }
    console.log('Appointment updated successfully');

    // "Früher dran": frei gewordenen Platz sofort neu verteilen statt bis zu 5 Minuten zu warten.
    // Auch wer früher fertig ist oder früher aufgerufen wird, gibt Zeit frei (utils/queue-lane.ts).
    const finishesEarly =
      (called && Date.now() < (toDateValue(originalAppointment.startTime)?.getTime() ?? 0)) ||
      (appointmentData.status === 'completed' &&
        originalAppointment.status !== 'completed' &&
        Date.now() < (toDateValue(originalAppointment.endTime)?.getTime() ?? 0));
    if (freesOrWantsSlot(originalAppointment, merged) || finishesEarly) {
      requestEarlierSlotCheck(originalAppointment.shopId, originalAppointment.staffId);
      if (merged.staffId && merged.staffId !== originalAppointment.staffId) requestEarlierSlotCheck(merged.shopId, merged.staffId);
    }

    // Fetch the updated document
    const updatedDoc = await getDoc(appointmentRef);
    if (!updatedDoc.exists()) {
      throw new Error('Appointment not found after update');
    }
    
    const updatedAppointment = { id: updatedDoc.id, ...updatedDoc.data() } as Appointment;
    
    // Cache invalidation and event emission
    try {
      // Handle cache invalidation for both the old and new dates if times changed
      if (appointmentData.startTime || appointmentData.status === 'cancelled') {
        // 1. Dynamically import modules to avoid circular dependencies
        const { default: useTimeSlotStore } = await import('../timeSlotStore');
        const { emitAppointmentUpdated } = await import('../firebase/event-system');
        
        console.log('Invalidating timeslot cache after appointment update...');
        
        // 2. Invalidate cache for the original appointment date
        if (originalAppointment.startTime && typeof originalAppointment.startTime.toDate === 'function') {
          const originalDate = originalAppointment.startTime.toDate();
          useTimeSlotStore.getState().invalidateCache(originalAppointment.shopId, originalDate);
          
          // Also notify backend about invalidation
          try {
            const { default: brain } = await import('brain');
            console.log('Notifying backend about original date cache invalidation...');
            brain.get_available_timeslots({
              shop_id: originalAppointment.shopId,
              service_id: "force_refresh",
              staff_id: originalAppointment.staffId,
              date: originalDate.toISOString(),
              force_refresh: true
            }).catch(e => console.error('Error notifying backend of original date cache invalidation:', e));
          } catch (e) {
            console.error('Error importing brain client for original date:', e);
          }
        }
        
        // 3. If appointment time changed, also invalidate cache for the new date
        if (appointmentData.startTime && 
            originalAppointment.startTime && 
            appointmentData.startTime !== originalAppointment.startTime) {
          
          const newStartTime = appointmentData.startTime instanceof Date ? 
            appointmentData.startTime : 
            appointmentData.startTime.toDate();
            
          useTimeSlotStore.getState().invalidateCache(updatedAppointment.shopId, newStartTime);
          
          // Also notify backend about new date invalidation
          try {
            const { default: brain } = await import('brain');
            console.log('Notifying backend about new date cache invalidation...');
            brain.get_available_timeslots({
              shop_id: updatedAppointment.shopId,
              service_id: "force_refresh",
              staff_id: updatedAppointment.staffId,
              date: newStartTime.toISOString(),
              force_refresh: true
            }).catch(e => console.error('Error notifying backend of new date cache invalidation:', e));
          } catch (e) {
            console.error('Error importing brain client for new date:', e);
          }
        }
        
        // 4. Emit event for appointment update
        console.log('Emitting APPOINTMENT_UPDATED event...');
        emitAppointmentUpdated({
          appointmentId: updatedAppointment.id,
          shopId: updatedAppointment.shopId,
          staffId: updatedAppointment.staffId,
          originalDate: originalAppointment.startTime?.toDate(),
          newDate: updatedAppointment.startTime?.toDate(),
          status: updatedAppointment.status
        });
      }
    } catch (cacheError) {
      // Cache errors should not affect the appointment update success
      console.error('Error invalidating cache or emitting event during update:', cacheError);
    }

    return updatedAppointment;
  } catch (error) {
    console.error('Error in updateAppointment:', error);
    throw error;
  }
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