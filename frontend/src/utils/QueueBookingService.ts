import { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { TimeSlot } from './types';
import {
  Appointment,
  createAppointment,
  isCustomerInQueue,
  linkOwnCustomerEntry
} from './firestore';
import { findNextSlots } from './firestore/timeslots';
import { isSlotConflict } from './booking-rules';
import { saveAnonymousBookingCode } from './localStorageUtils';

// Platz beim Bestätigen schon weg: so oft frisch suchen und neu buchen, je Runde mit so vielen Plätzen zur
// Auswahl (Raster 15 Minuten – bei 30 Minuten Leistung also etwa halb so viele verschiedene Plätze)
const RETRY_ROUNDS = 3;
const RETRY_CANDIDATES = 8;

type RetryOptions = { serviceId: string; staffIds: string[] };

/**
 * Nummer anlegen. Ist der angezeigte Platz beim Bestätigen schon weg (jemand war schneller, z. B. im Ansturm),
 * gleich die nächsten freien Plätze suchen – bei derselben Person, bei „Egal wer“ bei allen in staffIds – und
 * neu buchen, statt den Kunden noch mal bestätigen zu lassen. Die Transaktion in createAppointment nimmt davon
 * den ersten, der dann noch frei ist; doppelt vergeben wird ein Platz dabei nie (Belegung, schedule.ts).
 */
async function createQueueAppointment(
  data: Parameters<typeof createAppointment>[0],
  retry: RetryOptions
): Promise<Appointment> {
  let lastError: unknown;
  try {
    return await createAppointment(data);
  } catch (error) {
    if (!isSlotConflict(error)) throw error;
    lastError = error;
  }
  for (let round = 0; round < RETRY_ROUNDS; round++) {
    const next = await findNextSlots(data.shopId, retry.serviceId, retry.staffIds, RETRY_CANDIDATES);
    if (next.length === 0) break;
    const [first, ...rest] = next;
    try {
      return await createAppointment(
        { ...data, staffId: first.staffId, startTime: Timestamp.fromDate(first.slot.start), endTime: Timestamp.fromDate(first.slot.end) },
        { alternatives: rest.map(({ staffId, slot }) => ({ staffId, start: slot.start, end: slot.end })) }
      );
    } catch (error) {
      if (!isSlotConflict(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Platz, den die Nummer tatsächlich bekommen hat, und ob er später liegt als angezeigt */
const bookedSlotOf = (appointment: Appointment, shown: Date) => {
  const start = appointment.startTime.toDate();
  return {
    bookedSlot: { start, end: appointment.endTime.toDate(), isAvailable: true },
    bookedStaffId: appointment.staffId,
    moved: start.getTime() !== shown.getTime()
  };
};

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
   * Process a booking request and create appointment
   * @param request The booking request data
   * @returns BookingResponse with status and reference code if available
   */
  async processBooking(request: BookingRequest): Promise<BookingResponse> {
    const { 
      selectedShop, 
      selectedService, 
      selectedStaffForSlot, 
      nextAvailableSlot, 
      checkEarlierOptions, 
      user,
      contact,
      staffChoices
    } = request;
    
    const startTime = nextAvailableSlot.start;
    const endTime = nextAvailableSlot.end;
    const retry = { serviceId: selectedService, staffIds: staffChoices?.length ? staffChoices : [selectedStaffForSlot] };
    
    try {
      // Authenticated user booking
      if (user) {
        return await this.processAuthenticatedBooking({
          selectedShop, 
          selectedService, 
          selectedStaffForSlot, 
          startTime, 
          endTime, 
          checkEarlierOptions, 
          user,
          retry
        });
      } 
      // Anonymous booking
      else {
        return await this.processAnonymousBooking({
          selectedShop, 
          selectedService, 
          selectedStaffForSlot, 
          startTime, 
          endTime, 
          checkEarlierOptions,
          contact,
          retry
        });
      }
    } catch (error) {
      console.error('Error creating booking:', error);
      return {
        success: false,
        isAnonymous: !user,
        error,
        message: error instanceof Error && error.message ? error.message : 'Das hat nicht geklappt. Versuch es gleich noch einmal.'
      };
    }
  },
  
  /**
   * Process booking for authenticated users
   * @param params Booking parameters for authenticated users
   * @returns BookingResponse with status
   */
  async processAuthenticatedBooking(params: {
    selectedShop: string;
    selectedService: string;
    selectedStaffForSlot: string;
    startTime: Date;
    endTime: Date;
    checkEarlierOptions: boolean;
    user: User;
    retry: RetryOptions;
  }): Promise<BookingResponse> {
    const { 
      selectedShop, 
      selectedService, 
      selectedStaffForSlot, 
      startTime, 
      endTime, 
      checkEarlierOptions, 
      user,
      retry
    } = params;
    
    // Check if customer is already in queue for this shop
    const alreadyInQueue = await isCustomerInQueue(selectedShop, user.uid);
    if (alreadyInQueue) {
      return {
        success: false,
        isAnonymous: false,
        message: 'Du stehst schon in der Schlange dieses Ladens.'
      };
    }
    
    // Create queue appointment with customer data
    const appointment = await createQueueAppointment({
      shopId: selectedShop,
      staffId: selectedStaffForSlot,
      customerId: user.uid,
      // Improved name determination with multiple fallbacks
      customerName: user.displayName || 
                  (user.email ? user.email.split('@')[0] : null) || 
                  user.providerData?.[0]?.displayName || 
                  'Unbekannt',
      serviceId: selectedService,
      startTime: Timestamp.fromDate(startTime),
      endTime: Timestamp.fromDate(endTime),
      status: 'scheduled',
      type: 'queue', // Mark as queue appointment
      checkEarlierOptions: checkEarlierOptions,
      // Only add if option is enabled
      ...(checkEarlierOptions ? { checkEarlierOptionsCreatedAt: Timestamp.now() } : {})
    }, retry);

    // Kunden-Eintrag im Laden, mit dem Konto verbunden – sonst landen Termine aus "Mein Tag" nicht beim Konto
    void linkOwnCustomerEntry(selectedShop);

    return {
      success: true,
      isAnonymous: false,
      appointmentId: appointment.id,
      ...bookedSlotOf(appointment, startTime),
      message: 'Du bist eingereiht'
    };
  },
  
  /**
   * Process booking for anonymous users
   * @param params Booking parameters for anonymous users
   * @returns BookingResponse with status and reference code
   */
  async processAnonymousBooking(params: {
    selectedShop: string;
    selectedService: string;
    selectedStaffForSlot: string;
    startTime: Date;
    endTime: Date;
    checkEarlierOptions: boolean;
    contact?: { name: string; phone: string };
    retry: RetryOptions;
  }): Promise<BookingResponse> {
    const { 
      selectedShop, 
      selectedService, 
      selectedStaffForSlot, 
      startTime, 
      endTime, 
      checkEarlierOptions,
      contact,
      retry
    } = params;
    const name = contact?.name.trim();
    const phone = contact?.phone.trim();

    // Anonymous booking without customer data
    const appointment = await createQueueAppointment({
      shopId: selectedShop,
      staffId: selectedStaffForSlot,
      serviceId: selectedService,
      startTime: Timestamp.fromDate(startTime),
      endTime: Timestamp.fromDate(endTime),
      status: 'scheduled',
      type: 'queue',
      isAnonymous: true, // Mark as anonymous booking
      ...(name ? { customerName: name } : {}),
      ...(phone ? { customerPhone: phone } : {}),
      checkEarlierOptions: checkEarlierOptions,
      // Firestore lehnt Felder mit undefined ab – nur setzen, wenn gewünscht
      ...(checkEarlierOptions ? { checkEarlierOptionsCreatedAt: Timestamp.now() } : {})
    }, retry);

    console.log('Anonymous booking successfully created:', appointment);
    
    // Termin-ID merken, um die Buchung später eindeutig einem Konto zuzuordnen
    if (appointment.id) {
      saveAnonymousBookingCode(selectedShop, appointment.id);
    }
    
    return {
      success: true,
      isAnonymous: true,
      appointmentId: appointment.id,
      referenceCode: appointment.referenceCode || '',
      ...bookedSlotOf(appointment, startTime),
      message: 'Termin erfolgreich gebucht!'
    };
  }
};
