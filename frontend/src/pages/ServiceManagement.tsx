import { useState, useEffect } from 'react';
import { useCurrentUser } from 'app';
import { getShopByOwner, Shop } from '../utils/firestore';
import { useServiceManagement } from '../utils/hooks/useServiceManagement';
import { AddServiceDialog } from '../components/ServiceDialogs';
import { ServicesList } from '../components/ServicesList';

/** Leistungen des Ladens anlegen und bearbeiten */
const ServiceManagement = () => {
  const { user } = useCurrentUser();
  const [shop, setShop] = useState<Shop | null>(null);
  const [shopLoading, setShopLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getShopByOwner(user.uid)
      .then(setShop)
      .catch((error) => console.error('Error loading shop:', error))
      .finally(() => setShopLoading(false));
  }, [user]);

  const { services, loading: servicesLoading, loadServices } = useServiceManagement(shop);

  // Die Dialoge speichern selbst – danach Liste neu laden (vorher blieb sie bis zum Neuladen alt)
  const refresh = (success: boolean) => {
    if (success) loadServices();
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Leistungen</h1>
          <p className="text-muted-foreground">Was man bei {shop?.name || 'dir'} buchen kann – mit Dauer und Preis.</p>
        </div>
        {shop && <AddServiceDialog shop={shop} onServiceAdded={refresh} />}
      </div>

      {shopLoading || servicesLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Leistungen werden geladen">
          <div className="h-20 animate-pulse rounded-3xl bg-muted" />
          <div className="h-20 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : !shop ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">Leg zuerst am Tresen deinen Laden an.</p>
      ) : (
        <ServicesList services={services} onServiceUpdated={refresh} />
      )}
    </div>
  );
};

export default ServiceManagement;
