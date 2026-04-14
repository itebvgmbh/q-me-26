/**
 * ServiceManagement Component
 * 
 * Provides an interface for shop owners to manage their service offerings.
 * Shop owners can view, add, and edit services for their shop.
 */

import { useState, useEffect } from 'react';
import { useCurrentUser } from 'app';
import { Navigation } from '../components/Navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Import custom hooks and utilities
import { getShopByOwner } from '../utils/firestore';
import { useServiceManagement } from '../utils/hooks/useServiceManagement';

// Import extracted components
import { AddServiceDialog } from '../components/ServiceDialogs';
import { ServicesList } from '../components/ServicesList';
import { LoadingState, EmptyState } from '../components/StateComponents';





/**
 * Main ServiceManagement component
 * 
 * Manages the UI for service management, including:
 * - Loading shop data for the current user
 * - Displaying loading and empty states
 * - Managing service list and interactions
 */
const ServiceManagement = () => {
  const { user } = useCurrentUser();
  const [shop, setShop] = useState<Shop | null>(null);
  const [shopLoading, setShopLoading] = useState(true);

  // Load shop data for the current user
  useEffect(() => {
    const loadShop = async () => {
      if (!user) return;

      try {
        const shopData = await getShopByOwner(user.uid);
        setShop(shopData);
      } catch (error) {
        console.error('Error loading shop:', error);
      } finally {
        setShopLoading(false);
      }
    };

    loadShop();
  }, [user]);

  // Use custom hook for service data management
  const {
    services,
    loading: servicesLoading,
    addService,
    updateService,
  } = useServiceManagement(shop);

  // Handle service updates
  const handleServiceAdded = (success: boolean) => {
    // This is now handled by the useServiceManagement hook
  };

  const handleServiceUpdated = (success: boolean) => {
    // This is now handled by the useServiceManagement hook
  };

  // Show loading state while fetching shop or services
  if (shopLoading || servicesLoading) {
    return (
      <div className="container mx-auto p-4">
        <Navigation />
        <LoadingState message="Lade Services..." />
      </div>
    );
  }

  // Show empty state if no shop is found
  if (!shop) {
    return (
      <div className="container mx-auto p-4">
        <Navigation />
        <EmptyState message="Kein Shop gefunden. Bitte erstellen Sie zuerst einen Shop." />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Navigation />
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Services von {shop.name}</CardTitle>
              <CardDescription>
                Verwalten Sie die Services, die Sie in Ihrem Shop anbieten.
              </CardDescription>
            </div>
            <AddServiceDialog
              shop={shop}
              onServiceAdded={handleServiceAdded}
            />
          </CardHeader>
          <CardContent>
            <ServicesList 
              services={services} 
              onServiceUpdated={handleServiceUpdated} 
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ServiceManagement;
