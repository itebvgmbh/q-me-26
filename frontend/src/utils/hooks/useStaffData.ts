import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Staff, getStaffByShopId } from '../firestore';

/**
 * Custom hook for fetching and managing staff data
 * @param shopId The selected shop ID
 * @returns Staff data and selection state
 */
export const useStaffData = (shopId: string) => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [useAnyStaff, setUseAnyStaff] = useState(false);

  useEffect(() => {
    const loadStaff = async () => {
      if (!shopId) {
        setStaff([]);
        setSelectedStaff('');
        return;
      }
      
      try {
        const shopStaff = await getStaffByShopId(shopId);
        const activeStaff = shopStaff.filter(s => s.isActive);
        setStaff(activeStaff);
        
        // Reset staff selection when shop changes
        setSelectedStaff('');
        setUseAnyStaff(false);
      } catch (error) {
        console.error('Error loading staff:', error);
        toast.error('Fehler beim Laden der Mitarbeiter');
      }
    };

    loadStaff();
  }, [shopId]);

  /**
   * Select a specific staff member
   * @param staffId Staff ID to select
   */
  const selectSpecificStaff = (staffId: string) => {
    setSelectedStaff(staffId);
    setUseAnyStaff(false);
  };

  /**
   * Select any available staff member
   */
  const selectAnyStaff = () => {
    setUseAnyStaff(true);
    setSelectedStaff('');
  };

  return {
    staff,
    selectedStaff,
    setSelectedStaff,
    useAnyStaff,
    setUseAnyStaff,
    selectSpecificStaff,
    selectAnyStaff
  };
};
