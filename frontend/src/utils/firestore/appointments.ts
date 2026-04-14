import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, addDoc, DocumentData, updateDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Appointment } from './types';

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

export const createAppointment = async (data: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Appointment> => {
  console.log('Creating appointment with data:', data);
  try {
    const db = getFirestore(firebaseApp);
    const appointmentRef = doc(collection(db, 'appointments'));
    
    // Überprüfen, ob Termin bereits existiert, der überschneiden würde
    if (data.staffId && data.startTime && data.endTime) {
      // Ensure data.startTime and data.endTime are Timestamp objects
      const startTime = data.startTime instanceof Date ? Timestamp.fromDate(data.startTime) : data.startTime;
      const endTime = data.endTime instanceof Date ? Timestamp.fromDate(data.endTime) : data.endTime;
      
      // Additional type safety check for timestamp objects
      if (startTime && endTime && 
          typeof startTime.toDate === 'function' && 
          typeof endTime.toDate === 'function') {
          
        const isAvailable = await isTimeSlotAvailable(
          data.shopId,
          data.staffId,
          startTime,
          endTime
        );
        
        if (!isAvailable) {
          throw new Error('Zeitslot ist bereits belegt. Bitte wählen Sie eine andere Zeit.');
        }
      } else {
        console.error('Invalid timestamp format in appointment data:', {
          startTimeType: typeof startTime,
          endTimeType: typeof endTime,
          startTime,
          endTime
        });
        throw new Error('Ungültige Zeitformat für den Termin.');
      }
    }
    
    // Ensure startTime and endTime are Timestamp objects
    const processedData = { ...data };
    if (processedData.startTime instanceof Date) {
      processedData.startTime = Timestamp.fromDate(processedData.startTime);
    }
    if (processedData.endTime instanceof Date) {
      processedData.endTime = Timestamp.fromDate(processedData.endTime);
    }
    
    // Generate reference code for anonymous bookings
    if (processedData.isAnonymous) {
      processedData.referenceCode = generateReferenceCode();
    }
    
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
    
    const appointmentData = {
      id: appointmentRef.id,
      ...processedData,
      // Standardwert für type, falls nicht angegeben
      type: processedData.type || 'booked',
      // Sicherstellen, dass customerName nie undefined ist
      customerName: processedData.customerName || 'Unbekannter Kunde',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    await setDoc(appointmentRef, appointmentData);
    
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

// Hilfsfunktion zur Generierung eines eindeutigen Referenzcodes für anonyme Buchungen
function generateReferenceCode(): string {
  // 2-stelliger numerischer Code, wie gewünscht
  const min = 10; // Startwert für 2-stellige Nummern
  const max = 99; // Maximalwert für 2-stellige Nummern
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

export const cancelAppointment = async (appointmentId: string): Promise<Appointment> => {
  console.log('Cancelling appointment...', { appointmentId });
  try {
    const db = getFirestore(firebaseApp);
    const appointmentRef = doc(db, 'appointments', appointmentId);
    
    const now = Timestamp.now();
    const updateData = {
      status: 'cancelled',
      updatedAt: now
    };

    await setDoc(appointmentRef, updateData, { merge: true });
    console.log('Appointment cancelled successfully');

    // Fetch the updated document
    const updatedDoc = await getDoc(appointmentRef);
    if (!updatedDoc.exists()) {
      throw new Error('Appointment not found after cancellation');
    }

    return { id: updatedDoc.id, ...updatedDoc.data() } as Appointment;
  } catch (error) {
    console.error('Error in cancelAppointment:', error);
    throw error;
  }
};

export const updateAppointment = async (appointmentId: string, appointmentData: Partial<Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Appointment> => {
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
    
    const now = Timestamp.now();
    const updateData = {
      ...appointmentData,
      updatedAt: now
    };

    await setDoc(appointmentRef, updateData, { merge: true });
    console.log('Appointment updated successfully');

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