import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { TimeSlot } from '../types';
import { findNextAvailableSlot, findFirstAvailableSlotAcrossStaff } from '../timeSlotFinder';

/**
 * Hook to find and manage available time slots
 * @param selectedShop ID of the selected shop
 * @param selectedService ID of the selected service
 * @param selectedStaff ID of the selected staff
 * @param useAnyStaff Whether to use any available staff
 * @param staff Array of staff members
 * @param currentStep Current step in the booking process
 * @returns Object containing time slot data and state
 */
export const useTimeSlot = (
  selectedShop: string,
  selectedService: string,
  selectedStaff: string,
  useAnyStaff: boolean,
  staff: Array<{ id: string }>,
  currentStep: number
) => {
  const [nextAvailableSlot, setNextAvailableSlot] = useState<TimeSlot | null>(null);
  const [searchingForSlot, setSearchingForSlot] = useState(false);
  const [selectedStaffForSlot, setSelectedStaffForSlot] = useState<string>('');
  const [checkEarlierOptions, setCheckEarlierOptions] = useState(false);

  // Find available slot when selection changes
  useEffect(() => {
    // Reset when selection changes
    setNextAvailableSlot(null);
    setSelectedStaffForSlot('');
    
    const findAvailableSlot = async () => {
      if (!selectedShop || !selectedService) return;
      
      // Only search if either a staff member is selected or "any staff" is enabled
      if (!(selectedStaff || useAnyStaff)) return;
      
      // Only search if we are on the confirmation step or about to go there
      if (currentStep < 3) return;
      
      setSearchingForSlot(true);
      setNextAvailableSlot(null);
      
      try {
        if (useAnyStaff && staff.length > 0) {
          // Search across all staff members for the earliest possible slot
          const staffIds = staff.map(s => s.id);
          const result = await findFirstAvailableSlotAcrossStaff(
            selectedShop,
            selectedService,
            staffIds
          );
          
          if (result) {
            setNextAvailableSlot(result.slot);
            setSelectedStaffForSlot(result.staffId);
          } else {
            toast.error('Leider konnte kein freier Zeitslot gefunden werden');
          }
        } else if (selectedStaff) {
          // Search for a specific staff member
          const slot = await findNextAvailableSlot(
            selectedShop,
            selectedService,
            selectedStaff
          );
          
          if (slot) {
            setNextAvailableSlot(slot);
            setSelectedStaffForSlot(selectedStaff);
          } else {
            toast.error('Leider konnte kein freier Zeitslot gefunden werden');
          }
        }
      } catch (error) {
        console.error('Error finding available slot:', error);
        toast.error('Fehler bei der Suche nach verfügbaren Zeitslots');
      } finally {
        setSearchingForSlot(false);
      }
    };
    
    findAvailableSlot();
  }, [selectedShop, selectedService, selectedStaff, useAnyStaff, staff, currentStep]);

  return {
    nextAvailableSlot,
    searchingForSlot,
    selectedStaffForSlot,
    checkEarlierOptions,
    setCheckEarlierOptions
  };
};
