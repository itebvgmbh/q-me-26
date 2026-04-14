import { collection, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { getAvailableTimeSlots } from '../firestore/appointments';
import { getServiceByIdLegacy } from '../firestore/services';
import { TimeSlot } from '../types';
import { Staff } from '../firestore/types';

/**
 * Find the next available time slot for a service
 * Will search either for a specific staff member or for any available staff member
 * 
 * @param shopId The ID of the shop
 * @param serviceId The ID of the service
 * @param staffId The ID of the specific staff member (if not using any)
 * @param useAnyStaff Whether to search for any available staff member
 * @param staffList List of staff members to consider
 * @param isAuthenticated Whether the user is authenticated
 * @returns The next available time slot and the selected staff member
 */
export const findAvailableTimeSlot = async (
  shopId: string,
  serviceId: string,
  staffId: string,
  useAnyStaff: boolean,
  staffList: Staff[],
  isAuthenticated: boolean
): Promise<{ slot: TimeSlot | null; selectedStaffForSlot: string }> => {
  try {
    // Get service details to know duration
    const service = await getServiceByIdLegacy(serviceId);
    if (!service) {
      console.error('Service not found');
      return { slot: null, selectedStaffForSlot: '' };
    }

    // If using any staff, we need to search for all staff members
    const staffToSearch = useAnyStaff 
      ? staffList.filter(staff => staff.isActive) 
      : staffList.filter(staff => staff.id === staffId && staff.isActive);

    if (staffToSearch.length === 0) {
      console.error('No staff members to search');
      return { slot: null, selectedStaffForSlot: '' };
    }

    // Search for each staff member in sequence
    for (const staff of staffToSearch) {
      // Get available time slots for this staff member
      const availableSlots = await getAvailableTimeSlots({
        shopId,
        serviceId,
        staffId: staff.id,
        isAuthenticated
      });

      if (availableSlots && availableSlots.length > 0) {
        // Return the first available slot
        return { 
          slot: availableSlots[0],
          selectedStaffForSlot: staff.id
        };
      }
    }

    // No slots found
    return { slot: null, selectedStaffForSlot: '' };
  } catch (error) {
    console.error('Error finding available time slot:', error);
    return { slot: null, selectedStaffForSlot: '' };
  }
};
