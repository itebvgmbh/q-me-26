import { useState } from 'react';
import { assertOnlineLead, isSlotConflict } from '../booking-rules';
import { toast } from 'sonner';
import { sprache, t } from '@/i18n';
import useTimeSlotStore from '../timeSlotStore';
import { CalendarTimeSlot } from '../types';
import { bookWithAccount, isTaken } from '../ticket-key';

/**
 * Fester Termin mit Konto. Gebucht wird über das Backend (backend/app/apis/nummer, /nummer/termin): Es prüft den Platz
 * nach den Regeln (Öffnungs- und Arbeitszeiten, Pausen, Vorlauf, andere Termine), belegt ihn in einer Transaktion und
 * meldet die Buchung dem Team. Der Browser eines Kunden schreibt selbst keine Termine (firestore.rules).
 */
export const useAppointmentBooking = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /** staffIds: die gewählte Person – bei „Egal wer“ alle, die zur Zeit frei sind; das Backend nimmt die erste, die noch frei ist */
  const bookAppointment = async (
    shopId: string,
    staffIds: string[],
    serviceId: string,
    selectedTimeSlot: CalendarTimeSlot,
    checkEarlierOptions: boolean
  ) => {
    setLoading(true);
    setError(null);

    try {
      // Vorlaufzeit des Ladens für Online-Termine (Mein Laden → Bearbeiten) – das Backend prüft sie noch einmal
      await assertOnlineLead(shopId, selectedTimeSlot.start);
      const created = await bookWithAccount({
        shopId,
        staffIds,
        serviceId,
        start: selectedTimeSlot.start,
        // Erinnerung, Absage und „Früher dran“ kommen in dieser Sprache (backend/app/i18n)
        language: sprache(),
        checkEarlier: checkEarlierOptions,
      });
      useTimeSlotStore.getState().invalidateCache(shopId, selectedTimeSlot.start);
      toast.success(t('Dein Termin ist gebucht.'));
      return { success: true, appointmentId: created.appointmentId };
    } catch (error) {
      console.error('Error booking appointment:', error);
      setError(error instanceof Error ? error : new Error('Failed to book appointment'));
      if (isSlotConflict(error) || isTaken(error)) {
        // Platz inzwischen vergeben oder zu kurzfristig – Liste neu laden lassen
        useTimeSlotStore.getState().invalidateCache(shopId, selectedTimeSlot.start);
        toast.error(error instanceof Error ? error.message : t('Der Termin konnte nicht gebucht werden. Versuch es noch einmal.'));
        return { success: false, reason: 'slot-unavailable' };
      }
      toast.error(error instanceof Error && error.message ? error.message : t('Der Termin konnte nicht gebucht werden. Versuch es noch einmal.'));
      return { success: false, reason: 'error' };
    } finally {
      setLoading(false);
    }
  };

  return { bookAppointment, loading, error };
};
