import { toast } from 'sonner';
import { CalendarTimeSlot } from '../types';

/**
 * Custom hook for validating booking form inputs
 */
export const useBookingValidation = () => {
  /**
   * Validates the booking form inputs
   * @returns True if all inputs are valid, false otherwise
   */
  const validateBookingForm = ({
    selectedShop,
    selectedStaff,
    selectedService,
    selectedTimeSlot
  }: {
    selectedShop: string;
    selectedStaff: string;
    selectedService: string;
    selectedTimeSlot: CalendarTimeSlot | null;
  }): boolean => {
    // Specific validation checks with clear error messages
    if (!selectedShop) {
      toast.error('Bitte wählen Sie einen Shop aus');
      return false;
    }
    
    if (!selectedStaff) {
      toast.error('Bitte wählen Sie einen Mitarbeiter aus');
      return false;
    }
    
    if (!selectedService) {
      toast.error('Bitte wählen Sie einen Service aus');
      return false;
    }
    
    if (!selectedTimeSlot) {
      toast.error('Bitte wählen Sie einen Termin aus');
      return false;
    }

    return true;
  };

  return { validateBookingForm };
};
