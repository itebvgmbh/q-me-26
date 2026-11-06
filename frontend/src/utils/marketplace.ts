import { Shop, Service } from './firestore/types';
import { offeredServices } from './firestore/services';
import { liveLesen } from './live';

/** In öffentlichen Listen (Startseite, Läden finden, Ladenwahl): nicht gesperrt und nicht vom Betreiber ausgeblendet */
export const inLadenliste = (shop: { suspended?: unknown; unlisted?: unknown }) => !shop.suspended && !shop.unlisted;

/** Alle Läden für Listen und Karte (öffentliche Fassung vom Backend, GET /routes/live/laeden); wirft ohne Verbindung */
export const fetchMarketplaceShops = async (): Promise<Shop[]> =>
  // Gesperrte und ausgeblendete Läden tauchen in keiner Liste auf (per Link bleibt ein ausgeblendeter buchbar)
  (await liveLesen<{ laeden: Shop[] }>('live/laeden')).laeden.filter(inLadenliste);

export const getAllShopsForMarketplace = async (): Promise<Shop[]> => {
  try {
    return await fetchMarketplaceShops();
  } catch (error) {
    console.error('Error getting shops for marketplace:', error);
    return [];
  }
};

/** Bis zu fünf angebotene Leistungen je Laden, nach Namen (Anzeige in Listen und auf der Karte) */
export const getServicesForShops = async (shopIds: string[]): Promise<{ [shopId: string]: Service[] }> => {
  const result: { [shopId: string]: Service[] } = Object.fromEntries(shopIds.map((id) => [id, []]));
  await Promise.all(
    shopIds.map(async (shopId) => {
      try {
        const { leistungen } = await liveLesen<{ leistungen: Service[] }>(`live/laden/${encodeURIComponent(shopId)}/leistungen`);
        result[shopId] = offeredServices(leistungen)
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 5);
      } catch (error) {
        console.error('Leistungen nicht geladen:', shopId, error);
      }
    }),
  );
  return result;
};

// Suchfunktion für Shops mit Filteroptionen
export interface ShopSearchFilters {
  location?: string; // Stadt oder Postleitzahl
  serviceType?: string; // Art der Dienstleistung
  industry?: string;   // Branche
}

export const searchShops = async (filters: ShopSearchFilters): Promise<Shop[]> => {
  try {
    const allShops = await getAllShopsForMarketplace();
    return allShops.filter(shop => {
      // Filter nach Standort (berücksichtigt alte und neue Adressstruktur)
      if (filters.location) {
        const locationLower = filters.location.toLowerCase();
        const cityMatch = shop.city && shop.city.toLowerCase().includes(locationLower);
        const postalCodeMatch = shop.postalCode && shop.postalCode.toLowerCase().includes(locationLower);
        const streetMatch = shop.street && shop.street.toLowerCase().includes(locationLower);
        const legacyAddressMatch = shop.address && shop.address.toLowerCase().includes(locationLower);

        if (!(cityMatch || postalCodeMatch || streetMatch || legacyAddressMatch)) {
          return false;
        }
      }

      // Filter nach Branche
      if (filters.industry && shop.industry !== filters.industry) {
        return false;
      }

      return true;
    });
  } catch (error) {
    console.error('Error searching shops:', error);
    return [];
  }
};
