import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { getServicesByShopId, getStaffByShopId, offeredServices, Service, Shop, Staff } from '../firestore';
import { isConnectionError } from '../connection';
import { liveLesen, LiveFehlt } from '../live';

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
        toast.error(t('Laden-ID fehlt'));
        navigate('/');
        return;
      }

      try {
        setLoading(true);
        
        // Über das Backend: ohne Verbindung ein Fehler statt "Shop nicht gefunden"
        let laden: Shop;
        try {
          laden = (await liveLesen<{ laden: Shop }>(`live/laden/${encodeURIComponent(shopId)}`)).laden;
        } catch (error) {
          if (!(error instanceof LiveFehlt)) throw error;
          toast.error(t('Laden nicht gefunden'));
          navigate('/');
          return;
        }
        setShop(laden);

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
          setLoadError(error);
          setLoading(false);
          return;
        }
        toast.error(t('Der Laden konnte nicht geladen werden.'));
        navigate('/');
      }
    };

    loadShopDetails();
  }, [shopId, navigate]);

  return { shop, services, staff, loading, loadError };
};
