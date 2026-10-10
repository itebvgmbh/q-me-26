import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Shop, Service } from '../utils/firestore/types';
import { getAllShopsForMarketplace, getServicesForShops, searchShops, ShopSearchFilters } from '../utils/marketplace';
import { ShopCard } from '../components/ShopCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search, MapPin, Navigation2 } from 'lucide-react';
import { geocodeAddress, calculateDistance, enrichShopsWithCoordinates } from '../utils/geocoding';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { INDUSTRIES } from '../utils/industries';

// Leaflet icon fix für Webpack/React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Komponente zur Zentrierung der Karte auf den Benutzerstandort
interface LocateMeProps {
  position: [number, number] | null;
}

const LocateMe: React.FC<LocateMeProps> = ({ position }) => {
  const map = useMap();
  
  useEffect(() => {
    if (position) {
      map.setView(position, 13);
    }
  }, [map, position]);
  
  return null;
};

interface ShopWithCoordinates extends Shop {
  // Verwendung des vorhandenen coordinates-Felds vom Shop-Interface
  // und Hinzufügen eines optionalen distance-Felds
  distance?: number;
}

const ShopMap = () => {
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopWithCoordinates[]>([]);
  const [services, setServices] = useState<{[shopId: string]: Service[]}>({});
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([51.1657, 10.4515]); // Deutschland Zentrum
  const [maxDistance, setMaxDistance] = useState<number>(20); // Standardmäßig 20 km
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('');

  // Benutzerstandort ermitteln
  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserPosition([latitude, longitude]);
          setMapCenter([latitude, longitude]);
          setLocationPermission('granted');
        },
        (error) => {
          console.error('Error getting user location:', error);
          setLocationPermission('denied');
        }
      );
    } else {
      console.error('Geolocation is not supported by this browser.');
    }
  };

  // Shops laden und Koordinaten hinzufügen
  useEffect(() => {
    const loadShopsAndCoordinates = async () => {
      setLoading(true);
      try {
        // Alle Shops laden
        const shopsData = await getAllShopsForMarketplace();
        
        // Koordinaten für jeden Shop hinzufügen
        const shopsWithCoordinates = await enrichShopsWithCoordinates(shopsData);
        
        // Nach Entfernung sortieren, wenn Benutzerstandort bekannt ist
        let filteredShops = shopsWithCoordinates;
        
        // Filtern nach Branche, wenn eine ausgewählt ist
        if (selectedIndustry) {
          filteredShops = filteredShops.filter(shop => shop.industry === selectedIndustry);
        }
        
        // Filtern und sortieren nach Entfernung
        const sortedShops = userPosition
          ? filteredShops
              .filter(shop => shop.coordinates) // Nur Shops mit gültigen Koordinaten
              .map(shop => {
                // Berechne die Entfernung zum Benutzer
                let distance = undefined;
                if (shop.coordinates) {
                  distance = calculateDistance(
                    userPosition[0], userPosition[1],
                    shop.coordinates.latitude, shop.coordinates.longitude
                  );
                }
                return { ...shop, distance };
              })
              .filter(shop => shop.distance === undefined || shop.distance <= maxDistance)
              .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity))
          : filteredShops;
        
        setShops(sortedShops);
        
        // Services für die Shops laden
        if (sortedShops.length > 0) {
          const shopIds = sortedShops.map(shop => shop.id);
          const servicesData = await getServicesForShops(shopIds);
          setServices(servicesData);
        }
      } catch (error) {
        console.error('Error loading shops with coordinates:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadShopsAndCoordinates();
  }, [userPosition, maxDistance, selectedIndustry]);

  // Bei Eingabe im Suchfeld
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  };

  // Suchfunktion ausführen
  const handleSearch = async () => {
    setLoading(true);
    try {
      if (searchInput.trim()) {
        // Nach Adresse suchen und Karte zentrieren
        const coordinates = await geocodeAddress(searchInput);
        if (coordinates) {
          setMapCenter(coordinates);
          // Wir setzen nicht den userPosition, um die Unterscheidung zwischen
          // tatsächlichem Standort und Suchposition zu bewahren
          
          // Shops nach Entfernung zur Suchadresse filtern
          const shopsWithDistance = shops.map(shop => {
            if (shop.coordinates) {
              // Berechne Entfernung zur Suchadresse
              const distance = calculateDistance(
                coordinates[0], coordinates[1],
                shop.coordinates.latitude, shop.coordinates.longitude
              );
              return { ...shop, distance };
            }
            return shop;
          });
          
          // Filtern nach maximaler Entfernung und sortieren
          const filteredShops = shopsWithDistance
            .filter(shop => shop.distance === undefined || shop.distance <= maxDistance)
            .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
          
          setShops(filteredShops);
        } else {
          // Wenn keine Koordinaten gefunden wurden, verwenden wir textbasierte Suche
          const filters: ShopSearchFilters = { location: searchInput };
          const filteredShops = await searchShops(filters);
          // Anreichern mit Koordinaten und Entfernung (wenn Benutzerstandort bekannt)
          const enrichedShops = await enrichShopsWithCoordinates(filteredShops);
          setShops(enrichedShops);
        }
      }
    } catch (error) {
      console.error('Error during search:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Shops finden</h1>
        <p className="text-muted-foreground">Such nach Ort oder PLZ – oder lass dir zeigen, was in deiner Nähe ist.</p>
      </div>

      <form
        role="search"
        className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
      >
        <div className="flex flex-col gap-2 md:flex-row">
          <label htmlFor="karte-suche" className="sr-only">Adresse, Ort oder PLZ</label>
          <div className="relative flex-grow">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="karte-suche" className="pl-10" placeholder="Adresse, Ort oder PLZ" value={searchInput} onChange={handleSearchChange} />
          </div>
          <Button type="submit">Suchen</Button>
          <Button type="button" variant="outline" onClick={getUserLocation} className="whitespace-nowrap">
            <MapPin className="mr-2 h-4 w-4" aria-hidden="true" />
            In meiner Nähe
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="karte-entfernung">Umkreis: {maxDistance} km</Label>
            <input
              id="karte-entfernung"
              type="range"
              min="1"
              max="50"
              value={maxDistance}
              onChange={(e) => setMaxDistance(parseInt(e.target.value))}
              className="w-full accent-foreground"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="karte-branche">Branche</Label>
            <select
              id="karte-branche"
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
              value={selectedIndustry}
              onChange={(e) => setSelectedIndustry(e.target.value)}
            >
              <option value="">Alle Branchen</option>
              {INDUSTRIES.map((industry) => (
                <option key={industry.id} value={industry.id}>
                  {industry.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {locationPermission === 'denied' && (
          <p className="rounded-2xl bg-muted p-3 text-sm">
            Du hast den Standort nicht freigegeben. Gib einfach oben einen Ort oder eine PLZ ein.
          </p>
        )}
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-1">
          <h2 className="font-display text-xl font-bold">
            {userPosition ? `${shops.length} ${shops.length === 1 ? 'Shop' : 'Shops'} gefunden` : 'Alle Shops'}
          </h2>
          {loading ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Shops werden geladen">
              <div className="h-40 animate-pulse rounded-3xl bg-muted" />
              <div className="h-40 animate-pulse rounded-3xl bg-muted" />
            </div>
          ) : shops.length === 0 ? (
            <p className="rounded-3xl border border-border bg-card p-5 text-muted-foreground">Hier ist noch kein Shop. Vergrößer den Umkreis oder such woanders.</p>
          ) : (
            <div className="flex flex-col gap-3 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto lg:pr-1">
              {shops.map((shop) => (
                <ShopCard key={shop.id} shop={shop} services={services[shop.id] || []} distanceKm={shop.distance} />
              ))}
            </div>
          )}
        </div>
        
        {/* Rechte Spalte: Karte */}
        <div className="lg:col-span-2">
          <div className="h-[60vh] overflow-hidden rounded-3xl border border-border lg:h-[calc(100vh-260px)]">
            <MapContainer 
              center={mapCenter} 
              zoom={userPosition ? 13 : 6} 
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              {userPosition && (
                <Marker position={userPosition}>
                  <Popup>
                    Du bist hier
                  </Popup>
                </Marker>
              )}
              
              {shops.filter(shop => shop.coordinates).map(shop => (
                <Marker 
                  key={shop.id} 
                  position={[shop.coordinates.latitude, shop.coordinates.longitude]}
                  eventHandlers={{
                    click: () => {
                      // Hier kann man z.B. den ausgewählten Shop hervorheben
                    }
                  }}
                >
                  <Popup>
                    <div className="text-center">
                      <h3 className="font-display font-bold">{shop.name}</h3>
                      <p className="text-sm">
                        {shop.street || shop.city || shop.postalCode ? (
                          // Wenn neue Adressfelder vorhanden sind, zeige diese
                          [shop.street, shop.postalCode, shop.city].filter(Boolean).join(', ')
                        ) : (
                          // Ansonsten zeige Legacy-Adresse oder Standardtext
                          shop.address || ''
                        )}
                      </p>
                      {shop.distance !== undefined && (
                        <p className="text-sm">
                          {shop.distance.toFixed(1)} km entfernt
                        </p>
                      )}
                      <div className="mt-2">
                        <Button 
                          size="sm" 
                          className="w-full" 
                          onClick={() => navigate(`/public-join-queue?shopId=${shop.id}`)}
                        >
                          Einreihen
                        </Button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
              
              <LocateMe position={userPosition} />
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShopMap;