import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Staff, getStaffByShopId } from '../firestore';

/**
 * Hook to fetch and manage staff for a selected shop
 * @param selectedShop ID of the selected shop
 * @returns Object containing staff data and state
 */
export const useStaff = (selectedShop: string) => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedStaffForSlot, setSelectedStaffForSlot] = useState<string>('');
  const [useAnyStaff, setUseAnyStaff] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load staff when shop changes
  useEffect(() => {
    const loadStaff = async () => {
      if (!selectedShop) return;
      
      setLoading(true);
      try {
        const shopStaff = await getStaffByShopId(selectedShop);
        const activeStaff = shopStaff.filter(s => s.isActive);
        setStaff(activeStaff);
        
        // Reset selected staff when shop changes
        setSelectedStaff('');
        setSelectedStaffForSlot('');
        setLoading(false);
      } catch (error) {
        console.error('Error loading staff:', error);
        toast.error('Fehler beim Laden der Mitarbeiter');
        setLoading(false);
      }
    };

    loadStaff();
  }, [selectedShop]);

  return {
    staff,
    selectedStaff,
    setSelectedStaff,
    selectedStaffForSlot,
    setSelectedStaffForSlot,
    useAnyStaff,
    setUseAnyStaff,
    loading
  };
};
