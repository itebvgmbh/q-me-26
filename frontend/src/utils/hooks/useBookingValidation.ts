import { toast } from 'sonner';
import { t } from '@/i18n';
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
      toast.error(t('Wähl zuerst einen Laden.'));
      return false;
    }
    
    if (!selectedStaff) {
      toast.error(t('Wähl aus, bei wem.'));
      return false;
    }
    
    if (!selectedService) {
      toast.error(t('Wähl eine Leistung.'));
      return false;
    }
    
    if (!selectedTimeSlot) {
      toast.error(t('Wähl eine Uhrzeit.'));
      return false;
    }

    return true;
  };

  return { validateBookingForm };
};
