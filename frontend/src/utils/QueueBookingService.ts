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
      user 
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
          checkEarlierOptions
        });
      }
    } catch (error) {
      console.error('Error creating booking:', error);
      return {
        success: false,
        isAnonymous: !user,
        error,
        message: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.'
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
        message: 'Sie befinden sich bereits in der Warteschlange dieses Shops'
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
      message: 'Sie wurden erfolgreich in die Warteschlange eingereiht'
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
  }): Promise<BookingResponse> {
    const { 
      selectedShop, 
      selectedService, 
      selectedStaffForSlot, 
      startTime, 
      endTime, 
      checkEarlierOptions
    } = params;

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
      checkEarlierOptions: checkEarlierOptions,
      checkEarlierOptionsCreatedAt: checkEarlierOptions ? Timestamp.now() : undefined
    });

    console.log('Anonymous booking successfully created:', appointment);
    
    // Save reference code in localStorage for later linking
    if (appointment.referenceCode) {
      saveAnonymousBookingCode(selectedShop, appointment.referenceCode);
    }
    
    return {
      success: true,
      isAnonymous: true,
      referenceCode: appointment.referenceCode || '',
      message: 'Termin erfolgreich gebucht!'
    };
  }
};
