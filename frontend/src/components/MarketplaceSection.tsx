import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Search, MapPin } from "lucide-react";
import { ShopCard } from './ShopCard';
import { getAllShopsForMarketplace, getServicesForShops, searchShops, ShopSearchFilters } from '../utils/marketplace';
import { Shop, Service } from '../utils/firestore/types';

/**
 * MarketplaceSection displays a list of shops that users can browse
 * Includes search functionality and displays shop cards with services
 */
export const MarketplaceSection: React.FC = () => {
  const [shops, setShops] = useState<Shop[]>([]);
  const [services, setServices] = useState<{[shopId: string]: Service[]}>({});
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchFilters, setSearchFilters] = useState<ShopSearchFilters>({});
  const navigate = useNavigate();

  // Load shops and their services based on search filters
  useEffect(() => {
    const loadShops = async () => {
      setLoading(true);
      try {
        let shopsData: Shop[];
        
        console.log('Lade Shops für Marktplatz...');
        if (Object.keys(searchFilters).length > 0) {
          // If filters are set, use search function
          shopsData = await searchShops(searchFilters);
        } else {
          // Otherwise load all shops
          shopsData = await getAllShopsForMarketplace();
        }
        
        console.log('Geladene Shops:', shopsData);
        setShops(shopsData);
        
        if (shopsData.length > 0) {
          const shopIds = shopsData.map(shop => shop.id);
          console.log('Lade Services für Shops:', shopIds);
          const servicesData = await getServicesForShops(shopIds);
          console.log('Geladene Services:', servicesData);
          setServices(servicesData);
        } else {
          console.log('Keine Shops gefunden');
        }
      } catch (error) {
        console.error('Error loading marketplace data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadShops();
  }, [searchFilters]);
  
  // Handle search button click
  const handleSearch = () => {
    setSearchFilters({
      location: searchInput
    });
  };
  
  // Handle view all shops button click
  const handleViewAllShops = () => {
    navigate('/shop-map');
  };
  
  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-center items-center mb-8">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            className="pl-8 pr-4"
            placeholder="Ort oder PLZ eingeben..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="default" onClick={handleSearch}>
            Suchen
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/shop-map')}
            className="flex items-center gap-2"
          >
            <MapPin className="h-4 w-4" />
            Karte öffnen
          </Button>
        </div>
      </div>
      
      {/* Shops grid with loading state */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="h-full flex flex-col">
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent className="flex-grow">
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-5/6 mb-2" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
              <div className="p-6 pt-2">
                <Skeleton className="h-10 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : shops.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-xl text-gray-500">Keine Shops gefunden.</p>
          <p className="text-gray-400 mt-2">Versuchen Sie es mit anderen Suchkriterien oder schauen Sie später wieder vorbei.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {shops.slice(0, 6).map((shop) => (
              <ShopCard 
                key={shop.id} 
                shop={shop} 
                services={services[shop.id] || []}
              />
            ))}
          </div>
          
          <div className="text-center mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            {shops.length > 6 && (
              <Button variant="outline" onClick={handleViewAllShops}>
                Alle Shops anzeigen
              </Button>
            )}
            <Button 
              variant="default" 
              onClick={() => navigate('/shop-map')}
              className="flex items-center gap-2"
            >
              <MapPin className="h-4 w-4" />
              Shops auf der Karte finden
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
