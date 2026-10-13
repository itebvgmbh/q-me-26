import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Service, getServicesByShopId } from '../firestore';

/**
 * Custom hook for fetching and managing service data
 * @param shopId The selected shop ID
 * @param serviceIdFromURL Optional service ID from URL to preselect
 * @returns Service data and selection state
 */
export const useServiceData = (shopId: string, serviceIdFromURL: string | null) => {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<string>('');
  // Solange geladen wird, nicht "keine Leistungen" anzeigen
  const [loading, setLoading] = useState(!!shopId);

  useEffect(() => {
    let active = true;
    const loadServices = async () => {
      if (!shopId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const servicesData = await getServicesByShopId(shopId);
        if (!active) return;
        setServices(servicesData);
        
        // If a service is provided in URL, pre-select it
        if (serviceIdFromURL) {
          const serviceExists = servicesData.some(service => service.id === serviceIdFromURL);
          if (serviceExists) {
            setSelectedService(serviceIdFromURL);
          } else {
            console.error('Service from URL not found:', serviceIdFromURL);
            toast.error('Der gewünschte Service wurde nicht gefunden');
          }
        } else {
          // Reset selected service when services are loaded without a preselection
          setSelectedService('');
        }
      } catch (error) {
        console.error('Error loading services:', error);
        if (active) toast.error('Fehler beim Laden der Services');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadServices();
    return () => {
      active = false;
    };
  }, [shopId, serviceIdFromURL]);

  return {
    loading,
    services,
    selectedService,
    setSelectedService
  };
};
