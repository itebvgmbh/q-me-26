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
  // Solange geladen wird, nicht "niemand eingetragen" anzeigen
  const [loading, setLoading] = useState(!!shopId);

  useEffect(() => {
    let active = true;
    const loadStaff = async () => {
      if (!shopId) {
        setStaff([]);
        setSelectedStaff('');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const shopStaff = await getStaffByShopId(shopId);
        if (!active) return;
        const activeStaff = shopStaff.filter(s => s.isActive);
        setStaff(activeStaff);
        
        // Reset staff selection when shop changes
        setSelectedStaff('');
        setUseAnyStaff(false);
      } catch (error) {
        console.error('Error loading staff:', error);
        if (active) toast.error('Fehler beim Laden der Mitarbeiter');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadStaff();
    return () => {
      active = false;
    };
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
    loading,
    staff,
    selectedStaff,
    setSelectedStaff,
    useAnyStaff,
    setUseAnyStaff,
    selectSpecificStaff,
    selectAnyStaff
  };
};
