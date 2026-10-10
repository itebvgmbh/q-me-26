import { doc, getDoc, collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { firestore } from './firestore-client';
import { safelyConvertToDate } from './datetime';
import { getAppointmentsByCustomerId, getServiceByIdLegacy, getShopByOwner } from './firestore';
import type { Appointment, Service, Shop, Staff } from './firestore';

/**
 * Calculate queue position for an appointment
 * 
 * @param appointment The appointment to calculate position for
 * @returns The queue position number or 0 if not applicable
 */
export const calculateQueuePosition = async (appointment: Appointment): Promise<number> => {
  if (!appointment.staffId || appointment.status === 'completed' || appointment.status === 'cancelled') {
    return 0; // No position for completed or cancelled appointments
  }
  
  try {
    const appointmentsRef = collection(firestore, 'appointments');
    
    // Eine Schlangenposition gibt es nur am Tag selbst
    const start = safelyConvertToDate(appointment.startTime);
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    if (dayStart.getTime() !== new Date().setHours(0, 0, 0, 0)) return 0;

    // Wer heute bei derselben Person vorher dran ist und noch nicht fertig ist.
    // Vorher zählten auch alle alten, nie abgeschlossenen Termine mit ("Platz 60").
    const q = query(
      appointmentsRef,
      where('staffId', '==', appointment.staffId),
      where('startTime', '>=', Timestamp.fromDate(dayStart)),
      where('startTime', '<', appointment.startTime)
    );
    
    const now = Date.now();
    const snapshot = await getDocs(q);
    const earlierAppointments = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }) as Appointment)
      .filter(apt => apt.status !== 'completed' && apt.status !== 'cancelled')
      .filter(apt => !apt.endTime || safelyConvertToDate(apt.endTime).getTime() > now);
    
    return earlierAppointments.length + 1; // +1 to count from 1 instead of 0
  } catch (error) {
    console.error('Error calculating queue position:', error);
    return 0;
  }
};

/**
 * Load appointments with additional details (service, shop, staff)
 * 
 * @param userId The ID of the user to load appointments for
 * @returns An array of appointments with additional details
 */
export const loadAppointmentsWithDetails = async (userId: string) => {
  try {
    const userAppointments = await getAppointmentsByCustomerId(userId);
    
    // Load service, shop and staff details for each appointment
    const appointmentsWithDetails = await Promise.all(
      userAppointments.map(async (appointment) => {
        let service = null;
        let shop = null;
        let staff = null;
        let queuePosition = 0;
        
        if (appointment.serviceId) {
          service = await getServiceByIdLegacy(appointment.serviceId);
        }
        
        if (appointment.shopId) {
          shop = await getShopByOwner(appointment.shopId);
        }

        if (appointment.staffId) {
          const staffDoc = await getDoc(doc(firestore, 'staff', appointment.staffId));
          if (staffDoc.exists()) {
            staff = { id: staffDoc.id, ...staffDoc.data() };
          }
          
          // Calculate queue position if appointment is active
          if (appointment.status !== 'completed' && appointment.status !== 'cancelled') {
            queuePosition = await calculateQueuePosition(appointment);
          }
        }
        
        return {
          ...appointment,
          service: service || undefined,
          shop: shop || undefined,
          staff: staff || undefined,
          queuePosition: queuePosition
        };
      })
    );
    
    return appointmentsWithDetails;
  } catch (error) {
    console.error('Error loading appointments with details:', error);
    throw error;
  }
};
