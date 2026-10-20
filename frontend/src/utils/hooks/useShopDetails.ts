import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { doc, getDocFromServer } from 'firebase/firestore';
import { getServicesByShopId, getStaffByShopId, offeredServices, Service, Shop, Staff } from '../firestore';
import { firestore as db } from '../firestore-client';
import { isConnectionError, retryWithSimpleConnection } from '../connection';

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
  // Datenbank nicht erreichbar (nicht verwechseln mit "Shop gibt es nicht")
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    const loadShopDetails = async () => {
      if (!shopId) {
        toast.error('Shop-ID fehlt');
        navigate('/');
        return;
      }

      try {
        setLoading(true);
        
        // Vom Server lesen: ohne Verbindung ein Fehler statt "Shop nicht gefunden"
        const snap = await getDocFromServer(doc(db, 'shops', shopId));
        if (!snap.exists()) {
          toast.error('Shop nicht gefunden');
          navigate('/');
          return;
        }
        setShop({ id: snap.id, ...snap.data() } as Shop);

        // Load services data
        const servicesData = await getServicesByShopId(shopId);
        setServices(offeredServices(servicesData));

        // Load staff data - filter for active staff only
        const staffData = await getStaffByShopId(shopId);
        const activeStaff = staffData.filter(s => s.isActive);
        setStaff(activeStaff);

        setLoading(false);
      } catch (error) {
        console.error('Fehler beim Laden der Shop-Details:', error);
        if (isConnectionError(error)) {
          if (retryWithSimpleConnection()) return;
          setLoadError(error);
          setLoading(false);
          return;
        }
        toast.error('Fehler beim Laden der Shop-Details');
        navigate('/');
      }
    };

    loadShopDetails();
  }, [shopId, navigate]);

  return { shop, services, staff, loading, loadError };
};
