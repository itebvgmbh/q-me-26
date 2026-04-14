import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getShopById, getServicesByShopId, getStaffByShopId, Service, Shop, Staff } from '../firestore';

/**
 * Custom hook for fetching and managing shop details
 * Handles loading shop information, services, and staff data
 * @param shopId - The ID of the shop to fetch details for
 * @returns Shop details state and loading state
 */
export const useShopDetails = (shopId: string | null) => {
  const navigate = useNavigate();
  const [shop, setShop] = useState<Shop | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadShopDetails = async () => {
      if (!shopId) {
        toast.error('Shop-ID fehlt');
        navigate('/');
        return;
      }

      try {
        setLoading(true);
        
        // Load shop data
        const shopData = await getShopById(shopId);
        if (!shopData) {
          toast.error('Shop nicht gefunden');
          navigate('/');
          return;
        }
        setShop(shopData);

        // Load services data
        const servicesData = await getServicesByShopId(shopId);
        setServices(servicesData);

        // Load staff data - filter for active staff only
        const staffData = await getStaffByShopId(shopId);
        const activeStaff = staffData.filter(s => s.isActive);
        setStaff(activeStaff);

        setLoading(false);
      } catch (error) {
        console.error('Fehler beim Laden der Shop-Details:', error);
        toast.error('Fehler beim Laden der Shop-Details');
        navigate('/');
      }
    };

    loadShopDetails();
  }, [shopId, navigate]);

  return { shop, services, staff, loading };
};
