import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Shop, Service } from '../utils/firestore/types';
import { getAllShopsForMarketplace, getServicesForShops, searchShops, ShopSearchFilters } from '../utils/marketplace';
import { Navigation } from '../components/Navigation';
import { ShopCard } from '../components/ShopCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="container mx-auto p-4">
      <Navigation />
      
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">Shops in Ihrer Nähe finden</h1>
        
        {/* Suchleiste und Standortbutton */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="relative flex-grow">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              className="pl-8"
              placeholder="Adresse oder Ort eingeben..."
              value={searchInput}
              onChange={handleSearchChange}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch}>Suchen</Button>
          <Button 
            variant="outline" 
            onClick={getUserLocation}
            className="whitespace-nowrap"
          >
            <MapPin className="mr-2 h-4 w-4" />
            Meinen Standort verwenden
          </Button>
        </div>
        
        {/* Maximale Entfernung */}
        <div className="mb-4">
          <Label>Maximale Entfernung: {maxDistance} km</Label>
          <input
            type="range"
            min="1"
            max="50"
            value={maxDistance}
            onChange={(e) => setMaxDistance(parseInt(e.target.value))}
            className="w-full"
          />
        </div>
        
        {/* Branchenfilter */}
        <div className="mb-4">
          <Label className="mb-2 block">Branche</Label>
          <select 
            className="w-full p-2 border rounded-md"
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
          >
            <option value="">Alle Branchen</option>
            {INDUSTRIES.map(industry => (
              <option key={industry.id} value={industry.id}>
                {industry.name}
              </option>
            ))}
          </select>
        </div>

        {locationPermission === 'denied' && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
            <p className="text-yellow-700">
              Standortfreigabe wurde abgelehnt. Um Shops in Ihrer Nähe zu finden, erlauben Sie den Zugriff auf Ihren Standort oder nutzen Sie die Suchfunktion.
            </p>
          </div>
        )}
      </div>
      
      {/* Haupt-Content-Bereich */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Linke Spalte: Shop-Liste */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-xl font-semibold mb-2">
            {userPosition ? `Gefundene Shops (${shops.length})` : 'Alle Shops'}
          </h2>
          
          {loading ? (
            <p>Lädt Shops...</p>
          ) : shops.length === 0 ? (
            <p>Keine Shops gefunden. Versuchen Sie die Suche anzupassen.</p>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto pr-2">
              {shops.map(shop => (
                <Card key={shop.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{shop.name}</CardTitle>
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {shop.street || shop.city || shop.postalCode ? (
                        // Wenn neue Adressfelder vorhanden sind, zeige diese
                        [shop.street, shop.postalCode, shop.city].filter(Boolean).join(', ')
                      ) : (
                        // Ansonsten zeige Legacy-Adresse oder Standardtext
                        shop.address || 'Keine Adresse angegeben'
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {shop.distance !== undefined && (
                      <p className="text-sm font-medium">
                        Entfernung: {shop.distance.toFixed(1)} km
                      </p>
                    )}
                    {services[shop.id] && services[shop.id].length > 0 && (
                      <p className="text-sm mt-2">
                        {services[shop.id].length} verfügbare Leistungen
                      </p>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => navigate(`/shop-details?shopId=${shop.id}`)}>
                        Details
                      </Button>
                      <Button size="sm" onClick={() => navigate(`/book-appointment?shopId=${shop.id}&fromMarketplace=true`)}>
                        Termin buchen
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
        
        {/* Rechte Spalte: Karte */}
        <div className="lg:col-span-2">
          <div style={{ height: 'calc(100vh - 250px)', width: '100%' }}>
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
                    Ihr Standort
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
                      <h3 className="font-bold">{shop.name}</h3>
                      <p className="text-sm">
                        {shop.street || shop.city || shop.postalCode ? (
                          // Wenn neue Adressfelder vorhanden sind, zeige diese
                          [shop.street, shop.postalCode, shop.city].filter(Boolean).join(', ')
                        ) : (
                          // Ansonsten zeige Legacy-Adresse oder Standardtext
                          shop.address || 'Keine Adresse angegeben'
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
                          onClick={() => navigate(`/book-appointment?shopId=${shop.id}&fromMarketplace=true`)}
                        >
                          Termin buchen
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