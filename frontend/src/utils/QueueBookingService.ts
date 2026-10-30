import { User } from 'firebase/auth';
import { TimeSlot } from './types';
import { linkOwnCustomerEntry } from './firestore';
import { saveAnonymousBookingCode } from './localStorageUtils';
import { pullNumber, type PulledNumber } from './ticket-key';
import { sprache, t } from '@/i18n';

/** Platz, den die Nummer tatsächlich bekommen hat, und ob er später liegt als angezeigt (früher: kein Hinweis nötig) */
const bookedSlotOf = (pulled: PulledNumber, shown: Date) => ({
  bookedSlot: { start: pulled.start, end: pulled.end, isAvailable: true },
  bookedStaffId: pulled.staffId,
  moved: pulled.start.getTime() > shown.getTime()
});

/**
 * Interface for booking request data
 */
export interface BookingRequest {
  selectedShop: string;
  selectedService: string;
  selectedStaffForSlot: string;
  nextAvailableSlot: TimeSlot;
  checkEarlierOptions: boolean;
  user: User | null;
  /** Name und Telefon bei Buchung ohne Konto */
  contact?: { name: string; phone: string };
  /** Wer in Frage kommt, wenn der Platz schon weg ist: die gewählte Person, bei „Egal wer“ alle (Standard: selectedStaffForSlot) */
  staffChoices?: string[];
}

/**
 * Interface for booking response data
 */
export interface BookingResponse {
  success: boolean;
  referenceCode?: string;
  /** ID des angelegten Termins – für die Nummernseite /nummer/:id */
  appointmentId?: string;
  /** Nummer ohne Konto: Schlüssel für den Link der Nummernseite (utils/ticket-key.ts) */
  ticketKey?: string;
  isAnonymous: boolean;
  /** Platz, den die Nummer tatsächlich bekommen hat */
  bookedSlot?: TimeSlot;
  bookedStaffId?: string;
  /** true, wenn der angezeigte Platz weg war und die Nummer eine andere Zeit bekommen hat */
  moved?: boolean;
  message?: string;
  error?: any;
}

/**
 * Service for handling queue booking operations
 * Encapsulates booking logic for both authenticated and anonymous users
 */
export const QueueBookingService = {
  /**
   * Nummer ziehen über das Backend (backend/app/apis/nummer, /nummer/ziehen), mit oder ohne Konto. Das Backend nimmt
   * den frühesten freien Platz am Tag des angezeigten – ist der beim Speichern schon weg (jemand war schneller, z. B. im
   * Ansturm), den nächsten bei derselben Person, bei „Egal wer“ bei allen in staffChoices. Doppelt vergeben wird dabei
   * nie (Belegung, app/libs/schedule.py). Ist der Tag voll, entscheidet der Kunde selbst über einen anderen.
   * Inhaber und gebuchte Person bekommen Bescheid (app/libs/team_notify.py).
   */
  async processBooking(request: BookingRequest): Promise<BookingResponse> {
    const { selectedShop, selectedService, selectedStaffForSlot, nextAvailableSlot, checkEarlierOptions, user, contact, staffChoices } = request;
    const shown = nextAvailableSlot.start;
    try {
      const pulled = await pullNumber({
        shopId: selectedShop,
        serviceId: selectedService,
        staffIds: staffChoices?.length ? staffChoices : [selectedStaffForSlot],
        shownStart: shown,
        signedIn: Boolean(user),
        // Ohne Konto Name und Telefon aus dem Formular; mit Konto nimmt das Backend beides aus dem Profil
        name: user ? undefined : contact?.name.trim() || undefined,
        phone: user ? undefined : contact?.phone.trim() || undefined,
        // Push und E-Mails zur Nummer kommen in dieser Sprache (backend/app/i18n)
        language: sprache(),
        checkEarlier: checkEarlierOptions,
      });
      if (user) {
        // Kunden-Eintrag im Laden, mit dem Konto verbunden – sonst landen Termine aus "Mein Tag" nicht beim Konto
        void linkOwnCustomerEntry(selectedShop);
        return { success: true, isAnonymous: false, appointmentId: pulled.appointmentId, ...bookedSlotOf(pulled, shown), message: t('Du bist eingereiht') };
      }
      // Termin-ID merken, um die Buchung später eindeutig einem Konto zuzuordnen (der Schlüssel liegt schon im Browser)
      saveAnonymousBookingCode(selectedShop, pulled.appointmentId);
      return {
        success: true,
        isAnonymous: true,
        appointmentId: pulled.appointmentId,
        ticketKey: pulled.ticketKey,
        referenceCode: pulled.referenceCode || '',
        ...bookedSlotOf(pulled, shown),
        message: t('Termin erfolgreich gebucht!')
      };
    } catch (error) {
      console.error('Error creating booking:', error);
      return {
        success: false,
        isAnonymous: !user,
        error,
        message: error instanceof Error && error.message ? error.message : t('Das hat nicht geklappt. Versuch es gleich noch einmal.')
      };
    }
  }
};
