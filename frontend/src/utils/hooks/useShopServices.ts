import { useState, useEffect } from 'react';
import { Service, getServicesByShopId } from '../firestore';
import { toast } from 'sonner';

/**
 * Custom hook to fetch services for a selected shop
 */
export const useShopServices = (shopId: string | null) => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!shopId) {
      setServices([]);
      return;
    }

    const loadServices = async () => {
      setLoading(true);
      try {
        const servicesData = await getServicesByShopId(shopId);
        setServices(servicesData);
        setError(null);
      } catch (error) {
        console.error('Error loading services:', error);
        setError(error instanceof Error ? error : new Error('Failed to load services'));
        toast.error('Fehler beim Laden der Services');
      } finally {
        setLoading(false);
      }
    };

    loadServices();
  }, [shopId]);

  return { services, loading, error };
};
