import { Shop } from '../utils/firestore';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Store } from 'lucide-react';
import { getIndustryNameById } from '../utils/industries';

interface Props {
  shops: Shop[];
  selectedShop: string;
  onShopChange: (shop: string) => void;
}

export function ShopSelector({ shops, selectedShop, onShopChange }: Props) {
  const selectedShopData = shops.find(s => s.id === selectedShop);

  return (
    <div className="space-y-2">
      <Label>Shop auswählen</Label>
      <Select value={selectedShop} onValueChange={onShopChange}>
        <SelectTrigger>
          <SelectValue placeholder="Shop auswählen" className="flex items-center truncate" />
        </SelectTrigger>
        <SelectContent className="max-h-[350px] overflow-y-auto">
          {shops.length > 0 ? (
            shops.map(shop => (
              <SelectItem key={shop.id} value={shop.id} className="py-2">
                <div className="flex items-center space-x-3 max-w-full overflow-hidden">
                  {/* Shop Logo */}
                  {shop.logoUrl ? (
                    <div className="w-8 h-8 rounded-md overflow-hidden border border-gray-200 flex-shrink-0">
                      <img 
                        src={shop.logoUrl} 
                        alt={`${shop.name} Logo`} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Store className="w-4 h-4 text-gray-400" />
                    </div>
                  )}
                  
                  {/* Shop Info */}
                  <div className="flex flex-col truncate overflow-hidden">
                    <span className="font-medium truncate">{shop.name}</span>
                    {shop.description && (
                      <span className="text-xs text-gray-500 truncate">{shop.description}</span>
                    )}
                  </div>
                </div>
              </SelectItem>
            ))
          ) : (
            <SelectItem value="no-shops" disabled>
              Keine Shops in dieser Kategorie verfügbar
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {shops.length === 0 && (
        <p className="text-sm text-red-500 mt-1">
          Es sind keine Shops in dieser Branche verfügbar.
        </p>
      )}
      
      {/* Display selected shop details */}
      {selectedShopData && (
        <div className="mt-2 p-3 bg-gray-50 rounded-md">
          <div className="flex items-start space-x-3">
            {selectedShopData.logoUrl ? (
              <div className="w-16 h-16 rounded-md overflow-hidden border border-gray-200 flex-shrink-0">
                <img 
                  src={selectedShopData.logoUrl} 
                  alt={`${selectedShopData.name} Logo`} 
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Store className="w-8 h-8 text-gray-400" />
              </div>
            )}
            
            <div>
              <h3 className="font-medium text-base">{selectedShopData.name}</h3>
              {selectedShopData.industry && (
                <p className="text-sm text-gray-500">{getIndustryNameById(selectedShopData.industry)}</p>
              )}
              {selectedShopData.description && (
                <p className="text-sm mt-1">{selectedShopData.description}</p>
              )}
              <div className="text-xs text-gray-500 mt-1">
                <p>{selectedShopData.address}</p>
                <p>{selectedShopData.phone}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
