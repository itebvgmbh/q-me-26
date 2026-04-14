import { collection, getDocs, query, where, getDoc, doc, orderBy, limit } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Shop, Service } from './firestore/types';

// Holen Sie alle aktiven Shops für den Marktplatz
export const getAllShopsForMarketplace = async (): Promise<Shop[]> => {
  try {
    const db = getFirestore(firebaseApp);
    const shopsRef = collection(db, 'shops');
    const querySnapshot = await getDocs(shopsRef);
    
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Shop[];
  } catch (error) {
    console.error('Error getting shops for marketplace:', error);
    return [];
  }
};

// Holen Sie Services für mehrere Shops gleichzeitig für Anzeige im Marktplatz
export const getServicesForShops = async (shopIds: string[]): Promise<{ [shopId: string]: Service[] }> => {
  try {
    const db = getFirestore(firebaseApp);
    const result: { [shopId: string]: Service[] } = {};
    
    // Initialisiere leere Arrays für alle Shop-IDs
    shopIds.forEach(id => {
      result[id] = [];
    });
    
    // Abfragen für jeden Shop einzeln, um Leistungen zu holen - ohne orderBy
    await Promise.all(
      shopIds.map(async (shopId) => {
        const servicesRef = collection(db, 'services');
        const q = query(servicesRef, where('shopId', '==', shopId));
        const snapshot = await getDocs(q);
        
        // Sortiere Ergebnisse clientseitig um Indexprobleme zu vermeiden
        const services = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Service[];
        
        // Sortiere nach Namen
        services.sort((a, b) => a.name.localeCompare(b.name));
        
        // Begrenze auf 5 Einträge
        result[shopId] = services.slice(0, 5);
      })
    );
    
    return result;
  } catch (error) {
    console.error('Error getting services for shops:', error);
    return {};
  }
};

// Suchfunktion für Shops mit Filteroptionen
export interface ShopSearchFilters {
  location?: string; // Stadt oder Postleitzahl
  serviceType?: string; // Art der Dienstleistung
  industry?: string;   // Branche
}

export const searchShops = async (filters: ShopSearchFilters): Promise<Shop[]> => {
  try {
    // Zunächst alle Shops holen
    const allShops = await getAllShopsForMarketplace();
    
    // Filterung auf Client-Seite durchführen
    // In einer realen Anwendung würde man dies mit Firestore-Abfragen optimieren
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
      
      // Hier können weitere Filter hinzugefügt werden, sobald die Datenstruktur etabliert ist
      
      return true;
    });
  } catch (error) {
    console.error('Error searching shops:', error);
    return [];
  }
};
