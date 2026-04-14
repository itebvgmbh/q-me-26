import { useState, useEffect } from 'react';
import { Staff, getStaffByShopId } from '../firestore';
import { toast } from 'sonner';

/**
 * Custom hook to fetch staff for a selected shop
 */
export const useShopStaff = (shopId: string | null) => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!shopId) {
      setStaff([]);
      return;
    }

    const loadStaff = async () => {
      setLoading(true);
      try {
        const shopStaff = await getStaffByShopId(shopId);
        const activeStaff = shopStaff.filter(s => s.isActive);
        setStaff(activeStaff);
        setError(null);
      } catch (error) {
        console.error('Error loading staff:', error);
        setError(error instanceof Error ? error : new Error('Failed to load staff'));
        toast.error('Fehler beim Laden der Mitarbeiter');
      } finally {
        setLoading(false);
      }
    };

    loadStaff();
  }, [shopId]);

  return { staff, loading, error };
};
