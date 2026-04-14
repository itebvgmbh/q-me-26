import { useState } from 'react';
import { Timestamp, doc, collection, setDoc } from 'firebase/firestore';
import { firestore } from '../firestore-client';
import { toast } from 'sonner';
import useTimeSlotStore from '../timeSlotStore';
import { CalendarTimeSlot } from '../types';

/**
 * Hilfsfunktion zur Prüfung der Timeslot-Verfügbarkeit
 */
const checkDirectAvailability = async (
  shopId: string, 
  staffId: string, 
  serviceId: string, 
  startTime: Date, 
  endTime: Date
): Promise<boolean> => {
  // Prüfen Sie die Verfügbarkeit gegen die Firestore oder API
  if (!shopId || !staffId || !serviceId) return false;
  
  try {
    const dateStr = startTime.toISOString().split('T')[0];
    const slots = await useTimeSlotStore.getState().getTimeSlots(
      shopId,
      serviceId,
      staffId,
      startTime,
      true // Force refresh to get latest data
    );

    // Slot suchen, der mit dem ausgewählten übereinstimmt
    const matchingSlot = slots.find(slot => {
      const slotStartMs = slot.start.getTime();
      const slotEndMs = slot.end.getTime();
      const requestStartMs = startTime.getTime();
      const requestEndMs = endTime.getTime();
      
      // Toleranz von 2 Minuten für API-Rundungen
      return Math.abs(slotStartMs - requestStartMs) < 120000 && 
             Math.abs(slotEndMs - requestEndMs) < 120000 && 
             slot.isAvailable;
    });

    return !!matchingSlot;
  } catch (error) {
    console.error('Error checking timeslot availability:', error);
    return false;
  }
};

/**
 * Custom hook to handle appointment booking logic
 */
export const useAppointmentBooking = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const bookAppointment = async (
    shopId: string,
    staffId: string,
    serviceId: string,
    userId: string,
    userName: string,
    userEmail: string | null,
    selectedTimeSlot: CalendarTimeSlot,
    checkEarlierOptions: boolean
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const startTime = selectedTimeSlot.start;
      const endTime = selectedTimeSlot.end;
      
      // Check if timeslot is still available
      const isAvailable = await checkDirectAvailability(
        shopId,
        staffId,
        serviceId,
        startTime,
        endTime
      );
      
      if (!isAvailable) {
        toast.error('Dieser Zeitslot ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen Termin.');
        // Invalidate cache to refresh available slots
        useTimeSlotStore.getState().invalidateCache(shopId, startTime);
        setLoading(false);
        return { success: false, reason: 'slot-unavailable' };
      }
      
      // Create appointment
      const appointmentRef = doc(collection(firestore, 'appointments'));
      
      const appointmentData = {
        id: appointmentRef.id,
        shopId,
        staffId,
        customerId: userId,
        customerName: userName || (userEmail ? userEmail.split('@')[0] : 'Unbekannt'),
        serviceId,
        startTime: Timestamp.fromDate(startTime),
        endTime: Timestamp.fromDate(endTime),
        status: 'scheduled',
        type: 'booked',
        checkEarlierOptions,
        checkEarlierOptionsCreatedAt: checkEarlierOptions ? Timestamp.now() : undefined,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      
      await setDoc(appointmentRef, appointmentData);
      
      // Invalidate the cache
      useTimeSlotStore.getState().invalidateCache(shopId, startTime);
      
      toast.success('Termin erfolgreich gebucht');
      return { success: true, appointmentId: appointmentRef.id };
    } catch (error) {
      console.error('Error booking appointment:', error);
      setError(error instanceof Error ? error : new Error('Failed to book appointment'));
      toast.error('Fehler beim Buchen des Termins');
      return { success: false, reason: 'error' };
    } finally {
      setLoading(false);
    }
  };

  return { bookAppointment, loading, error };
};
