import { useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { createAppointment } from '../firestore';
import { assertOnlineLead, isSlotConflict } from '../booking-rules';
import { toast } from 'sonner';
import { sprache, t } from '@/i18n';
import useTimeSlotStore from '../timeSlotStore';
import { CalendarTimeSlot } from '../types';
import { announceToTeam } from '../team-push';

/**
 * Custom hook to handle appointment booking logic
 */
export const useAppointmentBooking = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /** staffIds: die gewählte Person – bei „Egal wer“ alle, die zur Zeit frei sind; ist eine inzwischen belegt, kommt die nächste dran */
  const bookAppointment = async (
    shopId: string,
    staffIds: string[],
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
      const create = (staffId: string) =>
        createAppointment({
          shopId,
          staffId,
          customerId: userId,
          customerName: userName || (userEmail ? userEmail.split('@')[0] : 'Unbekannt'),
          serviceId,
          startTime: Timestamp.fromDate(startTime),
          endTime: Timestamp.fromDate(endTime),
          status: 'scheduled',
          type: 'booked',
          // Erinnerung, Absage und „Früher dran“ kommen in dieser Sprache (backend/app/i18n)
          language: sprache(),
          checkEarlierOptions,
          ...(checkEarlierOptions ? { checkEarlierOptionsCreatedAt: Timestamp.now() } : {}),
        });
      let created: Awaited<ReturnType<typeof create>> | null = null;
      for (const [index, staffId] of staffIds.entries()) {
        try {
          created = await create(staffId);
          break;
        } catch (attempt) {
          if (!isSlotConflict(attempt) || index === staffIds.length - 1) throw attempt;
        }
      }
      if (!created) throw new Error('Keine Person zum Buchen');
      // Inhaber und gebuchte Person bekommen Bescheid
      announceToTeam(created.id, 'new');

      // Invalidate the cache
      useTimeSlotStore.getState().invalidateCache(shopId, startTime);
      
      toast.success(t('Dein Termin ist gebucht.'));
      return { success: true, appointmentId: created.id };
    } catch (error) {
      console.error('Error booking appointment:', error);
      setError(error instanceof Error ? error : new Error('Failed to book appointment'));
      if (isSlotConflict(error)) {
        // Platz inzwischen vergeben oder nicht (mehr) buchbar – Liste neu laden lassen
        useTimeSlotStore.getState().invalidateCache(shopId, selectedTimeSlot.start);
        toast.error(t('Diese Uhrzeit geht leider nicht: {grund} Such dir bitte eine andere aus.', { grund: error.message }));
        return { success: false, reason: 'slot-unavailable' };
      }
      toast.error(t('Der Termin konnte nicht gebucht werden. Versuch es noch einmal.'));
      return { success: false, reason: 'error' };
    } finally {
      setLoading(false);
    }
  };

  return { bookAppointment, loading, error };
};
