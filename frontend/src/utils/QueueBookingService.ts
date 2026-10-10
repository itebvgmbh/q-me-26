import { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { TimeSlot } from './types';
import { 
  createAppointment, 
  createCustomer, 
  isCustomerInQueue 
} from './firestore';
import { saveAnonymousBookingCode } from './localStorageUtils';

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
}

/**
 * Interface for booking response data
 */
export interface BookingResponse {
  success: boolean;
  referenceCode?: string;
  isAnonymous: boolean;
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
      contact
    } = request;
    
    const startTime = nextAvailableSlot.start;
    const endTime = nextAvailableSlot.end;
    
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
          user
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
          contact
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
  }): Promise<BookingResponse> {
    const { 
      selectedShop, 
      selectedService, 
      selectedStaffForSlot, 
      startTime, 
      endTime, 
      checkEarlierOptions, 
      user 
    } = params;
    
    // Check if customer is already in queue for this shop
    const alreadyInQueue = await isCustomerInQueue(selectedShop, user.uid);
    if (alreadyInQueue) {
      return {
        success: false,
        isAnonymous: false,
        message: 'Du stehst schon in der Schlange dieses Shops.'
      };
    }
    
    // Create customer record if this is their first interaction
    await createCustomer({
      shopId: selectedShop,
      name: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
      email: user.email || '',
    });

    // Create queue appointment with customer data
    await createAppointment({
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
    });

    return {
      success: true,
      isAnonymous: false,
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
  }): Promise<BookingResponse> {
    const { 
      selectedShop, 
      selectedService, 
      selectedStaffForSlot, 
      startTime, 
      endTime, 
      checkEarlierOptions,
      contact
    } = params;
    const name = contact?.name.trim();
    const phone = contact?.phone.trim();

    // Anonymous booking without customer data
    const appointment = await createAppointment({
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
    });

    console.log('Anonymous booking successfully created:', appointment);
    
    // Termin-ID merken, um die Buchung später eindeutig einem Konto zuzuordnen
    if (appointment.id) {
      saveAnonymousBookingCode(selectedShop, appointment.id);
    }
    
    return {
      success: true,
      isAnonymous: true,
      referenceCode: appointment.referenceCode || '',
      message: 'Termin erfolgreich gebucht!'
    };
  }
};
