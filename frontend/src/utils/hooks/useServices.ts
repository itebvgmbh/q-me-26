import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Service, getServicesByShopId } from '../firestore';

/**
 * Hook to fetch and manage services for a selected shop
 * @param selectedShop ID of the selected shop
 * @returns Object containing services data and state
 */
export const useServices = (selectedShop: string) => {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Load services when shop changes
  useEffect(() => {
    const loadServices = async () => {
      if (!selectedShop) return;
      
      setLoading(true);
      try {
        const servicesData = await getServicesByShopId(selectedShop);
        setServices(servicesData);
        setLoading(false);
      } catch (error) {
        console.error('Error loading services:', error);
        toast.error('Fehler beim Laden der Services');
        setLoading(false);
      }
    };

    loadServices();
  }, [selectedShop]);

  return {
    services,
    selectedService,
    setSelectedService,
    loading
  };
};
