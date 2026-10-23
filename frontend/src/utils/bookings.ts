import { doc, getDoc, getDocs } from 'firebase/firestore';
import { firestore } from './firestore-client';
import { safelyConvertToDate } from './datetime';
import { getAppointmentsByCustomerId, getServiceByIdLegacy, getShopByOwner } from './firestore';
import type { Appointment, Service, Shop, Staff } from './firestore';
import { publicFromDoc, staffDayQuery } from './firestore/public-appointments';

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
    // Eine Schlangenposition gibt es nur am Tag selbst
    const start = safelyConvertToDate(appointment.startTime);
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    if (dayStart.getTime() !== new Date().setHours(0, 0, 0, 0)) return 0;

    // Wer heute bei derselben Person vorher dran ist und noch nicht fertig ist – auch wenn dessen
    // geplante Zeit vorbei ist (utils/queue-lane.ts). Vorher zählten auch alle alten, nie
    // abgeschlossenen Termine anderer Tage mit ("Platz 60"); der Tag ist deshalb begrenzt.
    // Die anderen Termine nur als öffentliche Kurzfassung (public-appointments.ts) – fremde Termine liest kein Kunde.
    const snapshot = await getDocs(staffDayQuery(firestore, appointment.staffId, start));
    const earlierAppointments = snapshot.docs
      .map(publicFromDoc)
      .filter(apt => apt.id !== appointment.id && start.getTime() > safelyConvertToDate(apt.startTime).getTime()
        && (apt.status === 'scheduled' || apt.status === 'in-progress'));
    
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
