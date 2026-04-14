import { collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { firestore } from '../firestore-client';
import { emitAppointmentCreated, emitAppointmentUpdated, emitAppointmentDeleted, emitTimeSlotChanged } from './event-system';

// Shop-Funktionen
export const getShopById = async (shopId: string) => {
  try {
    const shopDoc = await getDoc(doc(firestore, 'shops', shopId));
    if (!shopDoc.exists()) {
      return null;
    }
    return { id: shopDoc.id, ...shopDoc.data() };
  } catch (error) {
    console.error('Fehler beim Abrufen des Shops:', error);
    return null;
  }
};

// Mitarbeiter-Funktionen
export const getStaffById = async (staffId: string) => {
  try {
    const staffDoc = await getDoc(doc(firestore, 'staff', staffId));
    if (!staffDoc.exists()) {
      return null;
    }
    return { id: staffDoc.id, ...staffDoc.data() };
  } catch (error) {
    console.error('Fehler beim Abrufen des Mitarbeiters:', error);
    return null;
  }
};

// Service-Funktionen
export const getServiceById = async (serviceId: string) => {
  try {
    const serviceDoc = await getDoc(doc(firestore, 'services', serviceId));
    if (!serviceDoc.exists()) {
      return null;
    }
    return { id: serviceDoc.id, ...serviceDoc.data() };
  } catch (error) {
    console.error('Fehler beim Abrufen des Services:', error);
    return null;
  }
};

// Termin-Funktionen
export const createAppointment = async (appointmentData: any) => {
  try {
    console.log('Creating appointment with data:', appointmentData);
    
    // Stelle sicher, dass startTime und endTime Timestamp-Objekte sind
    let finalAppointmentData = { ...appointmentData };
    
    // Konvertiere startTime/endTime von String/Date zu Timestamp wenn nötig
    if (finalAppointmentData.startTime && !(finalAppointmentData.startTime instanceof Timestamp)) {
      if (typeof finalAppointmentData.startTime === 'string') {
        finalAppointmentData.startTime = Timestamp.fromDate(new Date(finalAppointmentData.startTime));
      } else if (finalAppointmentData.startTime instanceof Date) {
        finalAppointmentData.startTime = Timestamp.fromDate(finalAppointmentData.startTime);
      }
    }
    
    if (finalAppointmentData.endTime && !(finalAppointmentData.endTime instanceof Timestamp)) {
      if (typeof finalAppointmentData.endTime === 'string') {
        finalAppointmentData.endTime = Timestamp.fromDate(new Date(finalAppointmentData.endTime));
      } else if (finalAppointmentData.endTime instanceof Date) {
        finalAppointmentData.endTime = Timestamp.fromDate(finalAppointmentData.endTime);
      }
    }
    
    // Termin in Firestore speichern
    const appointmentRef = await addDoc(collection(firestore, 'appointments'), {
      ...finalAppointmentData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      status: finalAppointmentData.status || 'confirmed'
    });
    
    // Extrahiere Datum für Event-Payload
    let dateStr;
    try {
      if (finalAppointmentData.date) {
        dateStr = finalAppointmentData.date;
      } else if (finalAppointmentData.startTime instanceof Timestamp) {
        const startDate = finalAppointmentData.startTime.toDate();
        dateStr = startDate.toISOString().split('T')[0];
      }
    } catch (e) {
      console.warn('Konnte Datum nicht aus Termin extrahieren:', e);
      // Fallback auf aktuelles Datum
      dateStr = new Date().toISOString().split('T')[0];
    }
    
    // Event-Payload erstellen
    const eventPayload = {
      id: appointmentRef.id,
      shopId: finalAppointmentData.shopId,
      staffId: finalAppointmentData.staffId,
      customerId: finalAppointmentData.customerId,
      date: dateStr
    };
    
    // Events emittieren
    console.log('Emitting appointment events with payload:', eventPayload);
    emitAppointmentCreated(eventPayload);
    emitTimeSlotChanged(eventPayload);
    
    // Cache-Invalidierungsevent für die Zeitslot-Synchronisation
    emitCacheInvalidated({
      shopId: finalAppointmentData.shopId,
      staffId: finalAppointmentData.staffId,
      date: dateStr
    });
    
    return {
      id: appointmentRef.id,
      ...finalAppointmentData
    };
  } catch (error) {
    console.error('Fehler beim Erstellen des Termins:', error);
    throw error;
  }
};

export const updateAppointment = async (appointmentId: string, appointmentData: any) => {
  try {
    const appointmentRef = doc(firestore, 'appointments', appointmentId);
    await updateDoc(appointmentRef, {
      ...appointmentData,
      updatedAt: Timestamp.now()
    });
    
    // Extrahiere Datum für Event-Payload
    let dateStr;
    try {
      if (appointmentData.date) {
        dateStr = appointmentData.date;
      } else if (appointmentData.startTime) {
        if (appointmentData.startTime instanceof Timestamp) {
          dateStr = appointmentData.startTime.toDate().toISOString().split('T')[0];
        } else if (typeof appointmentData.startTime === 'string') {
          dateStr = new Date(appointmentData.startTime).toISOString().split('T')[0];
        } else if (appointmentData.startTime instanceof Date) {
          dateStr = appointmentData.startTime.toISOString().split('T')[0];
        }
      }
    } catch (e) {
      console.warn('Konnte Datum nicht aus Termin extrahieren:', e);
      // Fallback auf aktuelles Datum
      dateStr = new Date().toISOString().split('T')[0];
    }
    
    // Event-Payload erstellen
    const eventPayload = {
      id: appointmentId,
      shopId: appointmentData.shopId,
      staffId: appointmentData.staffId,
      date: dateStr
    };
    
    // Events emittieren
    console.log('Emitting update events with payload:', eventPayload);
    emitAppointmentUpdated(eventPayload);
    
    // Zeitslot-Änderung emittieren, wenn relevante Daten geändert wurden
    if (appointmentData.shopId || appointmentData.staffId || appointmentData.startTime) {
      emitTimeSlotChanged(eventPayload);
    }
    
    return {
      id: appointmentId,
      ...appointmentData
    };
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Termins:', error);
    throw error;
  }
};

export const deleteAppointment = async (appointmentId: string, appointmentData?: any) => {
  try {
    // Falls wir die vollständigen Termindaten haben, sollten wir sie für das Event und die Zeitslot-Aktualisierung verwenden
    let data = appointmentData;
    
    // Falls keine Daten übergeben wurden, versuchen wir, sie zu laden
    if (!data) {
      const appointmentRef = doc(firestore, 'appointments', appointmentId);
      const appointmentDoc = await getDoc(appointmentRef);
      if (appointmentDoc.exists()) {
        data = appointmentDoc.data();
      }
    }
    
    // Termin löschen
    await deleteDoc(doc(firestore, 'appointments', appointmentId));
    
    // Extrahiere Datum für Event-Payload
    let dateStr;
    try {
      if (data.date) {
        dateStr = data.date;
      } else if (data.startTime) {
        if (data.startTime instanceof Timestamp) {
          dateStr = data.startTime.toDate().toISOString().split('T')[0];
        } else if (typeof data.startTime === 'string') {
          dateStr = new Date(data.startTime).toISOString().split('T')[0];
        } else if (data.startTime instanceof Date) {
          dateStr = data.startTime.toISOString().split('T')[0];
        } else if (data.startTime.seconds) {
          dateStr = new Date(data.startTime.seconds * 1000).toISOString().split('T')[0];
        }
      }
    } catch (e) {
      console.warn('Konnte Datum nicht aus Termin extrahieren:', e);
      // Fallback auf aktuelles Datum
      dateStr = new Date().toISOString().split('T')[0];
    }
    
    // Event-Payload erstellen
    const eventPayload = {
      id: appointmentId,
      shopId: data?.shopId,
      staffId: data?.staffId,
      date: dateStr
    };
    
    // Events emittieren
    console.log('Emitting delete events with payload:', eventPayload);
    emitAppointmentDeleted(eventPayload);
    
    // Zeitslot-Änderung emittieren, wenn wir die Daten haben
    if (data && data.shopId && data.staffId) {
      emitTimeSlotChanged(eventPayload);
    }
    
    return { id: appointmentId, deleted: true };
  } catch (error) {
    console.error('Fehler beim Löschen des Termins:', error);
    throw error;
  }
};
