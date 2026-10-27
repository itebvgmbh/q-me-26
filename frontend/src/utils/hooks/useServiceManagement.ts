import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Shop, Service, getServicesByShopId, createService, updateService } from '../firestore';
import { t } from '@/i18n';

/**
 * Custom hook for service management operations
 * 
 * Encapsulates data fetching, creation, and update logic
 * to reduce component complexity and improve reusability
 */
export const useServiceManagement = (shop: Shop | null) => {
  // Service data state
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetches services for the current shop
   */
  const loadServices = useCallback(async () => {
    if (!shop) {
      setServices([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const servicesData = await getServicesByShopId(shop.id);
      setServices(servicesData);
    } catch (err) {
      console.error('Error loading services:', err);
      setError(err instanceof Error ? err : new Error('Failed to load services'));
      toast.error(t('Fehler beim Laden der Services'));
    } finally {
      setLoading(false);
    }
  }, [shop]);

  /**
   * Creates a new service for the current shop
   */
  const addService = useCallback(async (serviceData: {
    name: string;
    description: string;
    duration: number;
    setupTime?: number;
    price: number;
    category: string;
  }) => {
    if (!shop) {
      toast.error(t('Kein Shop ausgewählt'));
      return false;
    }

    try {
      await createService({
        shopId: shop.id,
        ...serviceData
      });
      
      toast.success(t('Service erfolgreich erstellt'));
      await loadServices(); // Refresh the services list
      return true;
    } catch (err) {
      console.error('Error creating service:', err);
      toast.error(t('Fehler beim Erstellen des Services'));
      return false;
    }
  }, [shop, loadServices]);

  /**
   * Updates an existing service
   */
  const updateServiceData = useCallback(async (serviceId: string, serviceData: {
    name: string;
    description: string;
    duration: number;
    setupTime?: number;
    price: number;
    category: string;
  }) => {
    try {
      await updateService(serviceId, serviceData);
      
      toast.success(t('Service erfolgreich aktualisiert'));
      await loadServices(); // Refresh the services list
      return true;
    } catch (err) {
      console.error('Error updating service:', err);
      toast.error(t('Fehler beim Aktualisieren des Services'));
      return false;
    }
  }, [loadServices]);

  // Load services when the shop changes
  useEffect(() => {
    loadServices();
  }, [loadServices]);

  return {
    services,
    loading,
    error,
    loadServices,
    addService,
    updateService: updateServiceData,
  };
};
