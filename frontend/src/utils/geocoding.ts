// Geocoding-Hilfsfunktionen
import { Shop } from './firestore/types';

// Hilfsfunktion zum Anreichern von Shops mit Koordinaten für bessere Performance
export const enrichShopsWithCoordinates = async (shops: Shop[]): Promise<Shop[]> => {
  return Promise.all(shops.map(async (shop) => {
    // Wenn der Shop bereits Koordinaten hat, verwenden wir diese
    if (shop.coordinates) {
      return shop;
    }
    
    // Adressdaten für Geocoding vorbereiten
    let addressForGeocoding: string | { street?: string; city?: string; postalCode?: string; };
    
    // Neue Adressstruktur prüfen
    if (shop.street || shop.city || shop.postalCode) {
      addressForGeocoding = {
        street: shop.street,
        city: shop.city,
        postalCode: shop.postalCode
      };
    } else if (shop.address) {
      // Fallback auf Legacy-Adresse
      addressForGeocoding = shop.address;
    } else {
      // Keine Adressdaten vorhanden
      return shop;
    }
    
    try {
      const coordinates = await geocodeAddress(addressForGeocoding);
      if (coordinates) {
        return {
          ...shop,
          coordinates: {
            latitude: coordinates[0],
            longitude: coordinates[1]
          }
        };
      }
    } catch (error) {
      console.error(`Error geocoding address for shop ${shop.id}:`, error);
    }
    
    return shop;
  }));
};

// Funktion zur Umwandlung einer Adresse in geografische Koordinaten
export const geocodeAddress = async (addressInput: string | { street?: string; city?: string; postalCode?: string; }): Promise<[number, number] | null> => {
  try {
    // Konvertiere Adressobjekt in String, wenn nötig
    let address: string;
    
    if (typeof addressInput === 'string') {
      address = addressInput;
    } else {
      // Kombiniere die Adressfelder zu einem formatierten String
      const { street = '', city = '', postalCode = '' } = addressInput;
      address = [street, postalCode, city].filter(Boolean).join(', ');
      
      if (!address) {
        console.error('Keine Adressdaten zum Geocodieren gefunden');
        return null;
      }
    }
    
    const encodedAddress = encodeURIComponent(address);
    // Kostenloser OpenStreetMap Nominatim Service (für Produktionsumgebungen ist ein anderer Service empfehlenswert)
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`);
    
    if (!response.ok) {
      throw new Error(`Geocoding request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      return [parseFloat(lat), parseFloat(lon)];
    }
    
    return null;
  } catch (error) {
    console.error('Error geocoding address:', error);
    return null;
  }
};

// Entfernung zwischen zwei Koordinaten in Kilometern berechnen (Haversine-Formel)
export const calculateDistance = (
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number => {
  const R = 6371; // Erdradius in Kilometern
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
};

// Umrechnung von Grad in Radian
const toRad = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};
