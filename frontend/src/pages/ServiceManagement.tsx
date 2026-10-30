import { Link } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { useOwnedShops } from '../utils/hooks/useOwnedShops';
import { useServiceManagement } from '../utils/hooks/useServiceManagement';
import { AddServiceDialog } from '../components/ServiceDialogs';
import { ServicesList } from '../components/ServicesList';
import { ShopSwitcher } from '../components/ShopSwitcher';
import { t } from '@/i18n';

/** Leistungen des Ladens anlegen, bearbeiten und löschen; bei mehreren Läden mit Ladenauswahl */
const ServiceManagement = () => {
  const { user } = useCurrentUser();
  const { shops, shop, selectShop, failed } = useOwnedShops(user?.uid);
  const shopLoading = shops === null;

  const { services, loading: servicesLoading, loadServices } = useServiceManagement(shop);

  // Die Dialoge speichern selbst – danach Liste neu laden (vorher blieb sie bis zum Neuladen alt)
  const refresh = (success: boolean) => {
    if (success) loadServices();
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Leistungen')}</h1>
          <p className="text-muted-foreground">
            {shop?.name
              ? t('Was man bei {laden} buchen kann – mit Dauer und Preis.', { laden: shop.name })
              : t('Was man bei dir buchen kann – mit Dauer und Preis.')}
          </p>
        </div>
        {shop && <AddServiceDialog shop={shop} onServiceAdded={refresh} />}
      </div>

      {shops && <ShopSwitcher shops={shops} shopId={shop?.id} onChange={selectShop} />}

      {shopLoading || servicesLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('Leistungen werden geladen')}>
          <div className="h-20 animate-pulse rounded-3xl bg-muted" />
          <div className="h-20 animate-pulse rounded-3xl bg-muted" />
        </div>
      ) : failed ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">
          {t('Deine Läden konnten nicht geladen werden. Bitte lade die Seite neu.')}
        </p>
      ) : !shop ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">
          {t('Richte zuerst deinen Laden ein.')}{' '}
          <Link to="/shop-setup" className="font-semibold text-foreground underline underline-offset-4">
            {t('Laden einrichten')}
          </Link>
        </p>
      ) : (
        <ServicesList services={services} onServiceUpdated={refresh} />
      )}
    </div>
  );
};

export default ServiceManagement;
