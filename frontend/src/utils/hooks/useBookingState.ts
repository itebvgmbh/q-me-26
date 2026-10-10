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
  const [bookedSlot, setBookedSlot] = useState<TimeSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    user: User | null,
    contact?: { name: string; phone: string }
  ) => {
    // Validate required data is available
    if (!selectedShop || !selectedService || !nextAvailableSlot || !selectedStaffForSlot) {
      toast.error('Es wurde noch kein freier Platz gefunden. Warte kurz oder wähl eine andere Person.');
      return;
    }
    setSubmitting(true);
    
    // Use the booking service to process the booking
    const bookingResult = await QueueBookingService.processBooking({
      selectedShop,
      selectedService,
      selectedStaffForSlot,
      nextAvailableSlot,
      checkEarlierOptions,
      user,
      contact
    });
    setSubmitting(false);
    
    if (bookingResult.success) {
      if (bookingResult.isAnonymous) {
        setBookedSlot(nextAvailableSlot);
        // Show successful anonymous booking with reference code
        setBookingSuccess(true);
        setBookingReference(bookingResult.referenceCode || '');
        setCurrentStep(5); // Switch to success step
      } else {
        toast.success(bookingResult.message || 'Du bist eingereiht');
        navigate('/my-bookings');
      }
    } else {
      toast.error(bookingResult.message || 'Das Einreihen hat nicht geklappt. Versuch es noch einmal.');
      console.error('Booking error:', bookingResult.error);
    }
  }, [checkEarlierOptions, navigate]);

  return {
    currentStep,
    setCurrentStep,
    bookingSuccess,
    bookingReference,
    bookedSlot,
    submitting,
    checkEarlierOptions,
    setCheckEarlierOptions,
    handleJoinQueue,
    initializeStep,
    goToStaffSelection
  };
};
