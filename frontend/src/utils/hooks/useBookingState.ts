import { useState, useCallback } from 'react';
import { User } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { TimeSlot } from '../types';
import { QueueBookingService } from '../QueueBookingService';

/**
 * Custom hook for managing the state of the booking process
 * Handles step navigation, booking success state, and joining the queue
 */
export const useBookingState = () => {
  const navigate = useNavigate();
  
  // Step state for the booking funnel - 1: shop, 2: service, 3: staff, 4: confirm, 5: success
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [checkEarlierOptions, setCheckEarlierOptions] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingReference, setBookingReference] = useState<string>('');

  /**
   * Initialize the step based on whether a shop ID was provided
   * @param hasShopId Whether a shop ID was provided in the URL
   */
  const initializeStep = useCallback((hasShopId: boolean) => {
    setCurrentStep(hasShopId ? 2 : 1);
  }, []);

  /**
   * Initialize the step when a service is preselected
   */
  const goToStaffSelection = useCallback(() => {
    setCurrentStep(3);
  }, []);

  /**
   * Handle queue joining process for authenticated and anonymous users
   */
  const handleJoinQueue = useCallback(async (
    selectedShop: string,
    selectedService: string,
    selectedStaffForSlot: string,
    nextAvailableSlot: TimeSlot | null,
    user: User | null
  ) => {
    // Validate required data is available
    if (!selectedShop || !selectedService || !nextAvailableSlot || !selectedStaffForSlot) {
      toast.error('Bitte füllen Sie alle Felder aus und warten Sie, bis ein verfügbarer Zeitslot gefunden wurde');
      return;
    }
    
    // Use the booking service to process the booking
    const bookingResult = await QueueBookingService.processBooking({
      selectedShop,
      selectedService,
      selectedStaffForSlot,
      nextAvailableSlot,
      checkEarlierOptions,
      user
    });
    
    if (bookingResult.success) {
      toast.success(bookingResult.message || 'Buchung erfolgreich');
      
      if (bookingResult.isAnonymous) {
        // Show successful anonymous booking with reference code
        setBookingSuccess(true);
        setBookingReference(bookingResult.referenceCode || '');
        setCurrentStep(5); // Switch to success step
      } else {
        // Navigate to MyBookings page after successful authenticated booking
        navigate('/my-bookings');
      }
    } else {
      toast.error(bookingResult.message || 'Fehler beim Einreihen in die Warteschlange');
      console.error('Booking error:', bookingResult.error);
    }
  }, [checkEarlierOptions, navigate]);

  return {
    currentStep,
    setCurrentStep,
    bookingSuccess,
    bookingReference,
    checkEarlierOptions,
    setCheckEarlierOptions,
    handleJoinQueue,
    initializeStep,
    goToStaffSelection
  };
};
