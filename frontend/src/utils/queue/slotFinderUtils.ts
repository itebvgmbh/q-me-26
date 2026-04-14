import { TimeSlot } from '../types';
import { findNextAvailableSlot, findFirstAvailableSlotAcrossStaff } from '../timeSlotFinder';

/**
 * Find an available time slot based on selected shop, service and staff
 * 
 * @param shopId The ID of the selected shop
 * @param serviceId The ID of the selected service
 * @param selectedStaff The ID of the selected staff member
 * @param useAnyStaff Whether to use any available staff member
 * @param staff Array of all staff members
 * @param isAuthenticated Whether the user is authenticated
 * @returns Promise with the next available slot and selected staff ID
 */
export const findAvailableTimeSlot = async (
  shopId: string,
  serviceId: string,
  selectedStaff: string,
  useAnyStaff: boolean,
  staff: any[],
  isAuthenticated: boolean
): Promise<{ slot: TimeSlot | null; selectedStaffForSlot: string }> => {
  try {
    let nextAvailableSlot: TimeSlot | null = null;
    let selectedStaffForSlot = '';
    
    if (useAnyStaff && staff.length > 0) {
      // Search across all staff members for the earliest possible slot
      const staffIds = staff.map(s => s.id);
      const result = await findFirstAvailableSlotAcrossStaff(
        shopId,
        serviceId,
        staffIds,
        undefined,
        undefined,
        isAuthenticated
      );
      
      if (result) {
        console.log("Found slot across staff:", result);
        nextAvailableSlot = result.slot;
        selectedStaffForSlot = result.staffId;
      } else {
        console.log("No slot found across staff");
      }
    } else if (selectedStaff) {
      // Search for a specific staff member
      const slot = await findNextAvailableSlot(
        shopId,
        serviceId,
        selectedStaff,
        undefined,
        undefined,
        isAuthenticated
      );
      
      if (slot) {
        console.log("Found slot for specific staff:", slot);
        nextAvailableSlot = slot;
        selectedStaffForSlot = selectedStaff;
      } else {
        console.log("No slot found for specific staff");
      }
    }
    
    return { slot: nextAvailableSlot, selectedStaffForSlot };
  } catch (error) {
    console.error('Error finding available slot:', error);
    return { slot: null, selectedStaffForSlot: '' };
  }
};
