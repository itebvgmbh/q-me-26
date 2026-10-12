import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
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
    <div className="flex flex-col gap-6">
      <form
        role="search"
        className="flex max-w-xl flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
      >
        <label htmlFor="shop-suche" className="sr-only">Ort oder PLZ</label>
        <div className="relative min-w-0 flex-[1_1_240px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="shop-suche"
            className="border-transparent pl-10 text-foreground"
            placeholder="Ort oder PLZ"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="signal">Suchen</Button>
      </form>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Shops werden geladen">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5">
              <Skeleton className="h-6 w-2/3 bg-white/10" />
              <Skeleton className="h-4 w-1/2 bg-white/10" />
              <Skeleton className="h-11 w-full rounded-full bg-white/10" />
            </div>
          ))}
        </div>
      ) : shops.length === 0 ? (
        <div className="rounded-3xl border border-white/10 p-8">
          <p className="text-lg font-semibold">Hier ist noch kein Shop eingetragen.</p>
          <p className="mt-1 text-white/70">
            {Object.keys(searchFilters).length > 0 ? 'Versuch es mit einem anderen Ort oder einer PLZ.' : 'Schau bald wieder vorbei.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shops.slice(0, 6).map((shop) => (
              <ShopCard key={shop.id} shop={shop} services={services[shop.id] || []} tone="dark" />
            ))}
          </div>
          {shops.length > 6 && (
            <Button variant="outline" className="self-start border-background text-background hover:bg-background hover:text-foreground" onClick={handleViewAllShops}>
              Alle {shops.length} Shops ansehen
            </Button>
          )}
        </>
      )}
    </div>
  );
};
