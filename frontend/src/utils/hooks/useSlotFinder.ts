import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { TimeSlot } from '../types';
import { Staff } from '../firestore';
import { findAvailableTimeSlot } from './slotFinderUtils';

/**
 * Custom hook for finding available time slots
 * Encapsulates the slot finding logic to reduce component complexity
 * 
 * @param options Options for finding slots
 * @returns State and data related to slot finding
 */
export const useSlotFinder = (options: {
  shopId: string;
  serviceId: string;
  staffId: string;
  useAnyStaff: boolean;
  staffList: Staff[];
  isAuthenticated: boolean;
  shouldSearch: boolean;
}) => {
  const { 
    shopId, 
    serviceId, 
    staffId, 
    useAnyStaff, 
    staffList, 
    isAuthenticated,
    shouldSearch  
  } = options;
  
  const [searchingForSlot, setSearchingForSlot] = useState(false);
  const [nextAvailableSlot, setNextAvailableSlot] = useState<TimeSlot | null>(null);
  const [selectedStaffForSlot, setSelectedStaffForSlot] = useState<string>('');
  
  // Automatically search for next available time slot when criteria are met
  useEffect(() => {
    // Reset when selection changes
    setNextAvailableSlot(null);
    setSelectedStaffForSlot('');
    // Ergebnisse einer überholten Suche verwerfen
    let active = true;
    
    const searchForAvailableSlot = async () => {
      if (!shopId || !serviceId) return;
      
      // Only search if either a staff member is selected or "any staff" is enabled
      if (!(staffId || useAnyStaff)) return;
      
      // Only search if explicitly requested (e.g. at confirmation step)
      if (!shouldSearch) return;
      
      setSearchingForSlot(true);
      setNextAvailableSlot(null);
      
      try {
        // Use the utility function to find a slot
        const result = await findAvailableTimeSlot(
          shopId,
          serviceId,
          staffId,
          useAnyStaff,
          staffList,
          isAuthenticated
        );
        
        if (!active) return;
        // Kein Treffer zeigt die Bestätigungsseite selbst an – kein zusätzlicher Toast
        if (result.slot) {
          setNextAvailableSlot(result.slot);
          setSelectedStaffForSlot(result.selectedStaffForSlot);
        }
      } catch (error) {
        console.error('Error finding available slot:', error);
        if (active) toast.error('Die freien Plätze konnten nicht geladen werden. Versuch es gleich noch einmal.');
      } finally {
        if (active) setSearchingForSlot(false);
      }
    };
    
    searchForAvailableSlot();
    return () => {
      active = false;
      setSearchingForSlot(false);
    };
  }, [shopId, serviceId, staffId, useAnyStaff, staffList, isAuthenticated, shouldSearch]);
  
  return {
    searchingForSlot,
    nextAvailableSlot,
    selectedStaffForSlot,
    // Helper functions
    resetSlot: () => {
      setNextAvailableSlot(null);
      setSelectedStaffForSlot('');
    }
  };
};
