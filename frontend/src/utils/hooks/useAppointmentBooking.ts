import { useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { createAppointment } from '../firestore';
import { assertOnlineLead, isSlotConflict } from '../booking-rules';
import { toast } from 'sonner';
import useTimeSlotStore from '../timeSlotStore';
import { CalendarTimeSlot } from '../types';

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
      
      // Vorlaufzeit des Ladens für Online-Termine (Mein Laden → Bearbeiten)
      await assertOnlineLead(shopId, startTime);
      // Speichern über createAppointment: prüft Öffnungs- und Arbeitszeiten, Pausen und andere Termine.
      // Vorher wurde direkt geschrieben und nur gegen die (zwischengespeicherte) Slot-Liste geprüft.
      const created = await createAppointment({
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
        ...(checkEarlierOptions ? { checkEarlierOptionsCreatedAt: Timestamp.now() } : {}),
      });
      
      // Invalidate the cache
      useTimeSlotStore.getState().invalidateCache(shopId, startTime);
      
      toast.success('Dein Termin ist gebucht.');
      return { success: true, appointmentId: created.id };
    } catch (error) {
      console.error('Error booking appointment:', error);
      setError(error instanceof Error ? error : new Error('Failed to book appointment'));
      if (isSlotConflict(error)) {
        // Platz inzwischen vergeben oder nicht (mehr) buchbar – Liste neu laden lassen
        useTimeSlotStore.getState().invalidateCache(shopId, selectedTimeSlot.start);
        toast.error(`Diese Uhrzeit geht leider nicht: ${error.message} Such dir bitte eine andere aus.`);
        return { success: false, reason: 'slot-unavailable' };
      }
      toast.error('Der Termin konnte nicht gebucht werden. Versuch es noch einmal.');
      return { success: false, reason: 'error' };
    } finally {
      setLoading(false);
    }
  };

  return { bookAppointment, loading, error };
};
